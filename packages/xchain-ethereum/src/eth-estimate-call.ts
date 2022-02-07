import { Provider } from '@ethersproject/abstract-provider'
import { BigNumber } from 'ethers'
import { ethers } from 'ethers'
import { Address } from './types'
import { Wallet } from './wallet/wallet'

export const estimateCall = async (
  provider: Provider,
  wallet: Wallet,
  contractAddress: Address,
  abi: ethers.ContractInterface,
  func: string,
  params: Array<unknown>,
): Promise<BigNumber> => {
  if (!contractAddress) {
    return Promise.reject(new Error('contractAddress must be provided'))
  }
  const contract = new ethers.Contract(contractAddress, abi, provider).connect(wallet)
  return contract.estimateGas[func](...params)
}
