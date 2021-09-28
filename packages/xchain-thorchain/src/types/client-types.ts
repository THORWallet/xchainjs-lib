import { Network, Tx } from '@thorwallet/xchain-client/lib'
import { Asset, BaseAmount, Chain } from '@thorwallet/xchain-util'

export type NodeUrl = {
  node: string
  rpc: string
}

export type ClientUrl = Record<Network, NodeUrl>

export type ExplorerUrls = {
  root: ExplorerUrl
  tx: ExplorerUrl
  address: ExplorerUrl
}

export type ExplorerUrl = Record<Network, string>

export type ThorchainClientParams = {
  clientUrl?: ClientUrl
  explorerUrls?: ExplorerUrls
}

export type DepositParam = {
  walletIndex?: number
  asset?: Asset
  amount: BaseAmount
  memo: string
}

export const THORChain = 'THOR'
export const AssetRune: Asset = { chain: Chain.THORChain, symbol: 'RUNE', ticker: 'RUNE' }

export type TxData = Pick<Tx, 'from' | 'to' | 'type'>
