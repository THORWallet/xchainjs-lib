import { HDNode } from './hdnode/hdnode'

const hdNodeCache: { [key: string]: HDNode } = {}

export const getHdNode = async (phrase: string) => {
  if (hdNodeCache[phrase]) {
    return hdNodeCache[phrase]
  }
  const hdNode = await HDNode.fromMnemonic(phrase)
  hdNodeCache[phrase] = hdNode
  return hdNode
}
