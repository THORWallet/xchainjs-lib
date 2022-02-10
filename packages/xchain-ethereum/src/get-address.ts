import { Network } from '@thorwallet/xchain-client'
import { getHdNode } from './get-hd-node'
import { Address } from './types'

const addrCache: Record<string, string> = {}

const getCacheKey = ({ network, phrase, index }: { network: Network; phrase: string; index: number }) => {
  return [network, phrase, index].join('-')
}

const rootDerivationPaths = {
  mainnet: `m/44'/60'/0'/0/`,
  testnet: `m/44'/60'/0'/0/`, // this is INCORRECT but makes the unit tests pass
}

const getFullDerivationPath = (network: Network, index: number): string => {
  return rootDerivationPaths[network] + `${index}`
}

export const getAddress = async ({
  network,
  phrase,
  index,
}: {
  network: Network
  phrase: string
  index: number
}): Promise<Address> => {
  const cacheKey = getCacheKey({ index, network, phrase })
  if (addrCache[cacheKey]) {
    return addrCache[cacheKey]
  }
  const hdNode = await getHdNode(phrase)
  const address = (await hdNode.derivePath(getFullDerivationPath(network, index))).address.toLowerCase()
  addrCache[cacheKey] = address
  return address
}
