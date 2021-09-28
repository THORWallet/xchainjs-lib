import { Address, Network, TxParams } from '@thorwallet/xchain-client'
import { FeeRate } from './client-types'
import { UTXO } from './common'

export type LedgerTxInfo = {
  utxos: UTXO[]
  newTxHex: string
}

export type LedgerTxInfoParams = OnlyRequired<TxParams> & {
  feeRate: FeeRate
  sender: Address
  network: Network
  sochainUrl: string
}
