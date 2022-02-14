import { Asset, BaseAmount } from '@thorwallet/xchain-util'

export type Address = string

export type Network = 'testnet' | 'mainnet'

export type Balance = {
  asset: Asset
  amount: BaseAmount
}

export type Balances = Balance[]

export type TxType = 'transfer' | 'unknown'

export type TxHash = string

export type TxTo = {
  to: Address // address
  amount: BaseAmount // amount
}

export type TxFrom = {
  from: Address | TxHash // address or tx id
  amount: BaseAmount // amount
}

export type Tx = {
  asset: Asset // asset
  from: TxFrom[] // list of "from" txs. BNC will have one `TxFrom` only, `BTC` might have many transactions going "in" (based on UTXO)
  to: TxTo[] // list of "to" transactions. BNC will have one `TxTo` only, `BTC` might have many transactions going "out" (based on UTXO)
  date: Date // timestamp of tx
  type: TxType // type
  hash: string // Tx hash
  ethTokenSymbol: string | null
  ethTokenName: string | null
  ethGasPrice: string | null
  ethGas: string | null
  ethGasUsed: string | null
  ethCumulativeGasUsed: string | null
  confirmations: number | null
  binanceFee: string | null
  memo: string | null
}

export type Txs = Tx[]

export type TxsPage = {
  total: number
  txs: Txs
}

export type TxHistoryParams = {
  address: Address // Address to get history for
  offset?: number // Optional Offset
  limit?: number // Optional Limit of transactions
  startTime?: Date // Optional start time
  asset?: string // Optional asset. Result transactions will be filtered by this asset
}

export type TxParams = {
  walletIndex?: number // send from this HD index
  asset?: Asset
  amount: BaseAmount
  recipient: Address
  memo?: string // optional memo to pass
  gasPrice?: string
  gasLimit?: string
}

// In most cases, clients don't expect any paramter in `getFees`
// but in some cases, they do (e.g. in xchain-ethereum).
// To workaround this, we just define an "empty" (optional) param for now.
// If needed, any client can extend `FeeParams` to add more  (Check `xchain-ethereum` as an example)
// Let me know if we can do it better ... :)
export type FeesParams = { readonly empty?: '' }

export type FeeOptionKey = 'average' | 'fast' | 'fastest'
export type FeeOption = Record<FeeOptionKey, BaseAmount>

export type FeeType =
  | 'byte' // fee will be measured as `BaseAmount` per `byte`
  | 'base' // fee will be "flat" measured in `BaseAmount`

export type Fees = FeeOption & {
  type: FeeType
}

export type RootDerivationPaths = {
  mainnet: string
  testnet: string
}

export type XChainClientParams = Record<string, never>

export interface XChainClient {
  getExplorerUrl(network: Network): string
  getExplorerAddressUrl(network: Network, address: Address): string
  getExplorerTxUrl(network: Network, txID: string): string

  validateAddress(network: Network, address: string): boolean

  getTransactions(network: Network, params: TxHistoryParams): Promise<TxsPage>

  getTransactionData(network: Network, txId: string, assetAddress?: Address): Promise<Tx>

  getFees(network: Network, params: FeesParams): Promise<Fees>

  transfer(params: { network: Network; phrase: string; params: TxParams }): Promise<TxHash>
}
