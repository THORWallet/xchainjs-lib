import { Provider } from '@ethersproject/abstract-provider'
import { BaseAmount } from '@thorwallet/xchain-util/lib'
import { BigNumber, BigNumberish, Wallet } from 'ethers'
import { ethCall } from './eth-call'
import { Address } from './types'
import erc20ABI from './data/erc20.json'

export const isApproved = async ({
  provider,
  spender,
  contractAddress,
  amount,
  wallet,
}: {
  provider: Provider
  spender: Address
  contractAddress: Address
  amount: BaseAmount
  wallet: Wallet
}): Promise<boolean> => {
  const txAmount = BigNumber.from(amount.amount().toFixed())
  const allowance = await ethCall<BigNumberish>({
    provider,
    wallet: wallet,
    contractAddress,
    abi: erc20ABI,
    func: 'allowance',
    params: [spender, spender],
  })
  return txAmount.lte(allowance)
}
