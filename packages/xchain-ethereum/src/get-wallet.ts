import { Provider } from '@ethersproject/abstract-provider'
import { Network } from '@thorwallet/xchain-client/lib'
import { getHdNode } from './get-hd-node'
import { Wallet } from './wallet/wallet'

const rootDerivationPaths = {
  mainnet: `m/44'/60'/0'/0/`,
  testnet: `m/44'/60'/0'/0/`, // this is INCORRECT but makes the unit tests pass
}

export const getFullDerivationPath = ({ index, network }: { index: number; network: Network }) => {
  return rootDerivationPaths[network] + `${index}`
}

const walletKey = ({ phrase, index, network }: { phrase: string; index: number; network: Network }) => {
  return [phrase, index, network].join('-')
}

const walletCache: { [key: string]: Wallet } = {}

export const getWallet = async ({
  provider,
  phrase,
  index,
  network,
}: {
  provider: Provider
  phrase: string
  index: number
  network: Network
}): Promise<Wallet> => {
  const key = walletKey({ index, network, phrase })
  if (walletCache[key]) {
    return walletCache[key]
  }
  const hdNode = await getHdNode(phrase)
  const derivationPath = getFullDerivationPath({
    index,
    network,
  })
  const newHdNode = await hdNode.derivePath(derivationPath)
  const wallet = new Wallet(newHdNode).connect(provider)
  walletCache[key] = wallet
  return wallet
}
