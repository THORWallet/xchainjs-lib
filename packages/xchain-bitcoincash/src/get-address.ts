import { Address, Network } from '@thorwallet/xchain-client/lib'
import { bip32, getSeed } from '@thorwallet/xchain-crypto/lib'
import { KeyPair } from './types/bitcoincashjs-types'
const BigInteger = require('bigi')
const bitcash = require('@psf/bitcoincashjs-lib')
import * as utils from './utils'

const addrCache: Record<string, string> = {}

const getCacheKey = ({ network, phrase, index }: { network: Network; phrase: string; index: number }) => {
  return [network, phrase, index].join('-')
}
const ENABLE_FAST = true

const rootDerivationPaths = {
  mainnet: `m/44'/145'/0'/0/`,
  testnet: `m/44'/1'/0'/0/`,
}

const getBCHKeys = async (network: Network, phrase: string, derivationPath: string): Promise<KeyPair> => {
  try {
    const rootSeed = await getSeed(phrase)
    if (ENABLE_FAST) {
      const master = await (await bip32.fromSeed(rootSeed, utils.bchNetwork(network))).derivePath(derivationPath)
      const d: Buffer = BigInteger.fromBuffer(master.privateKey)
      const btcKeyPair = new bitcash.ECPair(d, null, {
        network: utils.bchNetwork(network),
        compressed: true,
      })
      return btcKeyPair
    }

    const masterHDNode = bitcash.HDNode.fromSeedBuffer(rootSeed, utils.bchNetwork(network))
    const keyPair = await masterHDNode.derivePath(derivationPath).keyPair
    return keyPair
  } catch (error) {
    throw new Error(`Getting key pair failed: ${error?.message || error.toString()}`)
  }
}

const getFullDerivationPath = (network: Network, index: number): string => {
  return rootDerivationPaths[network] + `${index}`
}

export const getAddress = async ({
  network,
  phrase,
  index = 0,
}: {
  network: Network
  phrase: string
  index?: number
}): Promise<Address> => {
  const cacheKey = getCacheKey({
    index,
    network,
    phrase,
  })
  if (addrCache[cacheKey]) {
    return addrCache[cacheKey]
  }
  const keys = await getBCHKeys(network, phrase, getFullDerivationPath(network, index))
  const address = await keys.getAddress(index)

  const addr = utils.stripPrefix(utils.toCashAddress(address))
  addrCache[cacheKey] = addr
  return addr
}
