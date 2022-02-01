import { HDNode } from './hdnode/hdnode'

export const getHdNode = async (phrase: string) => {
  const hdNode = await HDNode.fromMnemonic(phrase)
  return hdNode
}
