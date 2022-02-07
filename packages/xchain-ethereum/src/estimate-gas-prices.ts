import * as etherscanAPI from './etherscan-api'
import { baseAmount } from '@thorwallet/xchain-util/lib'
import { parseUnits } from 'ethers/lib/utils'

import { GasOracleResponse, GasPrices } from './types'
import { ETH_DECIMAL } from './utils'
import { Network } from '@thorwallet/xchain-client/lib'

export const estimateGasPrices = async ({
  network,
  apiKey,
}: {
  network: Network
  apiKey: string
}): Promise<GasPrices> => {
  const response: GasOracleResponse = await etherscanAPI.getGasOracle(
    network === 'mainnet' ? 'https://api.etherscan.io' : 'https://api-ropsten.etherscan.io',
    apiKey,
  )

  // Convert result of gas prices: `Gwei` -> `Wei`
  const averageWei = parseUnits(response.SafeGasPrice, 'gwei')
  const fastWei = parseUnits(response.ProposeGasPrice, 'gwei')
  const fastestWei = parseUnits(response.FastGasPrice, 'gwei')

  return {
    average: baseAmount(averageWei.toString(), ETH_DECIMAL),
    fast: baseAmount(fastWei.toString(), ETH_DECIMAL),
    fastest: baseAmount(fastestWei.toString(), ETH_DECIMAL),
  }
}
