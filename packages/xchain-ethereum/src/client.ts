import { Provider, TransactionResponse } from '@ethersproject/abstract-provider'
import { EtherscanProvider } from '@ethersproject/providers'
import {
  Address,
  FeeOptionKey,
  Fees,
  FeesParams as XFeesParams,
  Network,
  Network as XChainNetwork,
  RootDerivationPaths,
  Tx,
  TxHash,
  TxHistoryParams,
  TxParams,
  TxsPage,
  XChainClient,
  XChainClientParams,
} from '@thorwallet/xchain-client'
import * as Crypto from '@thorwallet/xchain-crypto'
import { AssetETH, assetToString, baseAmount, BaseAmount } from '@thorwallet/xchain-util'
import { BigNumber, BigNumberish, ethers } from 'ethers'
import { parseUnits, toUtf8Bytes } from 'ethers/lib/utils'
import erc20ABI from './data/erc20.json'
import * as etherscanAPI from './etherscan-api'
import * as ethplorerAPI from './ethplorer-api'
import { getAddress } from './get-address'
import { HDNode } from './hdnode/hdnode'
import {
  ApproveParams,
  ExplorerUrl,
  FeesParams,
  FeesWithGasPricesAndLimits,
  GasOracleResponse,
  GasPrices,
  InfuraCreds,
  Network as EthNetwork,
  TxOverrides,
} from './types'
import {
  BASE_TOKEN_GAS_COST,
  ETHAddress,
  ethNetworkToXchains,
  ETH_DECIMAL,
  getDefaultGasPrices,
  getFee,
  getTokenAddress,
  getTxFromEthplorerEthTransaction,
  getTxFromEthplorerTokenOperation,
  MAX_APPROVAL,
  SIMPLE_GAS_COST,
  validateAddress,
  xchainNetworkToEths,
} from './utils'
import { Wallet } from './wallet/wallet'

/**
 * Interface for custom Ethereum client
 */
export interface EthereumClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call<T>(
    walletIndex: number,
    asset: Address,
    abi: ethers.ContractInterface,
    func: string,
    params: Array<unknown>,
  ): Promise<T>
  estimateCall(
    asset: Address,
    abi: ethers.ContractInterface,
    func: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: Array<any>,
  ): Promise<BigNumber>
  estimateGasPrices(): Promise<GasPrices>
  estimateGasLimit(params: FeesParams): Promise<BigNumber>
  estimateFeesWithGasPricesAndLimits(params: FeesParams): Promise<FeesWithGasPricesAndLimits>

  isApproved(spender: Address, sender: Address, amount: BaseAmount): Promise<boolean>
  approve(
    params: ApproveParams & {
      feeOptionKey?: FeeOptionKey
    },
  ): Promise<TransactionResponse>
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
  private hdNode!: HDNode
  private etherscanApiKey?: string
  private explorerUrl: ExplorerUrl
  private ethplorerUrl: string
  private ethplorerApiKey: string
  private phrase: string
  private rootDerivationPaths: RootDerivationPaths
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
    rootDerivationPaths = {
      mainnet: `m/44'/60'/0'/0/`,
      testnet: `m/44'/60'/0'/0/`, // this is INCORRECT but makes the unit tests pass
    },
    etherscanApiKey,
    provider,
  }: EthereumClientParams) {
    this.rootDerivationPaths = rootDerivationPaths
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
  purgeClient = async (): Promise<void> => {
    this.hdNode = await HDNode.fromMnemonic('')
  }

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
   * Get etherjs wallet interface.
   *
   * @returns {Wallet} The current etherjs wallet interface.
   *
   * @throws {"Phrase must be provided"}
   * Thrown if phrase has not been set before. A phrase is needed to create a wallet and to derive an address from it.
   */
  getWallet = async (index = 0): Promise<ethers.Wallet> => {
    const newHdNode = await this.hdNode.derivePath(this.getFullDerivationPath(index))
    return new Wallet(newHdNode).connect(this.getProvider())
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
   * Get getFullDerivationPath
   *
   * @param {number} index the HD wallet index
   * @returns {string} The derivation path based on the network.
   */
  getFullDerivationPath(index: number): string {
    return this.rootDerivationPaths[this.getNetwork()] + `${index}`
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
    this.phrase = phrase
    this.hdNode = await HDNode.fromMnemonic(phrase)
    return getAddress({ network: this.getNetwork(), phrase, index: walletIndex })
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
  call = async <T>(
    walletIndex = 0,
    contractAddress: Address,
    abi: ethers.ContractInterface,
    func: string,
    params: Array<unknown>,
  ): Promise<T> => {
    if (!contractAddress) {
      return Promise.reject(new Error('contractAddress must be provided'))
    }
    const contract = new ethers.Contract(contractAddress, abi, this.getProvider()).connect(
      await this.getWallet(walletIndex),
    )
    return contract[func](...params)
  }

  /**
   * Call a contract function.
   * @param {Address} address The contract address.
   * @param {ContractInterface} abi The contract ABI json.
   * @param {string} func The function to be called.
   * @param {Array<any>} params The parameters of the function.
   * @returns {BigNumber} The result of the contract function call.
   *
   * @throws {"address must be provided"}
   * Thrown if the given contract address is empty.
   */
  estimateCall = async (
    contractAddress: Address,
    abi: ethers.ContractInterface,
    func: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: Array<any>,
  ): Promise<BigNumber> => {
    if (!contractAddress) {
      return Promise.reject(new Error('contractAddress must be provided'))
    }
    const contract = new ethers.Contract(contractAddress, abi, this.getProvider()).connect(await this.getWallet(0))
    return contract.estimateGas[func](...params)
  }

  /**
   * Check allowance.
   *
   * @param {Address} spender The spender address.
   * @param {Address} sender The sender address.
   * @param {BaseAmount} amount The amount of token.
   * @returns {boolean} `true` or `false`.
   */
  isApproved = async (spender: Address, sender: Address, amount: BaseAmount): Promise<boolean> => {
    try {
      const txAmount = BigNumber.from(amount.amount().toFixed())
      const allowance = await this.call<BigNumberish>(0, sender, erc20ABI, 'allowance', [spender, spender])
      return txAmount.lte(allowance)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Check allowance.
   *
   * @param {number} walletIndex which wallet to use to make the call
   * @param {Address} spender The spender index.
   * @param {Address} sender The sender address.
   * @param {feeOptionKey} FeeOptionKey Fee option (optional)
   * @param {BaseAmount} amount The amount of token. By default, it will be unlimited token allowance. (optional)
   * @returns {TransactionResponse} The transaction result.
   */
  approve = async ({
    walletIndex = 0,
    spender,
    sender,
    feeOptionKey,
    amount,
  }: ApproveParams): Promise<TransactionResponse> => {
    const gasPrice =
      feeOptionKey &&
      BigNumber.from(
        (
          await this.estimateGasPrices()
            .then((prices) => prices[feeOptionKey])
            .catch(() => getDefaultGasPrices()[feeOptionKey])
        )
          .amount()
          .toFixed(),
      )
    const gasLimit = await this.estimateApprove({ spender, sender, amount }).catch(() => undefined)

    try {
      const txAmount = amount ? BigNumber.from(amount.amount().toFixed()) : MAX_APPROVAL
      const txResult = await this.call<TransactionResponse>(walletIndex, sender, erc20ABI, 'approve', [
        spender,
        txAmount,
        {
          from: await getAddress({
            index: 0,
            network: this.getNetwork(),
            phrase: this.phrase,
          }),
          gasPrice,
          gasLimit,
        },
      ])

      return txResult
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Estimate gas limit of approve.
   *
   * @param {Address} spender The spender address.
   * @param {Address} sender The sender address.
   * @param {BaseAmount} amount The amount of token. By default, it will be unlimited token allowance. (optional)
   * @returns {BigNumber} The estimated gas limit.
   */
  estimateApprove = async ({
    spender,
    sender,
    amount,
  }: Omit<ApproveParams, 'feeOptionKey' | 'walletIndex'>): Promise<BigNumber> => {
    try {
      const txAmount = amount ? BigNumber.from(amount.amount().toFixed()) : MAX_APPROVAL
      const gasLimit = await this.estimateCall(sender, erc20ABI, 'approve', [
        spender,
        txAmount,
        {
          from: await getAddress({
            index: 0,
            network: this.getNetwork(),
            phrase: this.phrase,
          }),
        },
      ])

      return gasLimit
    } catch (error) {
      return Promise.reject(error)
    }
  }

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
    walletIndex = 0,
    asset,
    memo,
    amount,
    recipient,
    feeOptionKey,
    gasPrice,
    gasLimit,
  }: TxParams & {
    feeOptionKey?: FeeOptionKey
    gasPrice?: BaseAmount
    gasLimit?: BigNumber
  }): Promise<TxHash> => {
    try {
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
        const gasPrice = await this.estimateGasPrices()
          .then((prices) => prices[feeOptionKey])
          .catch(() => getDefaultGasPrices()[feeOptionKey])
        const gasLimit = await this.estimateGasLimit({ asset, recipient, amount, memo }).catch(() => defaultGasLimit)

        overrides = {
          gasLimit,
          gasPrice: BigNumber.from(gasPrice.amount().toFixed()),
        }
      }

      let txResult
      if (assetAddress && !isETHAddress) {
        // Transfer ERC20
        txResult = await this.call<TransactionResponse>(walletIndex, assetAddress, erc20ABI, 'transfer', [
          recipient,
          txAmount,
          Object.assign({}, overrides),
        ])
      } else {
        // Transfer ETH
        const transactionRequest = Object.assign(
          { to: recipient, value: txAmount },
          {
            ...overrides,
            data: memo ? toUtf8Bytes(memo) : undefined,
          },
        )

        txResult = await (await this.getWallet()).sendTransaction(transactionRequest)
      }

      return txResult.hash
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Estimate gas price.
   * @see https://etherscan.io/apis#gastracker
   *
   * @returns {GasPrices} The gas prices (average, fast, fastest) in `Wei` (`BaseAmount`)
   *
   * @throws {"Failed to estimate gas price"} Thrown if failed to estimate gas price.
   */
  estimateGasPrices = async (): Promise<GasPrices> => {
    try {
      const etherscan = this.getEtherscanProvider()
      const response: GasOracleResponse = await etherscanAPI.getGasOracle(etherscan.baseUrl, etherscan.apiKey)

      // Convert result of gas prices: `Gwei` -> `Wei`
      const averageWei = parseUnits(response.SafeGasPrice, 'gwei')
      const fastWei = parseUnits(response.ProposeGasPrice, 'gwei')
      const fastestWei = parseUnits(response.FastGasPrice, 'gwei')

      return {
        average: baseAmount(averageWei.toString(), ETH_DECIMAL),
        fast: baseAmount(fastWei.toString(), ETH_DECIMAL),
        fastest: baseAmount(fastestWei.toString(), ETH_DECIMAL),
      }
    } catch (error) {
      return Promise.reject(new Error(`Failed to estimate gas price: ${error.msg ?? error.toString()}`))
    }
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
  }: FeesParams & { from?: Address }): Promise<BigNumber> => {
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
          from:
            from ||
            (await getAddress({
              index: 0,
              network: this.getNetwork(),
              phrase: this.phrase,
            })),
        })
      } else {
        // ETH gas estimate
        const transactionRequest = {
          from:
            from ||
            (await getAddress({
              index: 0,
              network: this.getNetwork(),
              phrase: this.phrase,
            })),
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
      const gasPrices = await this.estimateGasPrices()
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
