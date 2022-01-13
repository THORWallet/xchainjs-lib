import axios from 'axios'
import { Fees as BinanceFees, TxPage as BinanceTxPage, TransactionResult, TransferFee } from './types/binance'

import * as crypto from '@binance-chain/javascript-sdk/lib/crypto'
import { BncClient } from '@binance-chain/javascript-sdk/lib/client'
import {
  Address,
  XChainClient,
  XChainClientParams,
  Fees,
  Network,
  Tx,
  Txs,
  TxParams,
  TxHash,
  TxHistoryParams,
  TxsPage,
} from '@thorwallet/xchain-client'
import { Asset, AssetBNB, BaseAmount, baseAmount, baseToAsset } from '@thorwallet/xchain-util'
import { getSeed, validatePhrase, bip32 } from '@thorwallet/xchain-crypto'
import { isTransferFee, parseTx, getPrefix } from './util'
import { SignedSend } from '@binance-chain/javascript-sdk/lib/types'
import { Signature } from './types'
import { getAddress } from './get-address'
type PrivKey = string

export type Coin = {
  asset: Asset
  amount: BaseAmount
}

export type MultiTransfer = {
  to: Address
  coins: Coin[]
}

export type MultiSendParams = {
  walletIndex?: number
  transactions: MultiTransfer[]
  memo?: string
}

/**
 * Interface for custom Binance client
 */
export interface BinanceClient {
  purgeClient(): void
  getBncClient(): BncClient

  getMultiSendFees(): Promise<Fees>
  getSingleAndMultiFees(): Promise<{ single: Fees; multi: Fees }>

  multiSend(params: MultiSendParams): Promise<TxHash>
}

const getTxWithRateLimitHandling = async (url: string): Promise<BinanceTxPage> => {
  const response = await axios.get<BinanceTxPage>(url, {
    validateStatus: (status) => {
      return (status >= 200 && status < 300) || status === 429
    },
  })
  if (response.status === 429) {
    console.log('got 429 for ', url, 'waiting 2 seconds then retrying...')
    await new Promise((resolve) => setTimeout(resolve, 2000))
    return getTxWithRateLimitHandling(url)
  }
  return response.data
}

/**
 * Custom Binance client
 */
class Client implements BinanceClient, XChainClient {
  private network: Network
  private bncClient: BncClient
  private phrase = ''
  private addrCache: Record<string, Record<number, string>>

  /**
   * Constructor
   *
   * Client has to be initialised with network type and phrase.
   * It will throw an error if an invalid phrase has been passed.
   *
   * @param {XChainClientParams} params
   *
   * @throws {"Invalid phrase"} Thrown if the given phase is invalid.
   */
  constructor({ network = 'testnet' }: XChainClientParams) {
    this.network = network
    this.bncClient = new BncClient(this.getClientUrl())
    this.bncClient.chooseNetwork(network)
    this.addrCache = {}
  }

  /**
   * Purge client.
   *
   * @returns {void}
   */
  purgeClient(): void {
    this.phrase = ''
  }

  /**
   * Get the BncClient interface.
   *
   * @returns {BncClient} The BncClient from `@binance-chain/javascript-sdk`.
   */
  getBncClient(): BncClient {
    return this.bncClient
  }

  /**
   * Set/update the current network.
   *
   * @param {Network} network `mainnet` or `testnet`.
   * @returns {void}
   *
   * @throws {"Network must be provided"}
   * Thrown if network has not been set before.
   */
  setNetwork(network: Network): void {
    if (!network) {
      throw new Error('Network must be provided')
    } else {
      this.network = network
      this.bncClient = new BncClient(this.getClientUrl())
      this.bncClient.chooseNetwork(network)
    }
  }

  /**
   * Get the current network.
   *
   * @returns {Network} The current network. (`mainnet` or `testnet`)
   */
  getNetwork(): Network {
    return this.network
  }

  /**
   * Get the client url.
   *
   * @returns {string} The client url for binance chain based on the network.
   */
  private getClientUrl = (): string => {
    return this.network === 'testnet' ? 'https://testnet-dex.binance.org' : 'https://dex.binance.org'
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url based on the network.
   */
  getExplorerUrl = (): string => {
    return this.network === 'testnet' ? 'https://testnet-explorer.binance.org' : 'https://explorer.binance.org'
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address based on the network.
   */
  getExplorerAddressUrl = (address: Address): string => {
    return `${this.getExplorerUrl()}/address/${address}`
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID
   * @returns {string} The explorer url for the given transaction id based on the network.
   */
  getExplorerTxUrl = (txID: string): string => {
    return `${this.getExplorerUrl()}/tx/${txID}`
  }

  /**
   * Set/update a new phrase
   *
   * @param {string} phrase A new phrase.
   * @returns {Address} The address from the given phrase
   *
   * @throws {"Invalid phrase"}
   * Thrown if the given phase is invalid.
   */
  setPhrase = (phrase: string, walletIndex = 0): Promise<Address> => {
    if (!validatePhrase(phrase)) {
      throw new Error('Invalid phrase')
    }

    this.phrase = phrase
    this.addrCache[phrase] = {}
    return getAddress({ network: this.getNetwork(), phrase, index: walletIndex })
  }

  private getPrivateKeyFromMnemonic = async (phrase: string, derive: boolean, index: number): Promise<string> => {
    const HDPATH = "44'/714'/0'/0/"
    const seed = await getSeed(phrase)
    if (derive) {
      const master = await bip32.fromSeed(seed)
      const child = await master.derivePath(HDPATH + index)
      if (!child.privateKey) {
        throw new Error('child does not have a privateKey')
      }

      return child.privateKey.toString('hex')
    }
    return seed.toString('hex')
  }
  /**
   * @private
   * Get private key.
   *
   * @param {number} index account index for the derivation path
   * @returns {PrivKey} The privkey generated from the given phrase
   *
   * @throws {"Phrase not set"}
   * Throws an error if phrase has not been set before
   * */
  private getPrivateKey = (index: number): Promise<PrivKey> => {
    if (!this.phrase) throw new Error('Phrase not set')

    return this.getPrivateKeyFromMnemonic(this.phrase, true, index)
  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress = (address: Address): boolean => {
    return this.bncClient.checkAddress(address, getPrefix(this.network))
  }

  /**
   * @private
   * Search transactions with parameters.
   *
   * @returns {Params} The parameters to be used for transaction search.
   * */
  private searchTransactions = async (params?: { [x: string]: string | undefined }): Promise<TxsPage> => {
    try {
      const clientUrl = `${this.getClientUrl()}/api/v1/transactions`
      const url = new URL(clientUrl)

      const endTime = Date.now()
      const diffTime = 90 * 24 * 60 * 60 * 1000
      url.searchParams.set('endTime', endTime.toString())
      url.searchParams.set('startTime', (endTime - diffTime).toString())

      for (const key in params) {
        const value = params[key]
        if (value) {
          url.searchParams.set(key, value)
          if (key === 'startTime' && !params['endTime']) {
            url.searchParams.set('endTime', (parseInt(value) + diffTime).toString())
          }
          if (key === 'endTime' && !params['startTime']) {
            url.searchParams.set('startTime', (parseInt(value) - diffTime).toString())
          }
        }
      }

      const txHistory = await getTxWithRateLimitHandling(url.toString())

      return {
        total: txHistory.total,
        txs: txHistory.tx.map(parseTx).filter(Boolean) as Txs,
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get transaction history of a given address with pagination options.
   * By default it will return the transaction history of the current wallet.
   *
   * @param {TxHistoryParams} params The options to get transaction history. (optional)
   * @returns {TxsPage} The transaction history.
   */
  getTransactions = async (params?: TxHistoryParams): Promise<TxsPage> => {
    try {
      return await this.searchTransactions({
        address: params && params.address,
        limit: params && params.limit?.toString(),
        offset: params && params.offset?.toString(),
        startTime: params && params.startTime && params.startTime.getTime().toString(),
        txAsset: params && params.asset,
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   */
  getTransactionData = async (txId: string): Promise<Tx> => {
    try {
      const txResult: TransactionResult = await axios
        .get(`${this.getClientUrl()}/api/v1/tx/${txId}?format=json`)
        .then((response) => response.data)

      const blockHeight = txResult.height

      let address = ''
      const msgs = txResult.tx.value.msg
      if (msgs.length) {
        const msg = msgs[0].value as SignedSend
        if (msg.inputs && msg.inputs.length) {
          address = msg.inputs[0].address
        } else if (msg.outputs && msg.outputs.length) {
          address = msg.outputs[0].address
        }
      }

      const txHistory = await this.searchTransactions({ address, blockHeight })
      const [transaction] = txHistory.txs.filter((tx) => tx.hash === txId)

      if (!transaction) {
        throw new Error('transaction not found')
      }

      return transaction
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Broadcast multi-send transaction.
   *
   * @param {MultiSendParams} params The multi-send transfer options.
   * @returns {TxHash} The transaction hash.
   */
  multiSend = async ({ walletIndex = 0, transactions, memo = '' }: MultiSendParams): Promise<TxHash> => {
    try {
      const derivedAddress = await getAddress({ network: this.getNetwork(), phrase: this.phrase, index: walletIndex })

      await this.bncClient.initChain()
      await this.bncClient.setPrivateKey(await this.getPrivateKey(walletIndex)).catch((error) => Promise.reject(error))

      const transferResult = await this.bncClient.multiSend(
        derivedAddress,
        transactions.map((transaction) => {
          return {
            to: transaction.to,
            coins: transaction.coins.map((coin) => {
              return {
                denom: coin.asset.symbol,
                amount: baseToAsset(coin.amount).amount().toString(),
              }
            }),
          }
        }),
        memo,
      )

      return transferResult.result.map((txResult: { hash?: TxHash }) => txResult?.hash ?? '')[0]
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Sign an arbitrary string message.
   *
   *
   * @returns {Signature} The current address.
   *
   * @throws {"Phrase must be provided"} Thrown if phrase has not been set before.
   */
  signMessage = async (msg: string, index = 0): Promise<Signature> => {
    const pk = await this.getPrivateKey(index)
    if (!pk) {
      throw new Error('Private Key not defined')
    }
    const signature = crypto.generateSignature(Buffer.from(msg).toString('hex'), pk).toString('hex')
    const pubKey = crypto.getPublicKeyFromPrivateKey(pk)
    return { signature, pubKey }
  }

  /**
   * Transfer balances.
   *
   * @param {TxParams} params The transfer options.
   * @returns {TxHash} The transaction hash.
   */
  transfer = async ({ walletIndex, asset, amount, recipient, memo }: TxParams): Promise<TxHash> => {
    try {
      await this.bncClient.initChain()
      await this.bncClient
        .setPrivateKey(await this.getPrivateKey(walletIndex || 0))
        .catch((error: Error) => Promise.reject(error))

      const transferResult = await this.bncClient.transfer(
        await getAddress({ index: 0, phrase: this.phrase, network: this.getNetwork() }),
        recipient,
        baseToAsset(amount).amount().toString(),
        asset ? asset.symbol : AssetBNB.symbol,
        memo,
      )

      return transferResult.result.map((txResult: { hash?: TxHash }) => txResult?.hash ?? '')[0]
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the current transfer fee.
   *
   * @returns {TransferFee} The current transfer fee.
   */
  private getTransferFee = async (): Promise<TransferFee> => {
    try {
      const feesArray = await axios
        .get<BinanceFees>(`${this.getClientUrl()}/api/v1/fees`)
        .then((response) => response.data)

      const [transferFee] = feesArray.filter(isTransferFee)
      if (!transferFee) {
        throw new Error('failed to get transfer fees')
      }

      return transferFee
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the current fee.
   *
   * @returns {Fees} The current fee.
   */
  getFees = async (): Promise<Fees> => {
    try {
      const transferFee = await this.getTransferFee()
      const singleTxFee = baseAmount(transferFee.fixed_fee_params.fee)

      return {
        type: 'base',
        fast: singleTxFee,
        fastest: singleTxFee,
        average: singleTxFee,
      } as Fees
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the current fee for multi-send transaction.
   *
   * @returns {Fees} The current fee for multi-send transaction.
   */
  getMultiSendFees = async (): Promise<Fees> => {
    try {
      const transferFee = await this.getTransferFee()
      const multiTxFee = baseAmount(transferFee.multi_transfer_fee)

      return {
        type: 'base',
        average: multiTxFee,
        fast: multiTxFee,
        fastest: multiTxFee,
      } as Fees
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the current fee for both single and multi-send transaction.
   *
   * @returns {SingleAndMultiFees} The current fee for both single and multi-send transaction.
   */
  getSingleAndMultiFees = async (): Promise<{ single: Fees; multi: Fees }> => {
    try {
      const transferFee = await this.getTransferFee()
      const singleTxFee = baseAmount(transferFee.fixed_fee_params.fee)
      const multiTxFee = baseAmount(transferFee.multi_transfer_fee)

      return {
        single: {
          type: 'base',
          fast: singleTxFee,
          fastest: singleTxFee,
          average: singleTxFee,
        } as Fees,
        multi: {
          type: 'base',
          average: multiTxFee,
          fast: multiTxFee,
          fastest: multiTxFee,
        } as Fees,
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }
}

export { Client }
