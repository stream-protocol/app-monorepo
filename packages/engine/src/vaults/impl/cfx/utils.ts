import { hexZeroPad } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';
import { SignedTx } from '@onekeyfe/blockchain-libs/dist/types/provider';
import { Transaction } from 'js-conflux-sdk';
import { Conflux, Contract } from 'js-conflux-sdk/dist/types/index';
import memoizee from 'memoizee';

import { Signer } from '../../../proxy';
import {
  IDecodedTxActionType,
  IDecodedTxStatus,
  IUnsignedTxPro,
} from '../../types';

import {
  IEncodedTxCfx,
  IOnChainTransferType,
  ITxAbiDecodeResult,
} from './types';

const getCodeCache = memoizee(
  async (to: string, client: Conflux) => client.getCode(to),
  { promise: true },
);

export async function isCfxNativeTransferType(
  options: { data: string; to: string },
  client: Conflux,
) {
  const { data, to } = options;

  if (to) {
    const code = await getCodeCache(to, client);
    if (code === '0x') return true;
  }
  return !data || data === '0x' || data === '0x0' || data === '0';
}

export async function signTransaction(
  unsignedTx: IUnsignedTxPro,
  signer: Signer,
): Promise<SignedTx> {
  const unsignedTransaction = new Transaction(
    unsignedTx.encodedTx as IEncodedTxCfx,
  );
  const digest = keccak256(unsignedTransaction.encode(false));

  const [sig, recoveryParam] = await signer.sign(
    Buffer.from(digest.slice(2), 'hex'),
  );
  const [r, s]: [Buffer, Buffer] = [sig.slice(0, 32), sig.slice(32)];

  const signedTransaction = new Transaction({
    ...(unsignedTx.encodedTx as IEncodedTxCfx),
    r: hexZeroPad(`0x${r.toString('hex')}`, 32),
    s: hexZeroPad(`0x${s.toString('hex')}`, 32),
    v: recoveryParam,
  });

  return {
    txid: signedTransaction.hash,
    rawTx: signedTransaction.serialize(),
  };
}

export async function parseTransaction(
  encodedTx: IEncodedTxCfx,
  client: Conflux,
): Promise<{
  actionType: IDecodedTxActionType;
  abiDecodeResult: ITxAbiDecodeResult | null;
}> {
  if (
    await isCfxNativeTransferType(
      { data: encodedTx.data, to: encodedTx.to },
      client,
    )
  ) {
    return {
      actionType: IDecodedTxActionType.NATIVE_TRANSFER,
      abiDecodeResult: null,
    };
  }

  try {
    const crc20: Contract = client.CRC20(encodedTx.to);
    let txType = IDecodedTxActionType.UNKNOWN;
    const abiDecodeResult = crc20.abi.decodeData(encodedTx.data);
    if (abiDecodeResult) {
      switch (abiDecodeResult.name) {
        case 'transfer': {
          txType = IDecodedTxActionType.TOKEN_TRANSFER;
          break;
        }
        case 'transferFrom': {
          txType = IDecodedTxActionType.TOKEN_TRANSFER;

          const { sender, recipient } = abiDecodeResult.object;

          if (sender !== encodedTx.from && recipient !== encodedTx.from) {
            return {
              actionType: IDecodedTxActionType.UNKNOWN,
              abiDecodeResult: null,
            };
          }
          break;
        }
        case 'approve': {
          txType = IDecodedTxActionType.TOKEN_APPROVE;
          break;
        }
        default: {
          txType = IDecodedTxActionType.UNKNOWN;
        }
      }
    }
    return {
      actionType: txType,
      abiDecodeResult,
    };
  } catch (error) {
    return {
      actionType: IDecodedTxActionType.UNKNOWN,
      abiDecodeResult: null,
    };
  }
}

export function getTransactionStatus(status: number | null | undefined) {
  switch (status) {
    case 0:
      return IDecodedTxStatus.Confirmed;
    case 1:
      return IDecodedTxStatus.Failed;
    case 2:
    case null:
      return IDecodedTxStatus.Dropped;
    default:
      return IDecodedTxStatus.Confirmed;
  }
}

export function getApiExplorerTransferType(
  tokenIdOnNetwork: string | undefined,
) {
  if (tokenIdOnNetwork) return IOnChainTransferType.Transfer20;

  if (tokenIdOnNetwork === '') return IOnChainTransferType.Call;

  return IOnChainTransferType.Transaction;
}
