import { TransactionResponse, Provider } from '@ethersproject/abstract-provider'
import { FeeOptionKey, Network } from '@thorwallet/xchain-client/lib'
import { BaseAmount } from '@thorwallet/xchain-util/lib'
import { BigNumber } from 'ethers'
import { estimateApprove } from './estimate-approve'
import { ethCall } from './eth-call'
import { Address } from './types'
import { Wallet } from './wallet/wallet'
import erc20ABI from './data/erc20.json'
import { estimateGasPrices } from './estimate-gas-prices'

const getGasPrice = async (network: Network, etherscanApiKey: string, feeOptionKey: FeeOptionKey) => {
  const prices = await estimateGasPrices({ network, apiKey: etherscanApiKey })
  const gasPrice = BigNumber.from(prices[feeOptionKey].amount().toFixed())
  return gasPrice
}

export const ethApprove = async ({
  spender,
  sender,
  feeOptionKey,
  amount,
  from,
  wallet,
  provider,
  network,
  etherscanApiKey,
}: {
  spender: Address
  sender: Address
  feeOptionKey: FeeOptionKey
  amount: BaseAmount
  from: Address
  provider: Provider
  wallet: Wallet
  network: Network
  etherscanApiKey: string
}): Promise<TransactionResponse> => {
  const [gasPrice, gasLimit] = await Promise.all([
    getGasPrice(network, etherscanApiKey, feeOptionKey),
    estimateApprove({ spender, sender, amount, from, provider, wallet }).catch(() => undefined),
  ])

  const txAmount = BigNumber.from(amount.amount().toFixed())
  const txResult = await ethCall<TransactionResponse>({
    abi: erc20ABI,
    contractAddress: sender,
    func: 'approve',
    params: [
      spender,
      txAmount,
      {
        from,
        gasPrice,
        gasLimit,
      },
    ],
    provider,
    wallet,
  })

  return txResult
}
