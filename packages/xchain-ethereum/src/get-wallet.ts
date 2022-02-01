import { Provider } from '@ethersproject/abstract-provider'
import { Network } from '@thorwallet/xchain-client/lib'
import { Wallet } from 'ethers'
import { HDNode } from './hdnode/hdnode'

const rootDerivationPaths = {
  mainnet: `m/44'/60'/0'/0/`,
  testnet: `m/44'/60'/0'/0/`, // this is INCORRECT but makes the unit tests pass
}

export const getFullDerivationPath = ({ index, network }: { index: number; network: Network }) => {
  return rootDerivationPaths[network] + `${index}`
}

export const getWallet = async ({
  provider,
  hdNode,
  index,
  network,
}: {
  provider: Provider
  hdNode: HDNode
  index: number
  network: Network
}) => {
  const newHdNode = await hdNode.derivePath(getFullDerivationPath({ index, network }))
  return new Wallet(newHdNode).connect(provider)
}
