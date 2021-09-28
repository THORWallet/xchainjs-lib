import {
  Address,
  Balance,
  Fee,

  FeeRate,
  Network,
  Tx,
  TxHash,
  TxHistoryParams,
  TxParams,

  TxsPage,
  UTXOClient,
  XChainClientParams
} from '@thorwallet/xchain-client'
import { bip32, getSeed, validatePhrase } from '@thorwallet/xchain-crypto'
import { assetAmount, AssetLTC, assetToBase, Chain } from '@thorwallet/xchain-util'
import * as Litecoin from 'bitcoinjs-lib'
import * as sochain from './sochain-api'
import { NodeAuth } from './types'
import { TxIO } from './types/sochain-api-types'
import * as Utils from './utils'


export type LitecoinClientParams = XChainClientParams & {
  sochainUrl?: string
  nodeUrl?: string
  nodeAuth?: NodeAuth | null
}

/**
 * Custom Litecoin client
 */
class Client extends UTXOClient {
  private sochainUrl = ''
  private nodeUrl = ''
  private nodeAuth?: NodeAuth
  private rootDerivationPaths: RootDerivationPaths
  private addrCache: Record<string, Record<number, string>>

  /**
   * Constructor
   * Client is initialised with network type
   * Pass strict null as nodeAuth to disable auth for node json rpc
   *
   * @param {LitecoinClientParams} params
   */
  constructor({
    network = Network.Testnet,
    sochainUrl = 'https://sochain.com/api/v2',
    nodeUrl,
    nodeAuth = {
      username: 'thorchain',
      password: 'password',
    },
    rootDerivationPaths = {
      [Network.Mainnet]: `m/84'/2'/0'/0/`,
      [Network.Testnet]: `m/84'/1'/0'/0/`,
    },
  }: LitecoinClientParams) {
    super(Chain.Litecoin, { network, rootDerivationPaths, phrase })
    this.nodeUrl =
      nodeUrl ??
      (() => {
        switch (network) {
          case Network.Mainnet:
            return 'https://ltc.thorchain.info'
          case Network.Testnet:
            return 'https://testnet.ltc.thorchain.info'
        }
      })()

    this.nodeAuth =
      // Leave possibility to send requests without auth info for user
      // by strictly passing nodeAuth as null value
      nodeAuth === null ? undefined : nodeAuth

    this.addrCache = {}
    this.setSochainUrl(sochainUrl)
  }

  /**
   * Set/Update the sochain url.
   *
   * @param {string} url The new sochain url.
   * @returns {void}
   */
  setSochainUrl(url: string): void {
    this.sochainUrl = url
  }

  /**
   * Set/update a new phrase.
   *
   * @param {string} phrase A new phrase.
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
    } else {
      this.net = net
    }
  }

  /**
   * Get the current network.
   *
   * @returns {Network} The current network. (`mainnet` or `testnet`)
   */
  getNetwork = (): Network => {
    return this.net
  }

  /**
   * Get getFullDerivationPath
   *
   * @param {number} index the HD wallet index
   * @returns {string} The bitcoin derivation path based on the network.
   */
  getFullDerivationPath(index: number): string {
    return this.rootDerivationPaths[this.net] + `${index}`
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url based on the network.
   */
  getExplorerUrl(): string {
    switch (this.network) {
      case Network.Mainnet:
        return 'https://ltc.bitaps.com'
      case Network.Testnet:
        return 'https://tltc.bitaps.com'
    }
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address based on the network.
   */
  getExplorerAddressUrl(address: Address): string {
    return `${this.getExplorerUrl()}/${address}`
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID The transaction id
   * @returns {string} The explorer url for the given transaction id based on the network.
   */
  getExplorerTxUrl(txID: string): string {
    return `${this.getExplorerUrl()}/${txID}`
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
    if (index < 0) {
      throw new Error('index must be greater than zero')
    }
    if (this.phrase) {
      if (this.addrCache[this.phrase][index]) {
        return this.addrCache[this.phrase][index]
      }
      const ltcNetwork = Utils.ltcNetwork(this.net)
      const ltcKeys = await this.getLtcKeys(this.phrase, index)

      const { address } = Litecoin.payments.p2wpkh({
        pubkey: ltcKeys.publicKey,
        network: ltcNetwork,
      })

      if (!address) {
        throw new Error('Address not defined')
      }
      this.addrCache[this.phrase][index] = address
      return address
    }
    throw new Error('Phrase must be provided')
  }

  /**
   * @private
   * Get private key.
   *
   * Private function to get keyPair from the this.phrase
   *
   * @param {string} phrase The phrase to be used for generating privkey
   * @returns {ECPairInterface} The privkey generated from the given phrase
   *
   * @throws {"Could not get private key from phrase"} Throws an error if failed creating LTC keys from the given phrase
   * */
  private getLtcKeys = async (phrase: string, index = 0): Promise<Litecoin.ECPairInterface> => {
    const ltcNetwork = Utils.ltcNetwork(this.net)

    const seed = await getSeed(phrase)
    const master = await (await bip32.fromSeed(seed, ltcNetwork)).derivePath(this.getFullDerivationPath(index))

    if (!master.privateKey) {
      throw new Error('Could not get private key from phrase')
    }

    return Litecoin.ECPair.fromPrivateKey(master.privateKey, { network: ltcNetwork })
  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress(address: string): boolean {
    return Utils.validateAddress(address, this.network)
  }

  /**
   * Get the LTC balance of a given address.
   *
   * @param {Address} address By default, it will return the balance of the current wallet. (optional)
   * @returns {Balance[]} The LTC balance of the address.
   */
  async getBalance(address: Address): Promise<Balance[]> {
    return Utils.getBalance({
      sochainUrl: this.sochainUrl,
      network: this.network,
      address,
    })
  }

  /**
   * Get transaction history of a given address with pagination options.
   * By default it will return the transaction history of the current wallet.
   *
   * @param {TxHistoryParams} params The options to get transaction history. (optional)
   * @returns {TxsPage} The transaction history.
   */
  async getTransactions(params?: TxHistoryParams): Promise<TxsPage> {
    // Sochain API doesn't have pagination parameter
    const offset = params?.offset ?? 0
    const limit = params?.limit || 10
    try {
      const response = await sochain.getAddress({
        sochainUrl: this.sochainUrl,
        network: this.net,
        address: `${params?.address}`,
      })
      const total = response.txs.length
      const transactions: Tx[] = []

      const txs = response.txs.filter((_, index) => offset <= index && index < offset + limit)
      for (const txItem of txs) {
        const rawTx = await sochain.getTx({
          sochainUrl: this.sochainUrl,
          network: this.net,
          hash: txItem.txid,
        })
        const tx: Tx = {
          asset: AssetLTC,
          from: rawTx.inputs.map((i: TxIO) => ({
            from: i.address,
            amount: assetToBase(assetAmount(i.value, Utils.LTC_DECIMAL)),
          })),
          to: rawTx.outputs
            // ignore tx with type 'nulldata'
            .filter((i: TxIO) => i.type !== 'nulldata')
            .map((i: TxIO) => ({ to: i.address, amount: assetToBase(assetAmount(i.value, Utils.LTC_DECIMAL)) })),
          date: new Date(rawTx.time * 1000),
          type: 'transfer',
          hash: rawTx.txid,
          binanceFee: null,
          confirmations: rawTx.confirmations,
          ethCumulativeGasUsed: null,
          ethGas: null,
          ethGasPrice: null,
          ethGasUsed: null,
          ethTokenName: null,
          ethTokenSymbol: null,
        }
        transactions.push(tx)
      }

      const result: TxsPage = {
        total,
        txs: transactions,
      }
      return result
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
      const rawTx = await sochain.getTx({
        sochainUrl: this.sochainUrl,
        network: this.network,
        hash: txItem.txid,
      })
      const tx: Tx = {
        asset: AssetLTC,
        from: rawTx.inputs.map((i: TxIO) => ({
          from: i.address,
          amount: assetToBase(assetAmount(i.value, Utils.LTC_DECIMAL)),
        })),
        to: rawTx.outputs
          // ignore tx with type 'nulldata'
          .filter((i: TxIO) => i.type !== 'nulldata')
          .map((i: TxIO) => ({ to: i.address, amount: assetToBase(assetAmount(i.value, Utils.LTC_DECIMAL)) })),
        date: new Date(rawTx.time * 1000),
        type: TxType.Transfer,
        hash: rawTx.txid,
        confirmations: rawTx.confirmations,
        binanceFee: null,
        ethCumulativeGasUsed: null,
        ethGas: null,
        ethGasPrice: null,
        ethGasUsed: null,
        ethTokenName: null,
        ethTokenSymbol: null,
      }
      transactions.push(tx)
    }

    const result: TxsPage = {
      total,
      txs: transactions,
    }
    return result
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   */
  async getTransactionData(txId: string): Promise<Tx> {
    const rawTx = await sochain.getTx({
      sochainUrl: this.sochainUrl,
      network: this.network,
      hash: txId,
    })
    return {
      asset: AssetLTC,
      from: rawTx.inputs.map((i) => ({
        from: i.address,
        amount: assetToBase(assetAmount(i.value, Utils.LTC_DECIMAL)),
      })),
      to: rawTx.outputs.map((i) => ({ to: i.address, amount: assetToBase(assetAmount(i.value, Utils.LTC_DECIMAL)) })),
      date: new Date(rawTx.time * 1000),
      type: TxType.Transfer,
      hash: rawTx.txid,
    }
  }

  protected async getSuggestedFeeRate(): Promise<FeeRate> {
    return await sochain.getSuggestedTxFee()
  }

  protected async calcFee(feeRate: FeeRate, memo?: string): Promise<Fee> {
    return Utils.calcFee(feeRate, memo)
  }

  /**
   * Transfer LTC.
   *
   * @param {TxParams&FeeRate} params The transfer options.
   * @returns {TxHash} The transaction hash.
   */
  transfer = async (params: TxParams & { feeRate?: FeeRate }): Promise<TxHash> => {
    try {
      const fromAddressIndex = params?.walletIndex || 0
      const feeRate = params.feeRate || (await this.getFeeRates()).fast
      const { psbt } = await Utils.buildTx({
        ...params,
        feeRate,
        sender: await this.getAddress(fromAddressIndex),
        sochainUrl: this.sochainUrl,
        network: this.net,
      })
      const ltcKeys = this.getLtcKeys(this.phrase, fromAddressIndex)
      psbt.signAllInputs(await ltcKeys) // Sign all inputs
      psbt.finalizeAllInputs() // Finalise inputs
      const txHex = psbt.extractTransaction().toHex() // TX extracted and formatted to hex

      return await Utils.broadcastTx({
        network: this.net,
        txHex,
        nodeUrl: this.nodeUrl,
        auth: this.nodeAuth,
      })
    } catch (e) {
      return Promise.reject(e)
    }
  }
}

export { Client }
