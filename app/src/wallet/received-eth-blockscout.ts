import { formatEther, getAddress, isAddress, isHash, type Address, type Hash } from 'viem';

import type { TransactionActivityTransfer } from './transaction-activity';

const BLOCKSCOUT_API_URL = 'https://eth-sepolia.blockscout.com/api/v2';

/**
 * ETH received from other wallets. Native transfers emit no event on an address MultiBaas
 * watches, so this one direction comes from the Blockscout explorer instead.
 */
export type ReceivedEthReader = {
  load(account: Address): Promise<{ items: TransactionActivityTransfer[]; skippedCount: number }>;
};

type ExplorerAddress = { hash: string };

type ExplorerTransaction = {
  hash: unknown;
  block_number: unknown;
  timestamp: unknown;
  value: unknown;
  status: unknown;
  result: unknown;
  from: ExplorerAddress | null;
  to: ExplorerAddress | null;
};

type ExplorerInternalTransaction = {
  transaction_hash: unknown;
  block_number: unknown;
  index: unknown;
  timestamp: unknown;
  value: unknown;
  success: unknown;
  from: ExplorerAddress | null;
  to: ExplorerAddress | null;
};

export function createBlockscoutReceivedEthReader({
  fetcher = fetch,
}: { fetcher?: typeof fetch } = {}): ReceivedEthReader {
  return {
    async load(account) {
      const encodedAccount = encodeURIComponent(account);
      const [transactions, internalTransactions] = await Promise.all([
        fetchItems<ExplorerTransaction>(
          fetcher,
          `${BLOCKSCOUT_API_URL}/addresses/${encodedAccount}/transactions?filter=to`,
        ),
        fetchItems<ExplorerInternalTransaction>(
          fetcher,
          `${BLOCKSCOUT_API_URL}/addresses/${encodedAccount}/internal-transactions?filter=to`,
        ),
      ]);
      return normalizeReceivedEth({ account, transactions, internalTransactions });
    },
  };
}

async function fetchItems<T>(fetcher: typeof fetch, url: string): Promise<T[]> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new Error('Received ETH could not reach Blockscout');
  }
  if (!response.ok) throw new Error(`Blockscout returned HTTP ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Blockscout returned invalid data');
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new Error('Blockscout returned invalid data');
  }
  return (payload as { items: T[] }).items;
}

export function normalizeReceivedEth({
  account,
  transactions,
  internalTransactions,
}: {
  account: Address;
  transactions: readonly ExplorerTransaction[];
  internalTransactions: readonly ExplorerInternalTransaction[];
}) {
  const items: TransactionActivityTransfer[] = [];
  let skippedCount = 0;

  const add = (
    row: {
      id: string;
      transactionHash: unknown;
      blockNumber: unknown;
      timestamp: unknown;
      value: unknown;
      from: ExplorerAddress | null;
      to: ExplorerAddress | null;
    },
  ) => {
    const from = parseAddress(row.from);
    const to = parseAddress(row.to);
    if (
      !isHashValue(row.transactionHash) ||
      !isBlockNumber(row.blockNumber) ||
      !isTimestamp(row.timestamp) ||
      typeof row.value !== 'string' ||
      !/^\d+$/.test(row.value) ||
      !from ||
      !to
    ) {
      skippedCount += 1;
      return;
    }
    const value = BigInt(row.value);
    if (value === 0n) return;
    if (to.toLowerCase() !== account.toLowerCase() || from.toLowerCase() === account.toLowerCase()) return;
    items.push({
      kind: 'transfer',
      id: row.id,
      transactionHash: row.transactionHash,
      direction: 'received',
      asset: 'ETH',
      amount: formatEther(value),
      counterparty: from,
      timestamp: new Date(Date.parse(row.timestamp)).toISOString(),
      blockNumber: row.blockNumber,
      operation: null,
    });
  };

  for (const transaction of transactions) {
    if (transaction.result === 'pending') continue;
    if (transaction.status !== 'ok' && transaction.status !== 'error') {
      skippedCount += 1;
      continue;
    }
    if (transaction.status === 'error' || transaction.result !== 'success') continue;
    add({
      id: `eth-in:${String(transaction.hash)}`,
      transactionHash: transaction.hash,
      blockNumber: transaction.block_number,
      timestamp: transaction.timestamp,
      value: transaction.value,
      from: transaction.from,
      to: transaction.to,
    });
  }

  for (const transaction of internalTransactions) {
    if (typeof transaction.success !== 'boolean' || !isBlockNumber(transaction.index)) {
      skippedCount += 1;
      continue;
    }
    if (!transaction.success) continue;
    add({
      id: `eth-in:${String(transaction.transaction_hash)}:${transaction.index}`,
      transactionHash: transaction.transaction_hash,
      blockNumber: transaction.block_number,
      timestamp: transaction.timestamp,
      value: transaction.value,
      from: transaction.from,
      to: transaction.to,
    });
  }

  return { items, skippedCount };
}

function parseAddress(value: ExplorerAddress | null): Address | null {
  return value && typeof value.hash === 'string' && isAddress(value.hash, { strict: false })
    ? getAddress(value.hash)
    : null;
}

function isHashValue(value: unknown): value is Hash {
  return typeof value === 'string' && isHash(value);
}

function isBlockNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
