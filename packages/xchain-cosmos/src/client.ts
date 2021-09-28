import { PrivKey } from '@thorwallet/cosmos-client'
import {
  Address,
  Network,
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
  FeesParams,
} from '@thorwallet/xchain-client'
import * as xchainCrypto from '@thorwallet/xchain-crypto'
import { Asset, assetToString, baseAmount } from '@thorwallet/xchain-util'
import { CosmosSDKClient } from './cosmos/sdk-client'
import { AssetAtom, AssetMuon } from './types'
import { DECIMAL, getAsset, getDenom, getTxsFromHistory } from './util'

/**
 * Interface for custom Cosmos client
 */
export interface CosmosClient {
  getMainAsset(): Asset
}

const MAINNET_SDK = new CosmosSDKClient({
  server: 'https://api.cosmos.network',
  chainId: 'cosmoshub-3',
})
const TESTNET_SDK = new CosmosSDKClient({
  server: 'http://lcd.gaia.bigdipper.live:1317',
  chainId: 'gaia-3a',
})

/**
 * Custom Cosmos client
 */
class Client implements CosmosClient, XChainClient {
  private network: Network
  private phrase = ''
  private rootDerivationPaths: RootDerivationPaths
  private addrCache: Record<string, Record<number, string>>

  private sdkClients: Map<Network, CosmosSDKClient> = new Map<Network, CosmosSDKClient>()

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
    rootDerivationPaths = {
      [Network.Mainnet]: `44'/118'/0'/0/`,
      [Network.Testnet]: `44'/118'/1'/0/`,
    },
  }: XChainClientParams) {
    this.network = network
    this.rootDerivationPaths = rootDerivationPaths
    this.sdkClients.set(Network.Testnet, TESTNET_SDK)
    this.sdkClients.set(Network.Mainnet, MAINNET_SDK)
    this.addrCache = {}
  }
  getFees(_params?: FeesParams): Promise<Fees> {
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
    } else {
      this.network = network
    }
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
   * Get the explorer url.
   *
   * @returns {string} The explorer url.
   */
  getExplorerUrl(): string {
    switch (this.network) {
      case Network.Mainnet:
        return 'https://cosmos.bigdipper.live'
      case Network.Testnet:
        return 'https://gaia.bigdipper.live'
    }
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address.
   */
  getExplorerAddressUrl(address: Address): string {
    return `${this.getExplorerUrl()}/account/${address}`
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID
   * @returns {string} The explorer url for the given transaction id.
   */
  getExplorerTxUrl(txID: string): string {
    return `${this.getExplorerUrl()}/transactions/${txID}`
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

      this.addrCache[phrase] = {}
      this.phrase = phrase
    }

    return this.getAddress(walletIndex)
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
  private getPrivateKey = (index = 0): Promise<PrivKey> => {
    if (!this.phrase) throw new Error('Phrase not set')

    return this.getSDKClient().getPrivKeyFromMnemonic(this.phrase, this.getFullDerivationPath(index))
  }
  getSDKClient(): CosmosSDKClient {
    return this.sdkClients.get(this.network) || TESTNET_SDK
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
   * Get the current address.
   *
   * @returns {Address} The current address.
   *
   * @throws {Error} Thrown if phrase has not been set before. A phrase is needed to create a wallet and to derive an address from it.
   */
  getAddress = async (index = 0): Promise<string> => {
    if (!this.phrase) throw new Error('Phrase not set')

    if (this.addrCache[this.phrase][index]) {
      return this.addrCache[this.phrase][index]
    }
    const addr = await this.getSDKClient().getAddressFromMnemonic(this.phrase, this.getFullDerivationPath(index))
    this.addrCache[this.phrase][index] = addr
    return addr
  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress(address: Address): boolean {
    return this.getSDKClient().checkAddress(address)
  }

  /**
   * Get the main asset based on the network.
   *
   * @returns {string} The main asset based on the network.
   */
  getMainAsset(): Asset {
    switch (this.network) {
      case Network.Mainnet:
        return AssetAtom
      case Network.Testnet:
        return AssetMuon
    }
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
      const balances = await this.getSDKClient().getBalance(address)
      const mainAsset = this.getMainAsset()

      let assetBalances = balances.map((balance) => {
        return {
          asset: (balance.denom && getAsset(balance.denom)) || mainAsset,
          amount: baseAmount(balance.amount, DECIMAL),
        }
      })

      // make sure we always have the main asset as balance in the array
      if (assetBalances.length === 0) {
        assetBalances = [
          {
            asset: mainAsset,
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
  async getTransactions(params?: TxHistoryParams): Promise<TxsPage> {
    const messageAction = undefined
    const page = (params && params.offset) || undefined
    const limit = (params && params.limit) || undefined
    const txMinHeight = undefined
    const txMaxHeight = undefined

    this.registerCodecs()

    const mainAsset = this.getMainAsset()
    const txHistory = await this.getSDKClient().searchTx({
      messageAction,
      messageSender: (params && params.address) || (await this.getAddress()),
      page,
      limit,
      txMinHeight,
      txMaxHeight,
    })

    return {
      total: parseInt(txHistory.total_count?.toString() || '0'),
      txs: getTxsFromHistory(txHistory.txs || [], mainAsset),
    }
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @returns {Tx} The transaction details of the given transaction id.
   */
  async getTransactionData(txId: string): Promise<Tx> {
    const txResult = await this.getSDKClient().txsHashGet(txId)
    const txs = getTxsFromHistory([txResult], this.getMainAsset())
    if (txs.length === 0) throw new Error('transaction not found')

    return txs[0]
  }

  /**
   * Transfer balances.
   *
   * @param {TxParams} params The transfer options.
   * @returns {TxHash} The transaction hash.
   */
  transfer = async ({ walletIndex, asset, amount, recipient, memo }: TxParams): Promise<TxHash> => {
    const fromAddressIndex = walletIndex || 0
    this.registerCodecs()

    const mainAsset = this.getMainAsset()
    const transferResult = await this.getSDKClient().transfer({
      privkey: await this.getPrivateKey(fromAddressIndex),
      from: await this.getAddress(fromAddressIndex),
      to: recipient,
      amount: amount.amount().toString(),
      asset: getDenom(asset || mainAsset),
      memo,
    })

    return transferResult?.txhash || ''
  }
}

export { Client }
