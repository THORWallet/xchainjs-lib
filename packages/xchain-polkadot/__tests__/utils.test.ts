import { getDefaultFees } from '../src/util'
import { baseAmount } from '@thorwallet/xchain-util'


describe('Utils Test', () => {
  it('get default fees', async () => {
    const fees = await getDefaultFees('testnet' as Network)

    expect(fees.type).toEqual('byte')
    expect(fees.average.amount().isEqualTo(baseAmount('15000000000', 12).amount())).toBeTruthy()
    expect(fees.fast.amount().isEqualTo(baseAmount('15000000000', 12).amount())).toBeTruthy()
    expect(fees.fastest.amount().isEqualTo(baseAmount('15000000000', 12).amount())).toBeTruthy()
  })
})
