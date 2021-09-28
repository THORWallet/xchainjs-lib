import { AccAddress, PrivKey } from '@thorwallet/cosmos-client'
import { StdTx } from '@thorwallet/cosmos-client/x/auth'
import {
  Address,
  Balance,
  Fees,
  Network,
  RootDerivationPaths,
  Tx,
  TxHash,
  TxHistoryParams,
  TxParams,
  TxsPage,
  XChainClient,
  XChainClientParams,
} from '@thorwallet/xchain-client'
import { CosmosSDKClient, RPCTxResult } from '@thorwallet/xchain-cosmos'
import * as xchainCrypto from '@thorwallet/xchain-crypto'
import { Asset, AssetRuneNative, assetToString, baseAmount } from '@thorwallet/xchain-util'
import { AssetRune, ClientUrl, DepositParam, ExplorerUrls, NodeUrl, ThorchainClientParams } from './types'
import { msgNativeTxFromJson } from './types/messages'
import {
  buildDepositTx,
  DEFAULT_GAS_VALUE,
  getAsset,
  getChainId,
  getDefaultClientUrl,
  getDefaultExplorerUrls,
  getDenomWithChain,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getPrefix,
  DECIMAL,
  registerCodecs,
  MAX_TX_COUNT,
} from './util'

/**
 * Interface for custom Thorchain client
 */
export interface ThorchainClient {
  setClientUrl(clientUrl: ClientUrl): void
  getClientUrl(): NodeUrl
  setExplorerUrls(explorerUrls: ExplorerUrls): void
  getCosmosClient(): CosmosSDKClient

  deposit(params: DepositParam): Promise<TxHash>
}

/**
 * Custom Thorchain Client
 */
class Client implements ThorchainClient, XChainClient {
  private network: Network
  private clientUrl: ClientUrl
  private explorerUrls: ExplorerUrls
  private phrase = ''
  private rootDerivationPaths: RootDerivationPaths
  private cosmosClient: CosmosSDKClient
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
  constructor({
    network = Network.Testnet,
    clientUrl,
    explorerUrls,
    rootDerivationPaths = {
      [Network.Mainnet]: "44'/931'/0'/0/",
      [Network.Testnet]: "44'/931'/0'/0/",
    },
  }: XChainClientParams & ThorchainClientParams) {
    this.network = network
    this.clientUrl = clientUrl || getDefaultClientUrl()
    this.explorerUrls = explorerUrls || getDefaultExplorerUrls()
    this.rootDerivationPaths = rootDerivationPaths
    this.addrCache = {}

    this.cosmosClient = new CosmosSDKClient({
      server: this.getClientUrl().node,
      chainId: getChainId(),
      prefix: getPrefix(this.network),
    })
  }
  transfer(_params: TxParams): Promise<string> {
    throw new Error('Method not implemented.')
  }
  async deposit({ walletIndex = 0, asset = AssetRuneNative, amount, memo }: DepositParam): Promise<TxHash> {
    const assetBalance = await this.getBalance(await this.getAddress(walletIndex), [asset])

    if (assetBalance.length === 0 || assetBalance[0].amount.amount().lt(amount.amount().plus(DEFAULT_GAS_VALUE))) {
      throw new Error('insufficient funds')
    }

    const signer = await this.getAddress(walletIndex)
    const msgNativeTx = msgNativeTxFromJson({
      coins: [
        {
          asset: getDenomWithChain(asset),
          amount: amount.amount().toString(),
        },
      ],
      memo,
      signer,
    })

    const unsignedStdTx: StdTx = await buildDepositTx(msgNativeTx, this.getClientUrl().node)
    const privateKey = this.getPrivateKey(walletIndex)
    const accAddress = AccAddress.fromBech32(signer)

    return (await this.cosmosClient.signAndBroadcast(unsignedStdTx, await privateKey, accAddress))?.txhash ?? ''
  }
  getTransactionData(_txId: string, _assetAddress?: string): Promise<Tx> {
    throw new Error('Method not implemented.')
  }
  getFees(): Promise<Fees> {
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
   * Set/update the current network.
   *
   * @param {Network} network
   * @returns {void}
   *
   * @throws {"Network must be provided"}
   * Thrown if network has not been set before.
   */
  setNetwork(network: Network): void {
    if (!network) {
      throw new Error('Network must be provided')
    }

    this.network = network
    this.cosmosClient.updatePrefix(getPrefix(this.network))
  }

  /**
   * Get the current network.
   *
   * @returns {Network}
   */
  getNetwork(): Network {
    return this.network
  }

  /**
   * Set/update the client URL.
   *
   * @param {ClientUrl} clientUrl The client url to be set.
   * @returns {void}
   */
  setClientUrl(clientUrl: ClientUrl): void {
    this.clientUrl = clientUrl
  }

  /**
   * Get the client url.
   *
   * @returns {NodeUrl} The client url for thorchain based on the current network.
   */
  getClientUrl(): NodeUrl {
    return this.clientUrl[this.network]
  }

  /**
   * Set/update the explorer URLs.
   *
   * @param {ExplorerUrls} urls The explorer urls to be set.
   * @returns {void}
   */
  setExplorerUrls(urls: ExplorerUrls): void {
    this.explorerUrls = urls
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url for thorchain based on the current network.
   */
  getExplorerUrl(): string {
    return this.explorerUrls.root[this.network]
  }

  /**
   * Get cosmos client
   * @returns {CosmosSDKClient} current cosmos client
   */
  getCosmosClient(): CosmosSDKClient {
    return this.cosmosClient
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address.
   */
  getExplorerAddressUrl(address: Address): string {
    return getExplorerAddressUrl({ urls: this.explorerUrls, network: this.network, address })
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID
   * @returns {string} The explorer url for the given transaction id.
   */
  getExplorerTxUrl(txID: string): string {
    return getExplorerTxUrl({ urls: this.explorerUrls, network: this.network, txID })
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
    if (this.phrase !== phrase) {
      if (!xchainCrypto.validatePhrase(phrase)) {
        throw new Error('Invalid phrase')
      }
      this.phrase = phrase
      this.addrCache[phrase] = {}
    }

    return this.getAddress(walletIndex)
  }

  /**
   * Get getFullDerivationPath
   *
   * @param {number} index the HD wallet index
   * @returns {string} The bitcoin derivation path based on the network.
   */
  getFullDerivationPath(index: number): string {
    return this.rootDerivationPaths[this.network] + `${index}`
  }

  /**
   * @private
   * Get private key.
   *
   * @returns {PrivKey} The private key generated from the given phrase
   *
   * @throws {"Phrase not set"}
   * Throws an error if phrase has not been set before
   * */
  private getPrivateKey = (index = 0): Promise<PrivKey> =>
    this.cosmosClient.getPrivKeyFromMnemonic(this.phrase, this.getFullDerivationPath(index))

  /**
   * Get the current address.
   *
   * @returns {Address} The current address.
   *
   * @throws {Error} Thrown if phrase has not been set before. A phrase is needed to create a wallet and to derive an address from it.
   */
  getAddress = async (index = 0): Promise<string> => {
    if (this.addrCache[this.phrase][index]) {
      return this.addrCache[this.phrase][index]
    }
    const address = await this.cosmosClient.getAddressFromMnemonic(this.phrase, this.getFullDerivationPath(index))

    if (!address) {
      throw new Error('address not defined')
    }
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
    return this.cosmosClient.checkAddress(address)
  }

  /**
   * Get the balance of a given address.
   *
   * @param {Address} address By default, it will return the balance of the current wallet. (optional)
   * @param {Asset} asset If not set, it will return all assets available. (optional)
   * @returns {Balance[]} The balance of the address.
   */
  getBalance = async (address: Address, assets?: Asset[]): Promise<Balance[]> => {
    try {
      const balances = await this.cosmosClient.getBalance(address)

      let assetBalances = balances.map((balance) => ({
        asset: (balance.denom && getAsset(balance.denom)) || AssetRune,
        amount: baseAmount(balance.amount, DECIMAL),
      }))

      if (assetBalances.length === 0) {
        assetBalances = [
          {
            asset: AssetRune,
            amount: baseAmount(0, DECIMAL),
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
   * Get transaction history of a given address with pagination options.
   * By default it will return the transaction history of the current wallet.
   *
   * @param {TxHistoryParams} params The options to get transaction history. (optional)
   * @returns {TxsPage} The transaction history.
   */
  getTransactions = async (
    params?: TxHistoryParams & { filterFn?: (tx: RPCTxResult) => boolean },
  ): Promise<TxsPage> => {
    const messageAction = undefined
    const offset = params?.offset || 0
    const limit = params?.limit || 10
    const address = params?.address || (await this.getAddress())
    const txMinHeight = undefined
    const txMaxHeight = undefined

    registerCodecs(getPrefix(this.network))

    const txIncomingHistory = (
      await this.cosmosClient.searchTxFromRPC({
        rpcEndpoint: this.getClientUrl().rpc,
        messageAction,
        transferRecipient: address,
        limit: MAX_TX_COUNT,
        txMinHeight,
        txMaxHeight,
      })
    ).txs
    const txOutgoingHistory = (
      await this.cosmosClient.searchTxFromRPC({
        rpcEndpoint: this.getClientUrl().rpc,
        messageAction,
        transferSender: address,
        limit: MAX_TX_COUNT,
        txMinHeight,
        txMaxHeight,
      })
    ).txs

    let history: RPCTxResult[] = [...txIncomingHistory, ...txOutgoingHistory]
      .sort((a, b) => {
        if (a.height !== b.height) return parseInt(b.height) > parseInt(a.height) ? 1 : -1
        if (a.hash !== b.hash) return a.hash > b.hash ? 1 : -1
        return 0
      })
      .reduce(
        (acc, tx) => [...acc, ...(acc.length === 0 || acc[acc.length - 1].hash !== tx.hash ? [tx] : [])],
        [] as RPCTxResult[],
      )
      .filter(params?.filterFn ? params.filterFn : (tx) => tx)
      .filter((_, index) => index < MAX_TX_COUNT)

    // get `total` before filtering txs out for pagination
    const total = history.length

    history = history.filter((_, index) => index >= offset && index < offset + limit)

    const txs = await Promise.all(history.map(({ hash }) => this.getTransactionData(hash, address)))

    return {
      total,
      txs,
    }
  }
}

export { Client }
