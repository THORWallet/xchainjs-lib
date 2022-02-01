import { Provider } from '@ethersproject/abstract-provider'
import { EtherscanProvider } from '@ethersproject/providers'
import {
  Address,
  FeeOptionKey,
  Fees,
  FeesParams as XFeesParams,
  Network,
  Network as XChainNetwork,
  Tx,
  TxHash,
  TxHistoryParams,
  TxParams,
  TxsPage,
  XChainClient,
  XChainClientParams,
} from '@thorwallet/xchain-client'
import * as Crypto from '@thorwallet/xchain-crypto'
import { AssetETH, assetToString, BaseAmount } from '@thorwallet/xchain-util'
import { BigNumber, ethers } from 'ethers'
import { toUtf8Bytes } from 'ethers/lib/utils'
import erc20ABI from './data/erc20.json'
import { estimateGasPrices } from './estimate-gas-prices'
import { ethCall } from './eth-call'
import * as etherscanAPI from './etherscan-api'
import * as ethplorerAPI from './ethplorer-api'
import { getAddress } from './get-address'
import { getHdNode } from './get-hd-node'
import {
  ExplorerUrl,
  FeesParams,
  FeesWithGasPricesAndLimits,
  InfuraCreds,
  Network as EthNetwork,
  TxOverrides,
} from './types'
import {
  BASE_TOKEN_GAS_COST,
  ETHAddress,
  ethNetworkToXchains,
  getFee,
  getTokenAddress,
  getTxFromEthplorerEthTransaction,
  getTxFromEthplorerTokenOperation,
  SIMPLE_GAS_COST,
  validateAddress,
  xchainNetworkToEths,
} from './utils'
import { Wallet } from './wallet/wallet'

/**
 * Interface for custom Ethereum client
 */
export interface EthereumClient {
  estimateGasLimit(params: FeesParams): Promise<BigNumber>
  estimateFeesWithGasPricesAndLimits(params: FeesParams): Promise<FeesWithGasPricesAndLimits>
}

export type EthereumClientParams = XChainClientParams & {
  ethplorerUrl?: string
  ethplorerApiKey?: string
  explorerUrl?: ExplorerUrl
  etherscanApiKey?: string
  infuraCreds?: InfuraCreds
  provider: Provider
}

/**
 * Custom Ethereum client
 */
export default class Client implements XChainClient, EthereumClient {
  private network: EthNetwork
  private etherscanApiKey?: string
  private explorerUrl: ExplorerUrl
  private ethplorerUrl: string
  private ethplorerApiKey: string
  private provider: Provider

  /**
   * Constructor
   * @param {EthereumClientParams} params
   */
  constructor({
    network = 'testnet',
    ethplorerUrl = 'https://api.ethplorer.io',
    ethplorerApiKey = 'freekey',
    explorerUrl,

    etherscanApiKey,
    provider,
  }: EthereumClientParams) {
    this.network = xchainNetworkToEths(network)
    this.etherscanApiKey = etherscanApiKey
    this.ethplorerUrl = ethplorerUrl
    this.ethplorerApiKey = ethplorerApiKey
    this.explorerUrl = explorerUrl || this.getDefaultExplorerURL()
    this.provider = provider
  }

  /**
   * Purge client.
   *
   * @returns {void}
   */
  purgeClient = (): void => {}

  /**
   * Set/Update the explorer url.
   *
   * @param {string} url The explorer url.
   * @returns {void}
   */
  setExplorerURL = (url: ExplorerUrl): void => {
    this.explorerUrl = url
  }

  /**
   * Get the current network.
   *
   * @returns {Network} The current network. (`mainnet` or `testnet`)
   */
  getNetwork = (): XChainNetwork => {
    return ethNetworkToXchains(this.network)
  }

  /**
   * Get etherjs Provider interface.
   *
   * @returns {Provider} The current etherjs Provider interface.
   */
  getProvider = (): Provider => {
    return this.provider
  }

  /**
   * Get etherjs EtherscanProvider interface.
   *
   * @returns {EtherscanProvider} The current etherjs EtherscanProvider interface.
   */
  getEtherscanProvider = (): EtherscanProvider => {
    return new EtherscanProvider(this.network, this.etherscanApiKey)
  }

  /**
   * Get the explorer url.
   *
   * @returns {string} The explorer url for ethereum based on the current network.
   */
  getExplorerUrl = (): string => {
    return this.getExplorerUrlByNetwork(this.getNetwork())
  }

  /**
   * Get the explorer url.
   *
   * @returns {ExplorerUrl} The explorer url (both mainnet and testnet) for ethereum.
   */
  private getDefaultExplorerURL = (): ExplorerUrl => {
    return {
      testnet: 'https://ropsten.etherscan.io',
      mainnet: 'https://etherscan.io',
    }
  }

  /**
   * Get the explorer url.
   *
   * @param {Network} network
   * @returns {string} The explorer url for ethereum based on the network.
   */
  private getExplorerUrlByNetwork = (network: Network): string => {
    return this.explorerUrl[network]
  }

  /**
   * Get the explorer url for the given address.
   *
   * @param {Address} address
   * @returns {string} The explorer url for the given address.
   */
  getExplorerAddressUrl = (address: Address): string => {
    return `${this.getExplorerUrl()}/address/${address}`
  }

  /**
   * Get the explorer url for the given transaction id.
   *
   * @param {string} txID
   * @returns {string} The explorer url for the given transaction id.
   */
  getExplorerTxUrl = (txID: string): string => {
    return `${this.getExplorerUrl()}/tx/${txID}`
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
  setNetwork = (network: XChainNetwork): void => {
    if (!network) {
      throw new Error('Network must be provided')
    } else {
      this.network = xchainNetworkToEths(network)
    }
  }

  /**
   * Set/update a new phrase (Eg. If user wants to change wallet)
   *
   * @param {string} phrase A new phrase.
   * @returns {Address} The address from the given phrase
   *
   * @throws {"Invalid phrase"}
   * Thrown if the given phase is invalid.
   */
  setPhrase = async (phrase: string, walletIndex = 0): Promise<Address> => {
    if (!Crypto.validatePhrase(phrase)) {
      throw new Error('Invalid phrase')
    }
    return getAddress({ hdNode: await getHdNode(phrase), network: this.getNetwork(), phrase, index: walletIndex })
  }

  /**
   * Validate the given address.
   *
   * @param {Address} address
   * @returns {boolean} `true` or `false`
   */
  validateAddress = (address: Address): boolean => {
    return validateAddress(address)
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
      const assetAddress = params?.asset

      const maxCount = 10000

      let transations
      const etherscan = this.getEtherscanProvider()

      if (assetAddress) {
        transations = await etherscanAPI.getTokenTransactionHistory({
          baseUrl: etherscan.baseUrl,
          address: params?.address,
          assetAddress,
          page: 0,
          offset: maxCount,
          apiKey: etherscan.apiKey,
        })
      } else {
        transations = await etherscanAPI.getETHTransactionHistory({
          baseUrl: etherscan.baseUrl,
          address: params?.address,
          page: 0,
          offset: maxCount,
          apiKey: etherscan.apiKey,
        })
      }

      return {
        total: transations.length,
        txs: transations,
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Get the transaction details of a given transaction id.
   *
   * @param {string} txId The transaction id.
   * @param {string} assetAddress The asset address. (optional)
   * @returns {Tx} The transaction details of the given transaction id.
   *
   * @throws {"Need to provide valid txId"}
   * Thrown if the given txId is invalid.
   */
  getTransactionData = async (txId: string, assetAddress?: Address): Promise<Tx> => {
    try {
      if (this.getNetwork() === 'mainnet') {
        // use ethplorerAPI for mainnet - ignore assetAddress
        const txInfo = await ethplorerAPI.getTxInfo(this.ethplorerUrl, txId, this.ethplorerApiKey)

        if (txInfo.operations && txInfo.operations.length > 0) {
          const tx = getTxFromEthplorerTokenOperation(txInfo.operations[0])
          if (!tx) {
            throw new Error('Could not parse transaction data')
          }

          return tx
        } else {
          return getTxFromEthplorerEthTransaction(txInfo)
        }
      } else {
        let tx
        const etherscan = this.getEtherscanProvider()
        const txInfo = await etherscan.getTransaction(txId)
        if (txInfo) {
          if (assetAddress) {
            tx =
              (
                await etherscanAPI.getTokenTransactionHistory({
                  baseUrl: etherscan.baseUrl,
                  assetAddress,
                  startblock: txInfo.blockNumber,
                  endblock: txInfo.blockNumber,
                  apiKey: etherscan.apiKey,
                })
              ).filter((info) => info.hash === txId)[0] ?? null
          } else {
            tx =
              (
                await etherscanAPI.getETHTransactionHistory({
                  baseUrl: etherscan.baseUrl,
                  startblock: txInfo.blockNumber,
                  endblock: txInfo.blockNumber,
                  apiKey: etherscan.apiKey,
                  address: txInfo.from,
                })
              ).filter((info) => info.hash === txId)[0] ?? null
          }
        }

        if (!tx) {
          throw new Error('Could not get transaction history')
        }

        return tx
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Call a contract function.
   * @template T The result interface.
   * @param {Address} address The contract address.
   * @param {ContractInterface} abi The contract ABI json.
   * @param {string} func The function to be called.
   * @param {Array<any>} params The parameters of the function.
   * @returns {T} The result of the contract function call.
   *
   * @throws {"address must be provided"}
   * Thrown if the given contract address is empty.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  /**
   * Estimate gas limit of approve.
   *
   * @param {Address} spender The spender address.
   * @param {Address} sender The sender address.
   * @param {BaseAmount} amount The amount of token. By default, it will be unlimited token allowance. (optional)
   * @returns {BigNumber} The estimated gas limit.
   */

  /**
   * Transfer ETH.
   *
   * @param {TxParams} params The transfer options.
   * @param {feeOptionKey} FeeOptionKey Fee option (optional)
   * @param {gasPrice} BaseAmount Gas price (optional)
   * @param {gasLimit} BigNumber Gas limit (optional)
   *
   * A given `feeOptionKey` wins over `gasPrice` and `gasLimit`
   *
   * @returns {TxHash} The transaction hash.
   *
   * @throws {"Invalid asset address"}
   * Thrown if the given asset is invalid.
   */
  transfer = async ({
    asset,
    memo,
    amount,
    recipient,
    feeOptionKey,
    gasPrice,
    gasLimit,
    provider,
    wallet,
    from,
  }: TxParams & {
    feeOptionKey?: FeeOptionKey
    gasPrice?: BaseAmount
    gasLimit?: BigNumber
    provider: Provider
    wallet: Wallet
    from: Address
  }): Promise<TxHash> => {
    const txAmount = BigNumber.from(amount.amount().toFixed())

    let assetAddress
    if (asset && assetToString(asset) !== assetToString(AssetETH)) {
      assetAddress = getTokenAddress(asset)
    }

    const isETHAddress = assetAddress === ETHAddress

    // feeOptionKey

    const defaultGasLimit: ethers.BigNumber = isETHAddress ? SIMPLE_GAS_COST : BASE_TOKEN_GAS_COST

    let overrides: TxOverrides = {
      gasLimit: gasLimit || defaultGasLimit,
      gasPrice: gasPrice && BigNumber.from(gasPrice.amount().toFixed()),
    }

    // override `overrides` if `feeOptionKey` is provided
    if (feeOptionKey) {
      const gasPrice = await estimateGasPrices({ network: this.getNetwork(), apiKey: this.etherscanApiKey }).then(
        (prices) => prices[feeOptionKey],
      )
      const gasLimit = await this.estimateGasLimit({ asset, recipient, amount, memo, from }).catch(
        () => defaultGasLimit,
      )

      overrides = {
        gasLimit,
        gasPrice: BigNumber.from(gasPrice.amount().toFixed()),
      }
    }

    let txResult
    if (assetAddress && !isETHAddress) {
      // Transfer ERC20
      txResult = await ethCall({
        provider,
        abi: erc20ABI,
        contractAddress: assetAddress,
        func: 'transfer',
        params: [recipient, txAmount, Object.assign({}, overrides)],
        wallet: wallet,
      })
    } else {
      // Transfer ETH
      const transactionRequest = Object.assign(
        { to: recipient, value: txAmount },
        {
          ...overrides,
          data: memo ? toUtf8Bytes(memo) : undefined,
        },
      )

      txResult = await wallet.sendTransaction(transactionRequest)
    }

    return (txResult as { hash: string }).hash
  }

  /**
   * Estimate gas.
   *
   * @param {FeesParams} params The transaction options.
   * @returns {BaseAmount} The estimated gas fee.
   *
   * @throws {"Failed to estimate gas limit"} Thrown if failed to estimate gas limit.
   */
  estimateGasLimit = async ({
    asset,
    recipient,
    amount,
    memo,
    from,
  }: FeesParams & { from: Address }): Promise<BigNumber> => {
    try {
      const txAmount = BigNumber.from(amount.amount().toFixed())

      let assetAddress
      if (asset && assetToString(asset) !== assetToString(AssetETH)) {
        assetAddress = getTokenAddress(asset)
      }

      let estimate

      if (assetAddress && assetAddress !== ETHAddress) {
        // ERC20 gas estimate
        const contract = new ethers.Contract(assetAddress, erc20ABI, this.getProvider())

        estimate = await contract.estimateGas.transfer(recipient, txAmount, {
          from: from,
        })
      } else {
        // ETH gas estimate
        const transactionRequest = {
          from: from,
          to: recipient,
          value: txAmount,
          data: memo ? toUtf8Bytes(memo) : undefined,
        }

        estimate = await this.getProvider().estimateGas(transactionRequest)
      }

      return estimate
    } catch (error) {
      return Promise.reject(new Error(`Failed to estimate gas limit: ${error.msg ?? error.toString()}`))
    }
  }

  /**
   * Estimate gas prices/limits (average, fast fastest).
   *
   * @param {FeesParams} params
   * @returns {FeesWithGasPricesAndLimits} The estimated gas prices/limits.
   *
   * @throws {"Failed to estimate fees, gas price, gas limit"} Thrown if failed to estimate fees, gas price, gas limit.
   */
  estimateFeesWithGasPricesAndLimits = async (
    params: FeesParams & { from?: string },
  ): Promise<FeesWithGasPricesAndLimits> => {
    try {
      // gas prices
      const gasPrices = await estimateGasPrices({ network: this.getNetwork(), apiKey: this.etherscanApiKey })
      const { fast: fastGP, fastest: fastestGP, average: averageGP } = gasPrices

      // gas limits
      const gasLimit = await this.estimateGasLimit({
        asset: params.asset,
        amount: params.amount,
        recipient: params.recipient,
        memo: params.memo,
        from: params.from,
      })

      return {
        gasPrices,
        fees: {
          type: 'byte',
          average: getFee({ gasPrice: averageGP, gasLimit }),
          fast: getFee({ gasPrice: fastGP, gasLimit }),
          fastest: getFee({ gasPrice: fastestGP, gasLimit }),
        },
        gasLimit,
      }
    } catch (error) {
      return Promise.reject(
        new Error(`Failed to estimate fees, gas price, gas limit: ${error.msg ?? error.toString()}`),
      )
    }
  }

  /**
   * Get fees.
   *
   * @param {FeesParams} params
   * @returns {Fees} The average/fast/fastest fees.
   *
   * @throws {"Failed to get fees"} Thrown if failed to get fees.
   */
  getFees = async (params: XFeesParams & FeesParams): Promise<Fees> => {
    if (!params) return Promise.reject('Params need to be passed')

    try {
      const { fees } = await this.estimateFeesWithGasPricesAndLimits(params)
      return fees
    } catch (error) {
      return Promise.reject(new Error(`Failed to get fees: ${error.msg ?? error.toString()}`))
    }
  }
}

export { Client }
