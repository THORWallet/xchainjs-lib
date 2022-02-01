import { Provider } from '@ethersproject/abstract-provider'

import { ethers } from 'ethers'
import { Address } from './types'

export const ethCall = async <T>({
  provider,
  wallet,
  contractAddress,
  abi,
  func,
  params,
}: {
  provider: Provider
  wallet: ethers.Wallet
  contractAddress: Address
  abi: ethers.ContractInterface
  func: string
  params: Array<unknown>
}): Promise<T> => {
  const contract = new ethers.Contract(contractAddress, abi, provider).connect(wallet)
  return contract[func](...params)
}
