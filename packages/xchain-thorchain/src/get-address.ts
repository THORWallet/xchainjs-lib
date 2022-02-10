import { Network } from '@thorwallet/xchain-client/lib'
import { CosmosSDKClient } from '@thorwallet/xchain-cosmos/lib'
import { getDefaultClientUrl } from './util'

const addrCache: Record<string, string> = {}

const getCacheKey = ({ network, phrase, index }: { network: Network; phrase: string; index: number }) => {
  return [network, phrase, index].join('-')
}

const rootDerivationPaths = {
  mainnet: "44'/931'/0'/0/",
  testnet: "44'/931'/0'/0/",
}

const getFullDerivationPath = (network: Network, index: number): string => {
  return rootDerivationPaths[network] + `${index}`
}

const getPrefix = (network: string) => (network === 'testnet' ? 'tthor' : 'thor')

export const getAddress = async ({
  network,
  phrase,
  index,
}: {
  network: Network
  phrase: string
  index: number
}): Promise<string> => {
  const cacheKey = getCacheKey({ index, network, phrase })
  if (addrCache[cacheKey]) {
    return addrCache[cacheKey]
  }
  const cosmosClient = new CosmosSDKClient({
    server: getDefaultClientUrl()[network].node,
    chainId: 'thorchain',
    prefix: getPrefix(network),
  })

  const address = await cosmosClient.getAddressFromMnemonic(phrase, getFullDerivationPath(network, index))

  if (!address) {
    throw new Error('address not defined')
  }
  addrCache[cacheKey] = address
  return address
}
