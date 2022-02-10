import { Network } from '@thorwallet/xchain-client/lib'
import { MAINNET_SDK, TESTNET_SDK } from '../sdk-clients'

const addrCache: Record<string, string> = {}

const getCacheKey = ({ network, phrase, index }: { network: Network; phrase: string; index: number }) => {
  return [network, phrase, index].join('-')
}

const getFullDerivationPath = (network: string, index: number): string => {
  return (
    {
      mainnet: `44'/118'/0'/0/`,
      testnet: `44'/118'/1'/0/`,
    }[network] + `${index}`
  )
}

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

  const sdk = network === 'mainnet' ? MAINNET_SDK : TESTNET_SDK

  const addr = await sdk.getAddressFromMnemonic(phrase, getFullDerivationPath(network, index))
  addrCache[cacheKey] = addr
  return addr
}
