import { BigNumber } from 'ethers'
import erc20ABI from './data/erc20.json'
import { estimateCall } from './eth-estimate-call'
import { Provider } from '@ethersproject/abstract-provider'
import { Wallet } from './wallet/wallet'
import { Address } from '@thorwallet/xchain-client/lib'
import { BaseAmount } from '@thorwallet/xchain-util/lib'

export const estimateApprove = async ({
  spender,
  sender,
  amount,
  provider,
  wallet,
  from,
}: {
  spender: Address
  sender: Address
  provider: Provider
  wallet: Wallet
  from: Address
  amount: BaseAmount
}): Promise<BigNumber> => {
  const txAmount = BigNumber.from(amount.amount().toFixed())
  const gasLimit = await estimateCall(provider, wallet, sender, erc20ABI, 'approve', [
    spender,
    txAmount,
    {
      from,
    },
  ])

  return gasLimit
}
