import { AppState } from 'react-native';
import { formatEther, formatUnits, getAddress, type Address, type Hash } from 'viem';

import type {
  TransactionActivityItem,
  TransactionActivityProvider,
} from './transaction-activity';
import { readPersistedWalletIdentity, type WalletIdentityStorage } from './wallet-identity';
import { walletIdentityNativeStorage } from './wallet-identity-native-storage';
import { SEPOLIA_USDC_ADDRESS } from './wallet-home-live';

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
      const items = normalizeActivity({
        account,
        transactions: transactions.items,
        internalTransactions: internalTransactions.items,
        tokenTransfers: tokenTransfers.items,
      });
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

  for (const transaction of transactions) {
    try {
      if (
        transaction.status !== 'ok' ||
        transaction.result !== 'success' ||
        !isValidTimestamp(transaction.timestamp)
      ) continue;
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
      continue;
    }
  }

  for (const transaction of internalTransactions) {
    try {
      if (!transaction.success || !isValidTimestamp(transaction.timestamp)) continue;
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
      continue;
    }
  }

  for (const transfer of tokenTransfers) {
    try {
      if (
        transfer.token.address_hash.toLowerCase() !== SEPOLIA_USDC_ADDRESS.toLowerCase() ||
        !isValidTimestamp(transfer.timestamp)
      ) continue;
      const direction = getDirection(normalizedAccount, transfer.from.hash, transfer.to.hash);
      if (!direction || BigInt(transfer.total.value) === 0n) continue;
      const decimals = Number(transfer.total.decimals ?? transfer.token.decimals);
      if (!Number.isSafeInteger(decimals) || decimals !== 6) continue;
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
      continue;
    }
  }

  return items.sort(
    (left, right) =>
      Date.parse(right.timestamp) - Date.parse(left.timestamp) ||
      right.blockNumber - left.blockNumber ||
      right.id.localeCompare(left.id),
  );
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

export const blockscoutTransactionActivityProvider =
  createBlockscoutTransactionActivityProvider();
