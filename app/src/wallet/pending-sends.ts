import Storage from 'expo-sqlite/kv-store';
import { isHash, type Address, type Hash } from 'viem';

import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';
import { multiBaasTransactionActivityProvider } from './transaction-activity-multibaas';
import type { TransactionActivityItem, TransactionActivityProvider } from './transaction-activity';
import type { SendAsset } from './send-transfer';

const STORAGE_KEY = 'sodera:pending-sends:v1';

export type PendingSend = {
  account: Address;
  userOperationHash: Hash;
  transactionHash: Hash | null;
  recipient: Address;
  asset: SendAsset;
  amount: string;
  timestamp: string;
  status: 'submitted' | 'confirmed' | 'failed';
  /** Set for Pay with: the asset swapped from, and at most how much of it (decimal string). */
  payAsset?: SendAsset;
  maxPayAmount?: string;
};

/** A local row for a send the indexer may not have seen yet. */
function localItem(entry: PendingSend): TransactionActivityItem {
  const base = {
    id: `pending:${entry.userOperationHash}`,
    transactionHash: entry.transactionHash,
    userOperationHash: entry.userOperationHash,
    status: entry.status,
    asset: entry.asset,
    amount: entry.amount,
    counterparty: entry.recipient,
    timestamp: entry.timestamp,
    blockNumber: 0,
    operation: null,
  };
  return entry.payAsset && entry.payAsset !== entry.asset
    ? {
        ...base,
        kind: 'payment',
        paidAsset: entry.payAsset,
        paidAmount: entry.maxPayAmount ?? null,
        paidAmountIsMaximum: true,
      }
    : { ...base, kind: 'transfer', direction: 'sent' };
}

type PendingSendStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

export function createPendingSends({ storage = Storage, identityStorage = walletIdentityNativeStorage, activity = multiBaasTransactionActivityProvider, lookup = lookupUserOperation }: {
  storage?: PendingSendStorage;
  identityStorage?: WalletIdentityStorage;
  activity?: TransactionActivityProvider;
  lookup?: (hash: Hash) => Promise<{ success: boolean; transactionHash: Hash } | null>;
} = {}) {
  const listeners = new Set<() => void>();
  let writes = Promise.resolve();
  const read = async (): Promise<PendingSend[]> => {
    const value = await storage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as PendingSend[] : [];
  };
  const update = (entry: PendingSend) => {
    writes = writes.catch(() => undefined).then(async () => {
      const entries = await read();
      const next = [entry, ...entries.filter((item) => item.userOperationHash !== entry.userOperationHash)];
      await storage.setItem(STORAGE_KEY, JSON.stringify(next));
      listeners.forEach((listener) => listener());
    });
    return writes;
  };

  const provider: TransactionActivityProvider = {
    source: activity.source,
    async load() {
      await writes;
      const { account } = await readPersistedWalletIdentity(identityStorage);
      let entries = (await read()).filter((entry) => entry.account.toLowerCase() === account.toLowerCase());
      const resolved = await Promise.all(entries.map(async (entry) => {
        if (entry.status !== 'submitted') return entry;
        try {
          const receipt = await lookup(entry.userOperationHash);
          return receipt
            ? { ...entry, status: receipt.success ? 'confirmed' : 'failed', transactionHash: receipt.transactionHash } as PendingSend
            : entry;
        } catch {
          return entry;
        }
      }));
      for (let i = 0; i < entries.length; i += 1) {
        if (resolved[i] !== entries[i]) await update(resolved[i]);
      }
      entries = resolved;
      try {
        const result = await activity.load();
        const indexed = result.status === 'empty' ? [] : result.items;
        const local = entries.filter((entry) => !entry.transactionHash || !indexed.some(
          (item) => (item.kind === 'transfer' || item.kind === 'payment') &&
            item.transactionHash?.toLowerCase() === entry.transactionHash?.toLowerCase() &&
            item.asset === entry.asset && item.counterparty.toLowerCase() === entry.recipient.toLowerCase(),
        ));
        const items = [...local.map(localItem), ...indexed].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
        return result.status === 'partial'
          ? { status: 'partial', account, message: result.message, items }
          : { status: 'ready', account, items };
      } catch (error) {
        if (entries.length === 0) throw error;
        return {
          status: 'partial' as const,
          account,
          message: 'Indexed activity is unavailable. Recent sends are shown from this device.',
          items: entries.map(localItem),
        };
      }
    },
    subscribeToChanges(listener) {
      listeners.add(listener);
      const unsubscribe = activity.subscribeToChanges(listener);
      return () => { listeners.delete(listener); unsubscribe(); };
    },
  };
  return { provider, update };
}

async function lookupUserOperation(hash: Hash) {
  const rpcUrl = process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC;
  if (!rpcUrl) throw new Error('ZeroDev Bundler RPC is required');
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getUserOperationReceipt', params: [hash] }),
  });
  if (!response.ok) throw new Error('Could not check send status');
  const payload = await response.json() as { result?: { success: boolean; receipt: { transactionHash: string } } | null; error?: unknown };
  if (payload.error) throw new Error('Could not check send status');
  if (!payload.result) return null;
  if (typeof payload.result.success !== 'boolean' || !isHash(payload.result.receipt?.transactionHash)) {
    throw new Error('Invalid Bundler receipt');
  }
  return { success: payload.result.success, transactionHash: payload.result.receipt.transactionHash };
}

export const pendingSends = createPendingSends();
