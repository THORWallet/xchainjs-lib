import axios from 'axios'
import * as BIP32 from 'bip32'

import { TxHistoryParams } from '@thorwallet/xchain-client'
import * as xchainCrypto from '@thorwallet/xchain-crypto'

import { cosmosclient, cosmos } from 'cosmos-client'
import { BroadcastTxCommitResult, Coin, StdTx, TransactionsApiFp } from 'cosmos-client/esm/openapi'

import {
  APIQueryParam,
  SearchTxParams,
  TransferParams,
  TxHistoryResponse,
  CosmosSDKClientParams,
  TxResponse,
  RPCTxSearchResult,
  RPCResponse,
} from './types'
import { getQueryString } from '../util'
import { setBech32Prefix } from 'cosmos-client/cjs/config/module'
import { AuthApiFp, BankApiFp } from 'cosmos-client/cjs/openapi/api'

export class CosmosSDKClient {
  sdk: cosmosclient.CosmosSDK

  server: string
  chainId: string

  prefix = ''

  // by default, cosmos chain
  constructor({ server, chainId, prefix = 'cosmos' }: CosmosSDKClientParams) {
    this.server = server
    this.chainId = chainId
    this.prefix = prefix
    this.sdk = new cosmosclient.CosmosSDK(this.server, this.chainId)
  }

  updatePrefix = (prefix: string) => {
    this.prefix = prefix
    this.setPrefix()
  }

  setPrefix = (): void => {
    setBech32Prefix({
      accAddr: this.prefix,
      accPub: this.prefix + 'pub',
      valAddr: this.prefix + 'valoper',
      valPub: this.prefix + 'valoperpub',
      consAddr: this.prefix + 'valcons',
      consPub: this.prefix + 'valconspub',
    })
  }

  getAddressFromPrivKey = (privkey: cosmosclient.PrivKey): string => {
    this.setPrefix()

    return privkey.pubKey().address().toString()
  }

  getAddressFromMnemonic = (mnemonic: string, derivationPath: string): string => {
    this.setPrefix()
    const privKey = this.getPrivKeyFromMnemonic(mnemonic, derivationPath)

    return privKey.pubKey().address().toString()
  }

  getPrivKeyFromMnemonic = (mnemonic: string, derivationPath: string): cosmosclient.secp256k1.PrivKey => {
    const seed = xchainCrypto.getSeed(mnemonic)
    const node = BIP32.fromSeed(seed)
    const child = node.derivePath(derivationPath)

    if (!child.privateKey) {
      throw new Error('child does not have a privateKey')
    }

    return new cosmosclient.secp256k1.PrivKey({
      key: child.privateKey,
    })
  }

  checkAddress = (address: string): boolean => {
    try {
      this.setPrefix()

      if (!address.startsWith(this.prefix)) {
        return false
      }

      return cosmosclient.AccAddress.fromString(address).toString() === address
    } catch (err) {
      return false
    }
  }

  getBalance = async (address: string): Promise<Coin[]> => {
    try {
      this.setPrefix()

      const accAddress = cosmosclient.AccAddress.fromString(address)

      const req = await BankApiFp().bankBalancesAddressGet(accAddress.toString())
      const resp = await req()
      return resp.data
    } catch (error) {
      return Promise.reject(error)
    }
  }

  searchTx = async ({
    messageAction,
    messageSender,
    page,
    limit,
    txMinHeight,
    txMaxHeight,
  }: SearchTxParams): Promise<TxHistoryResponse> => {
    try {
      const queryParameter: APIQueryParam = {}
      if (messageAction !== undefined) {
        queryParameter['message.action'] = messageAction
      }
      if (messageSender !== undefined) {
        queryParameter['message.sender'] = messageSender
      }
      if (page !== undefined) {
        queryParameter['page'] = page.toString()
      }
      if (limit !== undefined) {
        queryParameter['limit'] = limit.toString()
      }
      if (txMinHeight !== undefined) {
        queryParameter['tx.minheight'] = txMinHeight.toString()
      }
      if (txMaxHeight !== undefined) {
        queryParameter['tx.maxheight'] = txMaxHeight.toString()
      }

      this.setPrefix()

      return await axios
        .get<TxHistoryParams>(`${this.server}/txs?${getQueryString(queryParameter)}`)
        .then((res) => res.data)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  searchTxFromRPC = async ({
    messageAction,
    messageSender,
    transferSender,
    transferRecipient,
    page,
    limit,
    txMinHeight,
    txMaxHeight,
    rpcEndpoint,
  }: SearchTxParams & {
    rpcEndpoint: string
  }): Promise<RPCTxSearchResult> => {
    try {
      const queryParameter: string[] = []
      if (messageAction !== undefined) {
        queryParameter.push(`message.action='${messageAction}'`)
      }
      if (messageSender !== undefined) {
        queryParameter.push(`message.sender='${messageSender}'`)
      }
      if (transferSender !== undefined) {
        queryParameter.push(`transfer.sender='${transferSender}'`)
      }
      if (transferRecipient !== undefined) {
        queryParameter.push(`transfer.recipient='${transferRecipient}'`)
      }
      if (txMinHeight !== undefined) {
        queryParameter.push(`tx.height>='${txMinHeight}'`)
      }
      if (txMaxHeight !== undefined) {
        queryParameter.push(`tx.height<='${txMaxHeight}'`)
      }

      const searchParameter: string[] = []
      searchParameter.push(`query="${queryParameter.join(' AND ')}"`)

      if (page !== undefined) {
        searchParameter.push(`page="${page}"`)
      }
      if (limit !== undefined) {
        searchParameter.push(`per_page="${limit}"`)
      }
      searchParameter.push(`order_by="desc"`)

      const response: RPCResponse<RPCTxSearchResult> = await axios
        .get(`${rpcEndpoint}/tx_search?${searchParameter.join('&')}`)
        .then((res) => res.data)

      return response.result
    } catch (error) {
      return Promise.reject(error)
    }
  }

  txsHashGet = async (hash: string): Promise<TxResponse> => {
    try {
      this.setPrefix()

      return await axios.get<TxResponse>(`${this.server}/txs/${hash}`).then((res) => res.data)
    } catch (error) {
      throw new Error('transaction not found')
    }
  }

  transfer = async ({
    privkey,
    from,
    to,
    amount,
    asset,
    memo = '',
    fee = {
      amount: [],
      gas: '200000',
    },
  }: TransferParams): Promise<BroadcastTxCommitResult> => {
    try {
      this.setPrefix()

      const unsignedStdTx: StdTx = {
        msg: [
          JSON.stringify(
            new cosmos.bank.v1beta1.MsgSend({
              from_address: from,
              to_address: to,
              amount: [
                {
                  amount: amount.toString(),
                  denom: asset,
                },
              ],
            }).toJSON(),
          ),
        ],
        fee,
        signature: {
          account_number: 'todo',
          sequence: 'hi',
        },
        memo,
      }

      return this.signAndBroadcast(unsignedStdTx, privkey, cosmosclient.AccAddress.fromString(from))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  signAndBroadcast = async (
    _unsignedStdTx: StdTx,
    privkey: cosmosclient.PrivKey,
    signer: cosmosclient.AccAddress,
  ): Promise<BroadcastTxCommitResult> => {
    try {
      this.setPrefix()

      const account = await (await AuthApiFp().authAccountsAddressGet(signer.toString()))()

      const txsPost = await TransactionsApiFp().txsPost({
        mode: 'block',
        tx: {
          signature: {
            account_number: account.data.value?.account_number as string,
            pub_key: {
              value: privkey.pubKey().bytes.toString(),
            },
            sequence: account.data.value?.sequence?.toString() as string,
            signature: 'hihi',
          },
        },
      })

      const { data } = await txsPost()

      return data
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
