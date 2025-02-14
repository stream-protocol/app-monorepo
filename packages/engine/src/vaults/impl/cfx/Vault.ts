/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { defaultAbiCoder } from '@ethersproject/abi';
import { toBigIntHex } from '@onekeyfe/blockchain-libs/dist/basic/bignumber-plus';
import { BaseClient } from '@onekeyfe/blockchain-libs/dist/provider/abc';
import { decrypt } from '@onekeyfe/blockchain-libs/dist/secret/encryptors/aes256';
import {
  PartialTokenInfo,
  UnsignedTx,
} from '@onekeyfe/blockchain-libs/dist/types/provider';
import { IJsonRpcRequest } from '@onekeyfe/cross-inpage-provider-types';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import { Conflux, address as confluxAddress } from 'js-conflux-sdk';
import { isEmpty, isNil, omitBy } from 'lodash';
import memoizee from 'memoizee';

import { getTimeDurationMs } from '@onekeyhq/kit/src/utils/helper';

import {
  InvalidAddress,
  NotImplemented,
  OneKeyInternalError,
} from '../../../errors';
import { extractResponseError, fillUnsignedTx } from '../../../proxy';
import { Account, DBAccount, DBVariantAccount } from '../../../types/account';
import { Token } from '../../../types/token';
import { KeyringSoftwareBase } from '../../keyring/KeyringSoftwareBase';
import {
  IApproveInfo,
  IDecodedTx,
  IDecodedTxAction,
  IDecodedTxActionTokenTransfer,
  IDecodedTxActionType,
  IDecodedTxLegacy,
  IDecodedTxStatus,
  IEncodedTx,
  IEncodedTxUpdateOptions,
  IEncodedTxUpdatePayloadTransfer,
  IEncodedTxUpdateType,
  IFeeInfo,
  IFeeInfoUnit,
  IHistoryTx,
  ISignCredentialOptions,
  ITransferInfo,
  IUnsignedTxPro,
} from '../../types';
import {
  convertFeeGweiToValue,
  convertFeeValueToGwei,
} from '../../utils/feeInfoUtils';
import { VaultBase } from '../../VaultBase';

import { KeyringHardware } from './KeyringHardware';
import { KeyringHd } from './KeyringHd';
import { KeyringImported } from './KeyringImported';
import { KeyringWatching } from './KeyringWatching';
import settings from './settings';
import {
  IEncodedTxCfx,
  IOnChainTransferType,
  ITxOnChainHistoryResp,
} from './types';
import {
  getApiExplorerTransferType,
  getTransactionStatus,
  parseTransaction,
} from './utils';

const TOKEN_TRANSFER_FUNCTION_SIGNATURE = '0xa9059cbb';
const TOKEN_APPROVE_FUNCTION_SIGNATURE = '0x095ea7b3';
const INFINITE_AMOUNT_TEXT = 'Infinite';
const INFINITE_AMOUNT_HEX =
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
// TODO extends evm/Vault
export default class Vault extends VaultBase {
  settings = settings;

  keyringMap = {
    hd: KeyringHd,
    hw: KeyringHardware,
    imported: KeyringImported,
    watching: KeyringWatching,
    external: KeyringWatching,
  };

  getApiExplorerCache = memoizee(async (baseURL) => axios.create({ baseURL }), {
    promise: true,
    max: 1,
    maxAge: getTimeDurationMs({ minute: 3 }),
  });

  getClientCache = memoizee(
    async (rpcUrl, chainId) => this.getConfluxClient(rpcUrl, chainId),
    {
      promise: true,
      max: 1,
      maxAge: getTimeDurationMs({ minute: 3 }),
    },
  );

  async getApiExplorer() {
    const network = await this.engine.getNetwork(this.networkId);
    const baseURL = network.blockExplorerURL.name.replace(
      /(https:\/\/)/,
      `$1${network.isTestnet ? 'api-' : 'api.'}`,
    );
    return this.getApiExplorerCache(baseURL);
  }

  async getClient(url?: string) {
    const { rpcURL } = await this.engine.getNetwork(this.networkId);
    const chainId = await this.getNetworkChainId();
    return this.getClientCache(url ?? rpcURL, chainId);
  }

  getConfluxClient(url: string, chainId: string) {
    return new Conflux({
      url,
      networkId: Number(chainId),
    });
  }

  async attachFeeInfoToEncodedTx(params: {
    encodedTx: IEncodedTxCfx;
    feeInfoValue: IFeeInfoUnit;
  }): Promise<IEncodedTxCfx> {
    const network = await this.getNetwork();
    const { encodedTx, feeInfoValue } = params;
    const { limit, price } = feeInfoValue;
    const encodedTxWithFee: IEncodedTxCfx = {
      ...encodedTx,
    };

    if (!isNil(limit)) {
      encodedTxWithFee.gas = toBigIntHex(new BigNumber(limit));
      encodedTxWithFee.gasLimit = toBigIntHex(new BigNumber(limit));
    }

    if (!isNil(price)) {
      encodedTxWithFee.gasPrice = convertFeeGweiToValue({
        value: (price as string) || '0.000000001',
        network,
      });
    }

    return Promise.resolve(encodedTxWithFee);
  }

  decodedTxToLegacy(decodedTx: IDecodedTx): Promise<IDecodedTxLegacy> {
    return Promise.resolve({} as IDecodedTxLegacy);
  }

  async decodeTx(encodedTx: IEncodedTxCfx, payload?: any): Promise<IDecodedTx> {
    const address = await this.getAccountAddress();
    const network = await this.getNetwork();

    const decodedTx: IDecodedTx = {
      txid: encodedTx.hash || '',
      owner: address,
      signer: encodedTx.from || address,
      nonce: encodedTx.nonce || 0,
      actions: await this.buildEncodedTxActions(encodedTx),
      status: IDecodedTxStatus.Pending,
      networkId: this.networkId,
      accountId: this.accountId,
      encodedTx,
      feeInfo: {
        limit: encodedTx.gasLimit,
        price: convertFeeValueToGwei({
          value: encodedTx.gasPrice ?? '1',
          network,
        }),
        priceValue: encodedTx.gasPrice,
      },
      payload,
      extraInfo: null,
    };

    return decodedTx;
  }

  async buildEncodedTxFromTransfer(
    transferInfo: ITransferInfo,
  ): Promise<IEncodedTxCfx> {
    const network = await this.getNetwork();
    const { amount } = transferInfo;
    const isTransferToken = Boolean(transferInfo.token);
    let amountBN = new BigNumber(amount);
    if (amountBN.isNaN()) {
      amountBN = new BigNumber('0');
    }

    if (isTransferToken) {
      const token = await this.engine.ensureTokenInDB(
        this.networkId,
        transferInfo.token ?? '',
      );
      if (!token) {
        throw new Error(`Token not found: ${transferInfo.token as string}`);
      }

      const amountHex = toBigIntHex(amountBN.shiftedBy(token.decimals));

      const toAddress = `0x${confluxAddress
        .decodeCfxAddress(transferInfo.to)
        .hexAddress.toString('hex')}`;

      const data = `${TOKEN_TRANSFER_FUNCTION_SIGNATURE}${defaultAbiCoder
        .encode(['address', 'uint256'], [toAddress, amountHex])
        .slice(2)}`;

      return {
        from: transferInfo.from,
        to: transferInfo.token ?? '',
        value: '0x0',
        data,
      };
    }
    // native token transfer
    const amountHex = toBigIntHex(amountBN.shiftedBy(network.decimals));
    return {
      from: transferInfo.from,
      to: transferInfo.to,
      value: amountHex,
      data: '0x',
    };
  }

  buildEncodedTxFromApprove(approveInfo: IApproveInfo): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async updateEncodedTxTokenApprove(
    encodedTx: IEncodedTxCfx,
    amount: string,
  ): Promise<IEncodedTx> {
    const decodedTx = await this.decodeTx(encodedTx);
    const action = decodedTx.actions[0];
    if (
      !action ||
      action.type !== IDecodedTxActionType.TOKEN_APPROVE ||
      !action.tokenApprove
    ) {
      throw new Error('Not a approve transaction.');
    }

    const { tokenInfo, spender } = action.tokenApprove;
    let amountHex;
    if (amount === INFINITE_AMOUNT_TEXT || amount === INFINITE_AMOUNT_HEX) {
      amountHex = INFINITE_AMOUNT_HEX;
    } else {
      const amountBN = new BigNumber(amount);
      if (amountBN.isNaN()) {
        throw new Error(`Invalid amount input: ${amount}`);
      }
      amountHex = toBigIntHex(amountBN.shiftedBy(tokenInfo.decimals));
    }

    const data = `${TOKEN_APPROVE_FUNCTION_SIGNATURE}${defaultAbiCoder
      .encode(
        ['address', 'uint256'],
        [
          `0x${confluxAddress
            .decodeCfxAddress(spender)
            .hexAddress.toString('hex')}`,
          amountHex,
        ],
      )
      .slice(2)}`;
    return {
      ...encodedTx,
      data,
    };
  }

  async buildUnsignedTxFromEncodedTx(
    encodedTx: IEncodedTxCfx,
  ): Promise<IUnsignedTxPro> {
    const { from, to, value, data } = encodedTx;
    const client = await this.getClient();

    const [status, nonce, estimate] = await Promise.all([
      client.getStatus(),
      client.getNextNonce(encodedTx.from),
      client.estimateGasAndCollateral({
        from,
        to,
        value,
        data,
      }),
    ]);

    encodedTx.nonce = Number(nonce);
    encodedTx.epochHeight = status.epochNumber;
    encodedTx.chainId = status.chainId;
    encodedTx.storageLimit = new BigNumber(
      estimate.storageCollateralized,
    ).toFixed();

    const unsignedTx: IUnsignedTxPro = {
      inputs: [],
      outputs: [],
      payload: { encodedTx },
      encodedTx,
    };
    return Promise.resolve(unsignedTx);
  }

  async fetchFeeInfo(encodedTx: any): Promise<IFeeInfo> {
    const { gas, gasLimit } = encodedTx;

    const network = await this.getNetwork();
    const client = await this.getClient();
    const { from, to, value, data } = encodedTx;

    const [gasPrice, estimate] = await Promise.all([
      client.getGasPrice(),
      client.estimateGasAndCollateral({
        from,
        to,
        value,
        data,
      }),
    ]);

    const limit = BigNumber.max(
      estimate.gasLimit ?? '0',
      gas ?? '0',
      gasLimit ?? '0',
    ).toFixed();

    return {
      nativeSymbol: network.symbol,
      nativeDecimals: network.decimals,
      feeSymbol: network.feeSymbol,
      feeDecimals: network.feeDecimals,

      limit,
      prices: [
        new BigNumber(gasPrice.toString())
          .shiftedBy(-network.decimals)
          .toFixed(),
      ],
      defaultPresetIndex: '1',
      tx: null,
    };
  }

  async updateEncodedTx(
    encodedTx: IEncodedTxCfx,
    payload: IEncodedTxUpdatePayloadTransfer,
    options: IEncodedTxUpdateOptions,
  ): Promise<IEncodedTx> {
    if (options.type === IEncodedTxUpdateType.transfer) {
      const network = await this.getNetwork();
      encodedTx.value = new BigNumber(payload.amount)
        .shiftedBy(network.decimals)
        .toFixed();
    }
    return Promise.resolve(encodedTx);
  }

  async getExportedCredential(password: string): Promise<string> {
    const dbAccount = await this.getDbAccount();
    if (dbAccount.id.startsWith('hd-') || dbAccount.id.startsWith('imported')) {
      const keyring = this.keyring as KeyringSoftwareBase;
      const [encryptedPrivateKey] = Object.values(
        await keyring.getPrivateKeys(password),
      );
      return `0x${decrypt(password, encryptedPrivateKey).toString('hex')}`;
    }
    throw new OneKeyInternalError(
      'Only credential of HD or imported accounts can be exported',
    );
  }

  override async getOutputAccount(): Promise<Account> {
    const dbAccount = (await this.getDbAccount({
      noCache: true,
    })) as DBVariantAccount;
    const ret = {
      id: dbAccount.id,
      name: dbAccount.name,
      type: dbAccount.type,
      path: dbAccount.path,
      coinType: dbAccount.coinType,
      tokens: [],
      address: dbAccount.addresses?.[this.networkId] || '',
    };
    if (ret.address.length === 0) {
      // TODO: remove selectAccountAddress from proxy
      const address = await this.engine.providerManager.selectAccountAddress(
        this.networkId,
        dbAccount,
      );
      await this.engine.dbApi.addAccountAddress(
        dbAccount.id,
        this.networkId,
        address,
      );
      ret.address = address;
    }
    return ret;
  }

  override async getAccountAddress() {
    const { address } = await this.getOutputAccount();
    return address;
  }

  override async getAccountBalance(tokenIds: Array<string>, withMain = true) {
    const address = await this.getAccountAddress();
    return this.getBalances(
      (withMain ? [{ address }] : []).concat(
        tokenIds.map((tokenAddress) => ({ address, tokenAddress })),
      ),
    );
  }

  override async validateAddress(address: string): Promise<string> {
    const isValid = confluxAddress.isValidCfxAddress(address);
    const normalizedAddress = isValid ? address.toLowerCase() : undefined;

    if (!isValid || typeof normalizedAddress === 'undefined') {
      throw new InvalidAddress();
    }
    return Promise.resolve(normalizedAddress);
  }

  override async fetchOnChainHistory(options: {
    tokenIdOnNetwork?: string;
    localHistory?: IHistoryTx[];
  }): Promise<IHistoryTx[]> {
    const { tokenIdOnNetwork, localHistory = [] } = options;
    const network = await this.getNetwork();
    const apiExplorer = await this.getApiExplorer();
    const client = await this.getClient();
    const address = await this.getAccountAddress();
    const actionsFromTransferHistory: IDecodedTxAction[] = [];

    const transferType = getApiExplorerTransferType(tokenIdOnNetwork);

    const params = omitBy(
      {
        account: address,
        limit: 50,
        transferType,
        contract: tokenIdOnNetwork,
      },
      (value) => isNil(value) || isEmpty(value),
    );

    try {
      const resp = await apiExplorer.get<ITxOnChainHistoryResp>(
        '/account/transfers',
        {
          params,
        },
      );
      if (resp.data.code !== 0) return await Promise.resolve([]);

      const explorerTxs = resp.data.data.list;

      const promises = explorerTxs.map(async (tx) => {
        const historyTxToMerge = localHistory.find(
          (item) => item.decodedTx.txid === tx.transactionHash,
        );

        if (historyTxToMerge && historyTxToMerge.decodedTx.isFinal) {
          return Promise.resolve(null);
        }

        const encodedTx: IEncodedTxCfx = {
          ...tx,
          hash: tx.transactionHash,
          value:
            transferType === IOnChainTransferType.Transfer20
              ? '0x'
              : toBigIntHex(new BigNumber(tx.amount)),
          data: tx.input,
        };

        // If the history record is not requested through the 'transaction' type,
        // additional transaction information needs to be requested
        if (transferType !== IOnChainTransferType.Transaction) {
          const txDetail = await client.getTransactionByHash(
            tx.transactionHash,
          );
          if (txDetail) {
            encodedTx.gasFee = new BigNumber(txDetail.gas)
              .multipliedBy(txDetail.gasPrice)
              .toFixed();
            encodedTx.nonce = new BigNumber(txDetail.nonce).toNumber();
            encodedTx.data = txDetail.data;
            if (transferType === IOnChainTransferType.Transfer20) {
              encodedTx.to = txDetail.to || tx.contract || encodedTx.to;
            }
          }

          // If it is crc20 transfer, the corresponding transaction may be a complex contract call with multiple processes
          // Build and return action directly to avoid further parsing
          if (transferType === IOnChainTransferType.Transfer20) {
            const token = await this.engine.findToken({
              networkId: this.networkId,
              tokenIdOnNetwork: tokenIdOnNetwork as string,
            });
            if (token) {
              actionsFromTransferHistory.push({
                type: IDecodedTxActionType.TOKEN_TRANSFER,
                tokenTransfer: this.buildTokenTransferAction({
                  from: tx.from,
                  to: tx.to,
                  token,
                  amount: tx.amount,
                }),
              });
            }
          }
        }

        const decodedTx: IDecodedTx = {
          txid: encodedTx.hash || '',
          owner: address,
          signer: encodedTx.from || address,
          nonce: encodedTx.nonce || 0,
          actions: actionsFromTransferHistory.length
            ? actionsFromTransferHistory
            : await this.buildEncodedTxActions(encodedTx),
          status: getTransactionStatus(tx.status),
          networkId: this.networkId,
          accountId: this.accountId,
          encodedTx,
          extraInfo: null,
          totalFeeInNative: new BigNumber(encodedTx.gasFee as string)
            .shiftedBy(-network.decimals)
            .toFixed(),
        };

        decodedTx.updatedAt = tx.timestamp * 1000;
        decodedTx.createdAt =
          historyTxToMerge?.decodedTx.createdAt ?? decodedTx.updatedAt;
        decodedTx.isFinal = decodedTx.status === IDecodedTxStatus.Confirmed;

        return this.buildHistoryTx({
          decodedTx,
          historyTxToMerge: {} as IHistoryTx,
        });
      });

      return (await Promise.all(promises)).filter(Boolean);
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  // Chain only functionalities below.

  async buildEncodedTxActions(encodedTx: IEncodedTxCfx) {
    const address = await this.getAccountAddress();
    const client = await this.getClient();
    const { actionType, abiDecodeResult } = await parseTransaction(
      encodedTx,
      client,
    );
    const action: IDecodedTxAction = {
      type: IDecodedTxActionType.UNKNOWN,
      direction: await this.buildTxActionDirection({
        from: encodedTx.from,
        to: encodedTx.to,
        address,
      }),
      unknownAction: {
        extraInfo: {},
      },
    };

    let extraNativeTransferAction: IDecodedTxAction | undefined;
    if (encodedTx.value) {
      const valueBn = new BigNumber(encodedTx.value);
      if (!valueBn.isNaN() && valueBn.gt(0)) {
        extraNativeTransferAction = {
          type: IDecodedTxActionType.NATIVE_TRANSFER,
          nativeTransfer: await this.buildNativeTransferAction(encodedTx),
        };
      }
    }

    if (actionType === IDecodedTxActionType.NATIVE_TRANSFER) {
      action.type = IDecodedTxActionType.NATIVE_TRANSFER;
      action.nativeTransfer = await this.buildNativeTransferAction(encodedTx);
      extraNativeTransferAction = undefined;
    }

    if (
      actionType === IDecodedTxActionType.TOKEN_TRANSFER ||
      actionType === IDecodedTxActionType.TOKEN_APPROVE
    ) {
      const token = await this.engine.findToken({
        networkId: this.networkId,
        tokenIdOnNetwork: encodedTx.to,
      });

      if (token && abiDecodeResult) {
        const { from, to, sender, recipient, amount, spender } =
          abiDecodeResult.object;
        action.type = actionType;
        if (actionType === IDecodedTxActionType.TOKEN_TRANSFER) {
          action.tokenTransfer = this.buildTokenTransferAction({
            from: from ?? sender ?? encodedTx.from ?? address,
            to: to ?? recipient,
            token,
            amount,
          });
        }

        if (actionType === IDecodedTxActionType.TOKEN_APPROVE) {
          action.tokenApprove = this.buildTokenApproveAction({
            owner: encodedTx.from || address,
            spender,
            token,
            amount,
          });
        }
      }
    }

    return [action, extraNativeTransferAction].filter(Boolean);
  }

  async buildNativeTransferAction(encodedTx: IEncodedTxCfx) {
    const nativeToken = await this.engine.getNativeTokenInfo(this.networkId);
    const valueBn = new BigNumber(encodedTx.value);
    const network = await this.getNetwork();
    return {
      tokenInfo: nativeToken,
      from: encodedTx.from,
      to: encodedTx.to,
      amount: valueBn.shiftedBy(-network.decimals).toFixed(),
      amountValue: valueBn.toFixed(),
      extraInfo: null,
    };
  }

  buildTokenTransferAction({
    from,
    to,
    token,
    amount,
  }: {
    from: string;
    to: string;
    token: Token;
    amount: string;
  }) {
    const amountBn = new BigNumber(amount);
    return {
      from,
      to,
      tokenInfo: token,
      amount: amountBn.shiftedBy(-token.decimals).toFixed(),
      amountValue: amountBn.toFixed(),
      extraInfo: null,
    };
  }

  buildTokenApproveAction({
    owner,
    spender,
    token,
    amount,
  }: {
    owner: string;
    spender: string;
    token: Token;
    amount: string;
  }) {
    const amountBn = new BigNumber(amount);
    return {
      owner,
      spender,
      isMax: toBigIntHex(new BigNumber(amount)) === INFINITE_AMOUNT_HEX,
      tokenInfo: token,
      amount: amountBn.shiftedBy(-token.decimals).toFixed(),
      amountValue: amountBn.toFixed(),
      extraInfo: null,
    };
  }

  override async proxyJsonRPCCall<T>(request: IJsonRpcRequest): Promise<T> {
    const client = await this.getClient();
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return client.request(request);
    } catch (e) {
      throw extractResponseError(e);
    }
  }

  override async getClientEndpointStatus(
    url: string,
  ): Promise<{ responseTime: number; latestBlock: number }> {
    const client = await this.getClient(url);
    const start = performance.now();
    const latestBlock = await client.getEpochNumber();
    return { responseTime: Math.floor(performance.now() - start), latestBlock };
  }

  createClientFromURL(url: string): BaseClient {
    throw new NotImplemented();
  }

  fetchTokenInfos(
    tokenAddresses: string[],
  ): Promise<Array<PartialTokenInfo | undefined>> {
    return this.engine.providerManager.getTokenInfos(
      this.networkId,
      tokenAddresses,
    );
  }
}

export type { IEncodedTxCfx };
