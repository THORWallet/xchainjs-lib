export { getBalance } from './get-balance'
export { getAddress } from './get-address'

export * from './types'
export * from './client'
export {
  broadcastTx,
  // getDerivePath,
  getDefaultFees,
  getDefaultFeesWithRates,
  getPrefix,
  LTC_DECIMAL,
  validateAddress,
  calcFee,
} from './utils'
export { createTxInfo } from './ledger'
