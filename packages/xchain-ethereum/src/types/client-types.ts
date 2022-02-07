import { ethers, BigNumber } from 'ethers'
import { BaseAmount } from '@thorwallet/xchain-util'
import * as C from '@thorwallet/xchain-client'

export type Address = string

export enum Network {
  TEST = 'ropsten',
  MAIN = 'homestead',
}

export type ClientUrl = {
  testnet: string
  mainnet: string
}

export type ExplorerUrl = {
  testnet: string
  mainnet: string
}

export type TxOverrides = {
  nonce?: ethers.BigNumberish

  // mandatory: https://github.com/ethers-io/ethers.js/issues/469#issuecomment-475926538
  gasLimit: ethers.BigNumberish
  gasPrice?: ethers.BigNumberish
  data?: ethers.BytesLike
  value?: ethers.BigNumberish
}

export type InfuraCreds = {
  projectId: string
  projectSecret?: string
}

export type GasPrices = Record<C.FeeOptionKey, BaseAmount>

export type FeesParams = C.FeesParams & C.TxParams

export type FeesWithGasPricesAndLimits = { fees: C.Fees; gasPrices: GasPrices; gasLimit: BigNumber }
