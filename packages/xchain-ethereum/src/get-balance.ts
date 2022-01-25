import { EtherscanProvider } from '@ethersproject/providers'
import { Balance, Balances, Network } from '@thorwallet/xchain-client'
import { Asset, AssetETH, assetToString, baseAmount } from '@thorwallet/xchain-util'
import { BigNumber, BigNumberish, ethers } from 'ethers'
import pThrottle from 'p-throttle'
import erc20ABI from './data/erc20.json'
import * as etherscanAPI from './etherscan-api'
import * as ethplorerAPI from './ethplorer-api'
import { Address } from './types'
import { ETH_DECIMAL, getTokenAddress, getTokenBalances } from './utils'

const call = async <T>({
  contractAddress,
  abi,
  func,
  params,
  provider,
}: {
  contractAddress: Address
  abi: ethers.ContractInterface
  func: string
  params: Array<unknown>
  provider: ethers.providers.BaseProvider
}): Promise<T> => {
  if (!contractAddress) {
    return Promise.reject(new Error('contractAddress must be provided'))
  }
  const contract = new ethers.Contract(contractAddress, abi, provider)
  return contract[func](...params)
}

const getMainnetBalances = async ({
  ethplorerApiKey,
  ethplorerUrl,
  address,
}: {
  ethplorerUrl: string
  ethplorerApiKey: string
  address: Address
}): Promise<Balances> => {
  // use ethplorerAPI for mainnet - ignore assets
  const account = await ethplorerAPI.getAddress(ethplorerUrl, address, ethplorerApiKey)

  return getTokenBalances(account.tokens)
}

const getBalanceUnthrottled = async (
  asset: Asset,
  etherscanApiKey: string,
  address: Address,
  provider: ethers.providers.BaseProvider,
): Promise<Balance | null> => {
  const etherscan = new EtherscanProvider('testnet', etherscanApiKey)

  if (assetToString(asset) === assetToString(AssetETH)) {
    return null
  }
  // Handle token balances
  const assetAddress = getTokenAddress(asset)
  if (!assetAddress) {
    throw new Error(`Invalid asset ${asset}`)
  }
  const balance = await etherscanAPI.getTokenBalance({
    baseUrl: etherscan.baseUrl,
    address,
    assetAddress,
    apiKey: etherscan.apiKey,
  })
  const decimals =
    BigNumber.from(
      await call<BigNumberish>({
        contractAddress: assetAddress,
        abi: erc20ABI,
        func: 'decimals',
        params: [],
        provider,
      }),
    ).toNumber() || ETH_DECIMAL

  if (Number.isNaN(decimals)) {
    return null
  }

  return {
    asset,
    amount: baseAmount(balance.toString(), decimals),
  }
}

export const getTestnetBalance = async ({
  etherscanApiKey,
  address,
  provider,
  assets,
}: {
  etherscanApiKey: string
  address: Address
  provider: ethers.providers.BaseProvider
  assets: Asset[]
}): Promise<Balances> => {
  // use etherscan for testnet

  // Follow approach is only for testnet
  // For mainnet, we will use ethplorer api(one request only)
  // https://github.com/xchainjs/xchainjs-lib/issues/252
  // And to avoid etherscan api call limit, it gets balances in a sequence way, not in parallel

  const throttle = pThrottle({
    limit: 5,
    interval: 1000,
  })

  const getBalance = throttle(getBalanceUnthrottled)

  const balances = await Promise.all(assets.map((asset) => getBalance(asset, etherscanApiKey, address, provider)))

  return balances.filter(Boolean)
}

const getEthBalance = async ({
  provider,
  address,
}: {
  provider: ethers.providers.Provider
  address: Address
}): Promise<Balance> => {
  // get ETH balance directly from provider
  const ethBalance: BigNumber = await provider.getBalance(address)
  const ethBalanceAmount = baseAmount(ethBalance.toString(), ETH_DECIMAL)
  return {
    asset: AssetETH,
    amount: ethBalanceAmount,
  }
}

export const getTokenBalance = async ({
  address,
  network,
  assets,
  ethplorerUrl,
  ethplorerApiKey,
  etherscanApiKey,
  provider,
}: {
  address: Address
  network: Network
  assets: Asset[]
  ethplorerUrl: string
  ethplorerApiKey: string
  etherscanApiKey: string
  provider: ethers.providers.BaseProvider
}): Promise<Balances> => {
  if (network === 'mainnet') {
    return getMainnetBalances({ ethplorerApiKey, address, ethplorerUrl })
  }

  return getTestnetBalance({ etherscanApiKey, address, assets, provider })
}

export const getBalance = async ({
  address,
  network,
  assets,
  ethplorerUrl,
  ethplorerApiKey,
  etherscanApiKey,
  provider,
}: {
  address: Address
  network: Network
  assets: Asset[]
  ethplorerUrl: string
  ethplorerApiKey: string
  etherscanApiKey: string
  provider: ethers.providers.BaseProvider
}): Promise<Balances> => {
  const [ethBalance, tokenBalances] = await Promise.all([
    getEthBalance({ provider, address }),
    getTokenBalance({
      address,
      assets,
      etherscanApiKey,
      ethplorerApiKey,
      ethplorerUrl,
      network,
      provider,
    }),
  ])
  return [ethBalance, ...tokenBalances]
}
