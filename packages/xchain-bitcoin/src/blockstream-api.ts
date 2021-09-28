import axios from 'axios'

import { BroadcastTxParams } from './types/common'
enum Network {
  Mainnet = 'mainnet',
  Testnet = 'testnet',
}

/**
 * Broadcast transaction.
 *
 * @see https://github.com/Blockstream/esplora/blob/master/API.md#post-tx
 *
 * @param {string} params
 * @returns {string} Transaction ID.
 */
export const broadcastTx = async ({ network, txHex, blockstreamUrl }: BroadcastTxParams): Promise<string> => {
  const url = (() => {
    switch (network) {
      case Network.Mainnet:
        return `${blockstreamUrl}/api/tx`
      case Network.Testnet:
        return `${blockstreamUrl}/testnet/api/tx`
      default:
        throw new Error('no net')
    }
  })()
  const txid: string = (await axios.post(url, txHex)).data
  return txid
}
