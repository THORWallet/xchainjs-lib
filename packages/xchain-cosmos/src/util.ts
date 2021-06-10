import { TxFrom, TxTo, Txs, Fees } from '@thorwallet/xchain-client'
import { Asset, assetToString, baseAmount } from '@thorwallet/xchain-util'
import { cosmos, cosmosclient } from 'cosmos-client'

import { StdTx } from 'cosmos-client/esm/openapi'

import { RawTxResponse, TxResponse, APIQueryParam } from './cosmos/types'
import { AssetAtom, AssetMuon } from './types'

/**
 * The decimal for cosmos chain.
 */
export const DECIMAL = 6

/**
 * Type guard for MsgSend
 *
 * @param {Msg} msg
 * @returns {boolean} `true` or `false`.
 */
export const isMsgSend = (msg: unknown): msg is cosmos.bank.v1beta1.MsgSend =>
  (msg as cosmos.bank.v1beta1.MsgSend)?.amount !== undefined &&
  (msg as cosmos.bank.v1beta1.MsgSend)?.from_address !== undefined &&
  (msg as cosmos.bank.v1beta1.MsgSend)?.to_address !== undefined

/**
 * Type guard for MsgMultiSend
 *
 * @param {Msg} msg
 * @returns {boolean} `true` or `false`.
 */
export const isMsgMultiSend = (msg: unknown): msg is cosmos.bank.v1beta1.MsgMultiSend =>
  (msg as cosmos.bank.v1beta1.MsgMultiSend)?.inputs !== undefined &&
  (msg as cosmos.bank.v1beta1.MsgMultiSend)?.outputs !== undefined

/**
 * Get denomination from Asset
 *
 * @param {Asset} asset
 * @returns {string} The denomination of the given asset.
 */
export const getDenom = (asset: Asset): string => {
  if (assetToString(asset) === assetToString(AssetAtom)) return 'uatom'
  if (assetToString(asset) === assetToString(AssetMuon)) return 'umuon'
  return asset.symbol
}

/**
 * Get Asset from denomination
 *
 * @param {string} denom
 * @returns {Asset|null} The asset of the given denomination.
 */
export const getAsset = (denom: string): Asset | null => {
  if (denom === getDenom(AssetAtom)) return AssetAtom
  if (denom === getDenom(AssetMuon)) return AssetMuon
  return null
}

/**
 * Parse transaction type
 *
 * @param {Array<TxResponse>} txs The transaction response from the node.
 * @param {Asset} mainAsset Current main asset which depends on the network.
 * @returns {Txs} The parsed transaction result.
 */
export const getTxsFromHistory = (txs: Array<TxResponse>, mainAsset: Asset): Txs => {
  return txs.reduce((acc, tx) => {
    let msgs: cosmos.bank.v1beta1.Msg[] = []
    if ((tx.tx as RawTxResponse).body === undefined) {
      msgs = (cosmosclient.codec.unpackAny(cosmosclient.codec.packAny(tx.tx as StdTx)) as {
        msg: cosmos.bank.v1beta1.Msg[]
      }).msg
    } else {
      msgs = (cosmosclient.codec.unpackAny(cosmosclient.codec.packAny(tx.tx)) as RawTxResponse).body.messages
    }

    const from: TxFrom[] = []
    const to: TxTo[] = []
    msgs.map((msg) => {
      if (isMsgSend(msg)) {
        const msgSend = msg as cosmos.bank.v1beta1.MsgSend
        const amount = msgSend.amount
          .map((coin) => baseAmount(coin.amount as string, 6))
          .reduce((acc, cur) => baseAmount(acc.amount().plus(cur.amount()), 6), baseAmount(0, 6))

        let from_index = -1

        from.forEach((value, index) => {
          if (value.from === msgSend.from_address) from_index = index
        })

        if (from_index === -1) {
          from.push({
            from: msgSend.from_address,
            amount,
          })
        } else {
          from[from_index].amount = baseAmount(from[from_index].amount.amount().plus(amount.amount()), 6)
        }

        let to_index = -1

        to.forEach((value, index) => {
          if (value.to === msgSend.to_address) to_index = index
        })

        if (to_index === -1) {
          to.push({
            to: msgSend.to_address,
            amount,
          })
        } else {
          to[to_index].amount = baseAmount(to[to_index].amount.amount().plus(amount.amount()), 6)
        }
      } else if (isMsgMultiSend(msg)) {
        const msgMultiSend = msg as cosmos.bank.v1beta1.MsgMultiSend

        msgMultiSend.inputs.map((input) => {
          const amount = (input?.coins ?? [])
            .map((coin) => baseAmount(coin.amount as string, 6))
            .reduce((acc, cur) => baseAmount(acc.amount().plus(cur.amount()), 6), baseAmount(0, 6))

          let from_index = -1

          from.forEach((value, index) => {
            if (value.from === input.address) from_index = index
          })

          if (from_index === -1) {
            from.push({
              from: input.address as string,
              amount,
            })
          } else {
            from[from_index].amount = baseAmount(from[from_index].amount.amount().plus(amount.amount()), 6)
          }
        })

        msgMultiSend.outputs.map((output) => {
          const amount = (output.coins as cosmos.base.v1beta1.ICoin[])
            .map((coin) => baseAmount(coin.amount as string, 6))
            .reduce((acc, cur) => baseAmount(acc.amount().plus(cur.amount()), 6), baseAmount(0, 6))

          let to_index = -1

          to.forEach((value, index) => {
            if (value.to === output.address) to_index = index
          })

          if (to_index === -1) {
            to.push({
              to: output.address as string,
              amount,
            })
          } else {
            to[to_index].amount = baseAmount(to[to_index].amount.amount().plus(amount.amount()), 6)
          }
        })
      }
    })

    return [
      ...acc,
      {
        asset: mainAsset,
        from,
        to,
        date: new Date(tx.timestamp),
        type: from.length > 0 || to.length > 0 ? 'transfer' : 'unknown',
        hash: tx.txhash || '',
      },
    ]
  }, [] as Txs)
}

/**
 * Get Query String
 *
 * @param {APIQueryParam}
 * @returns {string} The query string.
 */
export const getQueryString = (params: APIQueryParam): string => {
  return Object.keys(params)
    .filter((key) => key.length > 0)
    .map((key) => (params[key] == null ? key : `${key}=${encodeURIComponent(params[key].toString())}`))
    .join('&')
}

/**
 * Get the default fee.
 *
 * @returns {Fees} The default fee.
 */
export const getDefaultFees = (): Fees => {
  return {
    type: 'base',
    fast: baseAmount(750, DECIMAL),
    fastest: baseAmount(2500, DECIMAL),
    average: baseAmount(0, DECIMAL),
  }
}

/**
 * Get address prefix based on the network.
 *
 * @returns {string} The address prefix based on the network.
 *
 **/
export const getPrefix = () => 'cosmos'
