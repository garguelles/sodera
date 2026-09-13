import { AppState } from 'react-native';
import {
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  isHash,
  type Address,
  type Hash,
} from 'viem';

import type {
  TransactionActivityItem,
  TransactionActivityProvider,
} from './transaction-activity';
import { SEPOLIA_USDC_ADDRESS } from './sepolia';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';

const BLOCKSCOUT_API_URL = 'https://eth-sepolia.blockscout.com/api/v2';

type ExplorerAddress = { hash: Address };

type ExplorerTransaction = {
  hash: Hash;
  block_number: number;
  timestamp: string;
  value: string;
  status: string;
  result: string;
  from: ExplorerAddress;
  to: ExplorerAddress | null;
};

type ExplorerInternalTransaction = {
  transaction_hash: Hash;
  block_number: number;
  index: number;
  timestamp: string;
  value: string;
  success: boolean;
  from: ExplorerAddress;
  to: ExplorerAddress | null;
};

type ExplorerTokenTransfer = {
  transaction_hash: Hash;
  block_number: number;
  log_index: number;
  timestamp: string;
  from: ExplorerAddress;
  to: ExplorerAddress;
  token: { address_hash: Address; symbol: string; decimals: string | null };
  total: { value: string; decimals: string | null };
};

type ExplorerPage<T> = { items: T[] };

export function createBlockscoutTransactionActivityProvider({
  storage = walletIdentityNativeStorage,
  fetcher = fetch,
}: {
  storage?: WalletIdentityStorage;
  fetcher?: typeof fetch;
} = {}) {
  const listeners = new Set<() => void>();
  const provider: TransactionActivityProvider & { refresh(): void } = {
    source: 'blockscout',
    async load() {
      const { account } = await readPersistedWalletIdentity(storage);
      const encodedAccount = encodeURIComponent(account);
      const [transactions, internalTransactions, tokenTransfers] = await Promise.all([
        fetchPage<ExplorerTransaction>(
          fetcher,
          `${BLOCKSCOUT_API_URL}/addresses/${encodedAccount}/transactions`,
        ),
        fetchPage<ExplorerInternalTransaction>(
          fetcher,
          `${BLOCKSCOUT_API_URL}/addresses/${encodedAccount}/internal-transactions`,
        ),
        fetchPage<ExplorerTokenTransfer>(
          fetcher,
          `${BLOCKSCOUT_API_URL}/addresses/${encodedAccount}/token-transfers?type=ERC-20`,
        ),
      ]);
      const { items, skippedCount } = normalizeActivity({
        account,
        transactions: transactions.items,
        internalTransactions: internalTransactions.items,
        tokenTransfers: tokenTransfers.items,
      });
      if (skippedCount > 0) {
        return {
          status: 'partial',
          account,
          items,
          message: `${skippedCount} malformed explorer ${skippedCount === 1 ? 'record was' : 'records were'} omitted.`,
        };
      }
      return items.length > 0
        ? { status: 'ready', account, items }
        : { status: 'empty', account };
    },
    subscribeToChanges(listener) {
      listeners.add(listener);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') listener();
      });
      return () => {
        listeners.delete(listener);
        subscription.remove();
      };
    },
    refresh() {
      listeners.forEach((listener) => listener());
    },
  };
  return provider;
}

async function fetchPage<T>(fetcher: typeof fetch, url: string): Promise<ExplorerPage<T>> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new Error('Transaction history could not reach the Sepolia explorer');
  }
  if (!response.ok) throw new Error(`Transaction history explorer returned HTTP ${response.status}`);
  const payload = (await response.json()) as Partial<ExplorerPage<T>>;
  if (!Array.isArray(payload.items)) throw new Error('Transaction history explorer returned invalid data');
  return { items: payload.items };
}

export function normalizeActivity({
  account,
  transactions,
  internalTransactions,
  tokenTransfers,
}: {
  account: Address;
  transactions: ExplorerTransaction[];
  internalTransactions: ExplorerInternalTransaction[];
  tokenTransfers: ExplorerTokenTransfer[];
}) {
  const normalizedAccount = account.toLowerCase();
  const items: TransactionActivityItem[] = [];
  let skippedCount = 0;

  for (const transaction of transactions) {
    try {
      if (typeof transaction.status !== 'string' || typeof transaction.result !== 'string') {
        skippedCount += 1;
        continue;
      }
      if (transaction.status !== 'ok' && transaction.status !== 'error') {
        skippedCount += 1;
        continue;
      }
      if (transaction.status === 'error') continue;
      if (transaction.result !== 'success') {
        skippedCount += 1;
        continue;
      }
      if (
        !isHash(transaction.hash) ||
        !isValidBlockIndex(transaction.block_number) ||
        !isValidTimestamp(transaction.timestamp) ||
        typeof transaction.value !== 'string' ||
        !isExplorerAddress(transaction.from) ||
        (transaction.to !== null && !isExplorerAddress(transaction.to))
      ) {
        skippedCount += 1;
        continue;
      }
      addNativeTransfer(items, {
        id: `transaction:${transaction.hash}`,
        account: normalizedAccount,
        transactionHash: transaction.hash,
        blockNumber: transaction.block_number,
        timestamp: transaction.timestamp,
        value: transaction.value,
        from: transaction.from.hash,
        to: transaction.to?.hash ?? null,
      });
    } catch {
      skippedCount += 1;
      continue;
    }
  }

  for (const transaction of internalTransactions) {
    try {
      if (typeof transaction.success !== 'boolean') {
        skippedCount += 1;
        continue;
      }
      if (!transaction.success) continue;
      if (
        !isHash(transaction.transaction_hash) ||
        !isValidBlockIndex(transaction.block_number) ||
        !isValidBlockIndex(transaction.index) ||
        !isValidTimestamp(transaction.timestamp) ||
        typeof transaction.value !== 'string' ||
        !isExplorerAddress(transaction.from) ||
        (transaction.to !== null && !isExplorerAddress(transaction.to))
      ) {
        skippedCount += 1;
        continue;
      }
      addNativeTransfer(items, {
        id: `internal:${transaction.transaction_hash}:${transaction.index}`,
        account: normalizedAccount,
        transactionHash: transaction.transaction_hash,
        blockNumber: transaction.block_number,
        timestamp: transaction.timestamp,
        value: transaction.value,
        from: transaction.from.hash,
        to: transaction.to?.hash ?? null,
      });
    } catch {
      skippedCount += 1;
      continue;
    }
  }

  for (const transfer of tokenTransfers) {
    try {
      if (!isExplorerTokenAddress(transfer.token?.address_hash)) {
        skippedCount += 1;
        continue;
      }
      if (transfer.token.address_hash.toLowerCase() !== SEPOLIA_USDC_ADDRESS.toLowerCase()) continue;
      if (
        !isHash(transfer.transaction_hash) ||
        !isValidBlockIndex(transfer.block_number) ||
        !isValidBlockIndex(transfer.log_index) ||
        !isValidTimestamp(transfer.timestamp) ||
        !isExplorerAddress(transfer.from) ||
        !isExplorerAddress(transfer.to) ||
        typeof transfer.total?.value !== 'string'
      ) {
        skippedCount += 1;
        continue;
      }
      const direction = getDirection(normalizedAccount, transfer.from.hash, transfer.to.hash);
      if (!direction || BigInt(transfer.total.value) === 0n) continue;
      const decimals = Number(transfer.total.decimals ?? transfer.token.decimals);
      if (!Number.isSafeInteger(decimals) || decimals !== 6) {
        skippedCount += 1;
        continue;
      }
      items.push({
        id: `erc20:${transfer.transaction_hash}:${transfer.log_index}`,
        transactionHash: transfer.transaction_hash,
        direction,
        asset: 'USDC',
        amount: formatUnits(BigInt(transfer.total.value), decimals),
        counterparty: getAddress(
          direction === 'sent' ? transfer.to.hash : transfer.from.hash,
        ),
        timestamp: transfer.timestamp,
        blockNumber: transfer.block_number,
      });
    } catch {
      skippedCount += 1;
      continue;
    }
  }

  return {
    items: items.sort(
      (left, right) =>
        Date.parse(right.timestamp) - Date.parse(left.timestamp) ||
        right.blockNumber - left.blockNumber ||
        right.id.localeCompare(left.id),
    ),
    skippedCount,
  };
}

function addNativeTransfer(
  items: TransactionActivityItem[],
  transfer: {
    id: string;
    account: string;
    transactionHash: Hash;
    blockNumber: number;
    timestamp: string;
    value: string;
    from: Address;
    to: Address | null;
  },
) {
  if (!transfer.to || BigInt(transfer.value) === 0n) return;
  const direction = getDirection(transfer.account, transfer.from, transfer.to);
  if (!direction) return;
  items.push({
    id: transfer.id,
    transactionHash: transfer.transactionHash,
    direction,
    asset: 'ETH',
    amount: formatEther(BigInt(transfer.value)),
    counterparty: getAddress(direction === 'sent' ? transfer.to : transfer.from),
    timestamp: transfer.timestamp,
    blockNumber: transfer.blockNumber,
  });
}

function getDirection(account: string, from: Address, to: Address) {
  if (from.toLowerCase() === account && to.toLowerCase() !== account) return 'sent' as const;
  if (to.toLowerCase() === account && from.toLowerCase() !== account) return 'received' as const;
  return null;
}

function isValidTimestamp(timestamp: unknown): timestamp is string {
  return typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp));
}

function isValidBlockIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isExplorerAddress(value: unknown): value is ExplorerAddress {
  if (!value || typeof value !== 'object' || !('hash' in value)) return false;
  return typeof value.hash === 'string' && isAddress(value.hash);
}

function isExplorerTokenAddress(value: unknown): value is Address {
  return typeof value === 'string' && isAddress(value);
}

export const blockscoutTransactionActivityProvider =
  createBlockscoutTransactionActivityProvider();
