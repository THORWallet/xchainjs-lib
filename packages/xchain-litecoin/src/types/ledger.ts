import { Address, Network, TxParams } from '@thorwallet/xchain-client'
import { FeeRate } from './client-types'
import { UTXO } from './common'


export type LedgerTxInfo = {
  utxos: UTXO[]
  newTxHex: string
}

export type LedgerTxInfoParams = Pick<TxParams, 'amount' | 'recipient'> & {
  feeRate: FeeRate
  sender: Address
  network: Network
  sochainUrl: string
  nodeApiKey: string
}
