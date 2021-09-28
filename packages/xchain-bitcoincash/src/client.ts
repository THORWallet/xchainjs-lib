import * as bitcash from '@psf/bitcoincashjs-lib'
import {
  Address,
  Balance,
  Fee,
  FeeOption,
  FeeRate,
  Network,
  Tx,
  TxHash,
  TxHistoryParams,
  TxParams,
  TxsPage,
  UTXOClient,
  XChainClientParams,
} from '@thorwallet/xchain-client'

import { validatePhrase, getSeed, bip32 } from '@thorwallet/xchain-crypto'
import { FeesWithRates, FeeRate, FeeRates, ClientUrl } from './types/client-types'
import { KeyPair } from './types/bitcoincashjs-types'
import { getTransaction, getAccount, getTransactions, getSuggestedFee } from './haskoin-api'
import { NodeAuth } from './types'
import { broadcastTx } from './node-api'

const BigInteger = require('bigi')
const ENABLE_FAST = true

/**
 * BitcoinCashClient Interface
 */
interface BitcoinCashClient {
  getFeesWithRates(memo?: string): Promise<FeesWithRates>
  getFeesWithMemo(memo: string): Promise<Fees>
  getFeeRates(): Promise<FeeRates>
}
import { getSeed } from '@xchainjs/xchain-crypto'
import { Chain } from '@xchainjs/xchain-util'

import { getAccount, getSuggestedFee, getTransaction, getTransactions } from './haskoin-api'
import { broadcastTx } from './node-api'
import { NodeAuth } from './types'
import { KeyPair } from './types/bitcoincashjs-types'
import { ClientUrl } from './types/client-types'
import * as utils from './utils'

export type BitcoinCashClientParams = XChainClientParams & {
  haskoinUrl?: ClientUrl
  nodeUrl?: ClientUrl
  nodeAuth?: NodeAuth
  // index?: number
}

/**
 * Custom Bitcoin Cash client
 */
class Client extends UTXOClient {
  private haskoinUrl: ClientUrl
  private nodeUrl: ClientUrl
  private nodeAuth?: NodeAuth
  private rootDerivationPaths: RootDerivationPaths
  private addrCache: Record<string, Record<number, string>>

  /**
   * Constructor
   * Client is initialised with network type
   *
   * @param {BitcoinCashClientParams} params
   */
  constructor({
    network = Network.Testnet,
    haskoinUrl = {
      [Network.Testnet]: 'https://api.haskoin.com/bchtest',
      [Network.Mainnet]: 'https://api.haskoin.com/bch',
    },
    nodeUrl = {
      [Network.Testnet]: 'https://testnet.bch.thorchain.info',
      [Network.Mainnet]: 'https://bch.thorchain.info',
    },
    nodeAuth = {
      username: 'thorchain',
      password: 'password',
    },
    rootDerivationPaths = {
      [Network.Mainnet]: `m/44'/145'/0'/0/`,
      [Network.Testnet]: `m/44'/1'/0'/0/`,
    },
  }: BitcoinCashClientParams) {
    super(Chain.BitcoinCash, { network, rootDerivationPaths, phrase })
    this.network = network
    this.haskoinUrl = haskoinUrl
    this.nodeUrl = nodeUrl
    this.rootDerivationPaths = rootDerivationPaths
    this.addrCache = {}
    this.nodeAuth =
      // Leave possibility to send requests without auth info for user
      // by strictly passing nodeAuth as null value
      nodeAuth === null ? undefined : nodeAuth
  }

  /**
   * Set/Update the haskoin url.
   *
   * @param {string} url The new haskoin url.
   * @returns {void}
   */
  setHaskoinURL(url: ClientUrl): void {
    this.haskoinUrl = url
  }

  /**
   * Get the haskoin url.
   *
   * @returns {string} The haskoin url based on the current network.
   */
  getHaskoinURL(): string {
    return this.haskoinUrl[this.getNetwork()]
  }

  /**
   * Set/Update the node url.
   *
   * @param {string} url The new node url.
   * @returns {void}
   */
  setNodeURL(url: ClientUrl): void {
    this.nodeUrl = url
  }

  /**
   * Get the node url.
   *
   * @returns {string} The node url for thorchain based on the current network.
   */
  getNodeURL(): string {
    return this.nodeUrl[this.getNetwork()]
  }

  /**
   * Set/update a new phrase.
   *
   * @param {string} phrase A new phrase.
   * @param {string} derivationPath bip44 derivation path
   * @returns {Address} The address from the given phrase
   *
   * @throws {"Invalid phrase"}
   * Thrown if the given phase is invalid.
   */
  setPhrase = async (phrase: string, walletIndex = 0): Promise<Address> => {
    if (validatePhrase(phrase)) {
      this.phrase = phrase
      this.addrCache[phrase] = {}
      return this.getAddress(walletIndex)
    } else {
      throw new Error('Invalid phrase')
    }
  }

  /**
   * Purge client.
   *
   * @returns {void}
   */
  purgeClient = (): void => {
    this.phrase = ''
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
  setNetwork = (net: Network): void => {
    if (!net) {
      throw new Error('Network must be provided')
    }
    this.network = net
  }

  /**
   * Get the current network.
   *
   * @returns {Network} The current network. (`mainnet` or `testnet`)
   */
  getNetwork = (): Network => {
    return this.network
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url based on the network.
   */
  getExplorerUrl(): string {
    switch (this.network) {
      case Network.Mainnet:
        return 'https://www.blockchain.com/bch'
      case Network.Testnet:
        return 'https://www.blockchain.com/bch-testnet'
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
   * @param {string} txID The transaction id
   * @returns {string} The explorer url for the given transaction id based on the network.
   */
  getExplorerTxUrl(txID: string): string {
    return `${this.getExplorerUrl()}/tx/${txID}`
  }

  /**
   * @private
   * Get private key.
   *
   * Private function to get keyPair from the this.phrase
   *
   * @param {string} phrase The phrase to be used for generating privkey
   * @param {string} derivationPath BIP44 derivation path
   * @returns {PrivateKey} The privkey generated from the given phrase
   *
   * @throws {"Invalid phrase"} Thrown if invalid phrase is provided.
   * */
  private getBCHKeys = async (phrase: string, derivationPath: string): Promise<KeyPair> => {
    try {
      const rootSeed = await getSeed(phrase)
      if (ENABLE_FAST) {
        const master = await (await bip32.fromSeed(rootSeed, utils.bchNetwork(this.network))).derivePath(derivationPath)
        const d: Buffer = BigInteger.fromBuffer(master.privateKey)
        const btcKeyPair = new bitcash.ECPair(d, null, {
          network: utils.bchNetwork(this.network),
          compressed: true,
        })
        return btcKeyPair
      }

      const masterHDNode = bitcash.HDNode.fromSeedBuffer(rootSeed, utils.bchNetwork(this.network))
      const keyPair = await masterHDNode.derivePath(derivationPath).keyPair
      return keyPair
    } catch (error) {
      throw new Error(`Getting key pair failed: ${error?.message || error.toString()}`)
    }
  }

  /**
   * Get the current address.
   *
   * Generates a network-specific key-pair by first converting the buffer to a Wallet-Import-Format (WIF)
   * The address is then decoded into type P2WPKH and returned.
   *
   * @returns {Address} The current address.
   *
   * @throws {"Phrase must be provided"} Thrown if phrase has not been set before.
   * @throws {"Address not defined"} Thrown if failed creating account from phrase.
   */
  getAddress = async (index = 0): Promise<Address> => {
    if (this.phrase) {
      if (this.addrCache[this.phrase][index]) {
        return this.addrCache[this.phrase][index]
      }
      try {
        const keys = await this.getBCHKeys(this.phrase, this.getFullDerivationPath(index))
        const address = await keys.getAddress(index)

        const addr = utils.stripPrefix(utils.toCashAddress(address))
        this.addrCache[this.phrase][index] = addr
        return addr
      } catch (error) {
        throw new Error('Address not defined')
      }
    }

    throw new Error('Phrase must be provided')
  }

      return utils.stripPrefix(utils.toCashAddress(address))
    }  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress(address: string): boolean {
    return utils.validateAddress(address, this.network)
  }

  /**
   * Get the BCH balance of a given address.
   *
   * @param {Address} address By default, it will return the balance of the current wallet. (optional)
   * @returns {Balance[]} The BCH balance of the address.
   *
   * @throws {"Invalid address"} Thrown if the given address is an invalid address.
   */
  async getBalance(address: Address): Promise<Balance[]> {
    return utils.getBalance({ haskoinUrl: this.getHaskoinURL(), address })
  }

  /**
   * Get transaction history of a given address with pagination options.
   * By default it will return the transaction history of the current wallet.
   *
   * @param {TxHistoryParams} params The options to get transaction history. (optional)
   * @returns {TxsPage} The transaction history.
   *
   * @throws {"Invalid address"} Thrown if the given address is an invalid address.
   */
  async getTransactions({ address, offset, limit }: TxHistoryParams): Promise<TxsPage> {
    offset = offset || 0
    limit = limit || 10

    const account = await getAccount({ haskoinUrl: this.getHaskoinURL(), address })
    const txs = await getTransactions({
      haskoinUrl: this.getHaskoinURL(),
      address,
      params: { offset, limit },
    })

    if (!account) throw new Error(`Invalid address: ${address}`)
    if (!txs) throw new Error(`Transactions could not found for address ${address}`)

    return {
      total: account.txs,
      txs: txs.map(utils.parseTransaction),
    }
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   *
   * @throws {"Invalid TxID"} Thrown if the given transaction id is an invalid one.
   */
  async getTransactionData(txId: string): Promise<Tx> {
    const tx = await getTransaction({ haskoinUrl: this.getHaskoinURL(), txId })
    if (!tx) throw new Error('Invalid TxID')

    return utils.parseTransaction(tx)
  }

  protected async getSuggestedFeeRate(): Promise<FeeRate> {
    return await getSuggestedFee()
  }

  protected async calcFee(feeRate: FeeRate, memo?: string): Promise<Fee> {
    return utils.calcFee(feeRate, memo)
  }

  /**
   * Transfer BCH.
   *
   * @param {TxParams&FeeRate} params The transfer options.
   * @returns {TxHash} The transaction hash.
   */
  transfer = async (params: TxParams & { feeRate?: FeeRate }): Promise<TxHash> => {
    try {
      const index = params.walletIndex || 0
      const derivationPath = this.rootDerivationPaths[this.network] + `${index}`

      const feeRate = params.feeRate || (await this.getFeeRates()).fast
      const { builder, inputUTXOs } = await utils.buildTx({
        ...params,
        feeRate,
        sender: await this.getAddress(),
        haskoinUrl: this.getHaskoinURL(),
        network: this.network,
      })

      const keyPair = await this.getBCHKeys(this.phrase, derivationPath)

      inputUTXOs.forEach((utxo, index) => {
        builder.sign(index, keyPair, undefined, 0x41, utxo.witnessUtxo.value)
      })

      const tx = builder.build()
      const txHex = tx.toHex()

      return await broadcastTx({
        network: this.network,
        txHex,
        nodeUrl: this.getNodeURL(),
        auth: this.nodeAuth,
      })
    } catch (e) {
      return Promise.reject(e)
    }
  }
}

export { Client }
