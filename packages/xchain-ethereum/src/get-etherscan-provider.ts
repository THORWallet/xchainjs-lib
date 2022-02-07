import { EtherscanProvider } from '@ethersproject/providers'
import { Network } from '@thorwallet/xchain-client/lib'

export const getEtherscanProvider = (network: Network, etherscanApiKey: string): EtherscanProvider => {
  return new EtherscanProvider(network, etherscanApiKey)
}
