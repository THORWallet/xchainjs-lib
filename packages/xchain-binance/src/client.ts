import { BncClient } from '@binance-chain/javascript-sdk/lib/client'
import * as crypto from '@binance-chain/javascript-sdk/lib/crypto'
import { SignedSend } from '@binance-chain/javascript-sdk/lib/types'
import {
  Address,
  BaseXChainClient,
  Fees,
  FeeType,
  Network,
  singleFee,
  Tx,
  TxHash,
  TxHistoryParams,
  TxParams,
  TxsPage,
  XChainClient,
  XChainClientParams,
} from '@thorwallet/xchain-client'
import { bip32, getSeed, validatePhrase } from '@thorwallet/xchain-crypto'
import {
  Asset,
  assetAmount,
  AssetBNB,
  assetFromString,
  assetToBase,
  assetToString,
  BaseAmount,
  baseAmount,
  baseToAsset,
  BNBChain,
} from '@thorwallet/xchain-util'
import axios from 'axios'
import { Account, Fees as BinanceFees, TransactionResult, TransferFee, TxPage as BinanceTxPage } from './types/binance'
import { BNB_DECIMAL, getPrefix, isAccount, isTransferFee, parseTx } from './util'

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

  getAccount(address?: Address, index?: number): Promise<Account>

  getMultiSendFees(): Promise<Fees>
  getSingleAndMultiFees(): Promise<{ single: Fees; multi: Fees }>

  multiSend(params: MultiSendParams): Promise<TxHash>
}

/**
 * Custom Binance client
 */
class Client extends BaseXChainClient implements BinanceClient, XChainClient {
  private bncClient: BncClient
  phrase = ''
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
  getNetwork(): Network {
    throw new Error('Method not implemented.')
  }
  transfer(_params: TxParams): Promise<string> {
    throw new Error('Method not implemented.')
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
   * @param {Network} network
   * @returns {void}
   *
   * @throws {"Network must be provided"}
   * Thrown if network has not been set before.
   */
  setNetwork(network: Network): void {
    super.setNetwork(network)
    this.bncClient = new BncClient(this.getClientUrl())
    this.bncClient.chooseNetwork(network)
  }

  /**
   * Get the client url.
   *
   * @returns {string} The client url for binance chain based on the network.
   */
  private getClientUrl(): string {
    switch (this.network) {
      case Network.Mainnet:
        return 'https://dex.binance.org'
      case Network.Testnet:
        return 'https://testnet-dex.binance.org'
    }
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url based on the network.
   */
  getExplorerUrl(): string {
    switch (this.network) {
      case Network.Mainnet:
        return 'https://explorer.binance.org'
      case Network.Testnet:
        return 'https://testnet-explorer.binance.org'
    }
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address based on the network.
   */
  getExplorerAddressUrl(address: Address): string {
    return `${this.getExplorerUrl()}/address/${address}`
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID
   * @returns {string} The explorer url for the given transaction id based on the network.
   */
  getExplorerTxUrl(txID: string): string {
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
    return this.getAddress(walletIndex)
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
   * Get the current address.
   *
   * @param {number} index (optional) Account index for the derivation path
   * @returns {Address} The current address.
   *
   * @throws {Error} Thrown if phrase has not been set before. A phrase is needed to create a wallet and to derive an address from it.
   */
  getAddress = async (index = 0): Promise<string> => {
    if (this.addrCache[this.phrase][index]) {
      return this.addrCache[this.phrase][index]
    }

    const address = crypto.getAddressFromPrivateKey(await this.getPrivateKey(index), getPrefix(this.network))

    this.addrCache[this.phrase][index] = address
    return address
  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress(address: Address): boolean {
    return this.bncClient.checkAddress(address, getPrefix(this.network))
  }

  /**
   * Get account data of wallets or by given address.
   *
   * @param {Address} address (optional) By default, it will return account data of current wallet.
   * @param {number} index (optional) Account index for the derivation path
   *
   * @returns {Account} account details of given address.
   */
  async getAccount(address?: Address, index = 0): Promise<Account> {
    const accountAddress = address || this.getAddress(index)
    const response = await this.bncClient.getAccount(accountAddress)
    if (!response || !response.result || !isAccount(response.result))
      return Promise.reject(Error(`Could not get account data for address ${accountAddress}`))

    return response.result
  }

  /**
   * Get the balance of a given address.
   *
   * @param {Address} address By default, it will return the balance of the current wallet. (optional)
   * @param {Asset} asset If not set, it will return all assets available. (optional)
   * @returns {Balance[]} The balance of the address.
   */
  getBalance = async (address: Address, assets?: Asset[]): Promise<Balances> => {
    try {
      const balances: BinanceBalances = await this.bncClient.getBalance(address)

      let assetBalances = balances.map((balance) => {
        return {
          asset: assetFromString(`${BNBChain}.${balance.symbol}`) || AssetBNB,
          amount: assetToBase(assetAmount(balance.free, 8)),
        }
      })

      // make sure we always have the bnb asset as balance in the array
      if (assetBalances.length === 0) {
        assetBalances = [
          {
            asset: AssetBNB,
            amount: baseAmount(0, BNB_DECIMAL),
          },
        ]
      }

      return assetBalances.filter(
        (balance) => !assets || assets.filter((asset) => assetToString(balance.asset) === assetToString(asset)).length,
      )
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * @private
   * Search transactions with parameters.
   *
   * @returns {Params} The parameters to be used for transaction search.
   * */
  private async searchTransactions(params?: { [x: string]: string | undefined }): Promise<TxsPage> {
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

    const txHistory = (await axios.get<BinanceTxPage>(url.toString())).data

    return {
      total: txHistory.total,
      txs: txHistory.tx.map(parseTx).filter(Boolean) as Tx[],
    }
  }

  /**
   * Get transaction history of a given address with pagination options.
   * By default it will return the transaction history of the current wallet.
   *
   * @param {TxHistoryParams} params The options to get transaction history. (optional)
   * @returns {TxsPage} The transaction history.
   */
  async getTransactions(params?: TxHistoryParams): Promise<TxsPage> {
    return await this.searchTransactions({
      address: params && params.address,
      limit: params && params.limit?.toString(),
      offset: params && params.offset?.toString(),
      startTime: params && params.startTime && params.startTime.getTime().toString(),
      txAsset: params && params.asset,
    })
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   */
  async getTransactionData(txId: string): Promise<Tx> {
    const txResult: TransactionResult = (await axios.get(`${this.getClientUrl()}/api/v1/tx/${txId}?format=json`)).data
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
  }

  /**
   * Broadcast multi-send transaction.
   *
   * @param {MultiSendParams} params The multi-send transfer options.
   * @returns {TxHash} The transaction hash.
   */
  multiSend = async ({ walletIndex = 0, transactions, memo = '' }: MultiSendParams): Promise<TxHash> => {
    const derivedAddress = await this.getAddress(walletIndex)

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
  }

  /**
   * Get the current transfer fee.
   *
   * @returns {TransferFee} The current transfer fee.
   */
  private async getTransferFee(): Promise<TransferFee> {
    const feesArray = (await axios.get<BinanceFees>(`${this.getClientUrl()}/api/v1/fees`)).data

    const [transferFee] = feesArray.filter(isTransferFee)
    if (!transferFee) throw new Error('failed to get transfer fees')

    return transferFee
  }

  /**
   * Get the current fee.
   *
   * @returns {Fees} The current fee.
   */
  async getFees(): Promise<Fees> {
    let singleTxFee: BaseAmount | undefined = undefined
    try {
      singleTxFee = baseAmount(await this.getFeeRateFromThorchain())
    } catch (error) {
      console.log(error)
      console.warn(`Error pulling rates from thorchain, will try alternate`)
    }
    if (!singleTxFee) {
      const transferFee = await this.getTransferFee()
      singleTxFee = baseAmount(transferFee.fixed_fee_params.fee)
    }

    return singleFee(FeeType.FlatFee, singleTxFee)
  }

  /**
   * Get the current fee for multi-send transaction.
   *
   * @returns {Fees} The current fee for multi-send transaction.
   */
  async getMultiSendFees(): Promise<Fees> {
    const transferFee = await this.getTransferFee()
    const multiTxFee = baseAmount(transferFee.multi_transfer_fee)

    return {
      type: 'base' as FeeType,
      average: multiTxFee,
      fast: multiTxFee,
      fastest: multiTxFee,
    } as Fees
  }

  /**
   * Get the current fee for both single and multi-send transaction.
   *
   * @returns {SingleAndMultiFees} The current fee for both single and multi-send transaction.
   */
  async getSingleAndMultiFees(): Promise<{ single: Fees; multi: Fees }> {
    const transferFee = await this.getTransferFee()
    const singleTxFee = baseAmount(transferFee.fixed_fee_params.fee)
    const multiTxFee = baseAmount(transferFee.multi_transfer_fee)

    return {
      single: {
        type: 'base' as FeeType,
        fast: singleTxFee,
        fastest: singleTxFee,
        average: singleTxFee,
      } as Fees,
      multi: {
        type: 'base' as FeeType,
        average: multiTxFee,
        fast: multiTxFee,
        fastest: multiTxFee,
      } as Fees,
    }
  }
}

export { Client }
