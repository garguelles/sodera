import type { Address, Hash } from 'viem';

export type TransactionActivityOperationSummary = {
  userOperationHash: Hash;
  success: boolean;
  sponsored: boolean;
  actualGasCostWei: string;
};

export type TransactionActivityTransfer = {
  kind: 'transfer';
  id: string;
  transactionHash: Hash | null;
  userOperationHash?: Hash;
  status?: 'submitted' | 'confirmed' | 'failed';
  direction: 'sent' | 'received';
  asset: 'ETH' | 'USDC';
  /** Decimal string without a unit. */
  amount: string;
  counterparty: Address;
  /** ISO-8601. */
  timestamp: string;
  blockNumber: number;
  operation: TransactionActivityOperationSummary | null;
};

export type TransactionActivityOperation = {
  kind: 'operation';
  id: string;
  transactionHash: Hash;
  userOperationHash: Hash;
  success: boolean;
  sponsored: boolean;
  actualGasCostWei: string;
  timestamp: string;
  blockNumber: number;
};

export type TransactionActivityItem = TransactionActivityTransfer | TransactionActivityOperation;

export type TransactionActivityResult =
  | { status: 'ready'; account: Address; items: readonly TransactionActivityItem[] }
  | {
      status: 'partial';
      account: Address;
      items: readonly TransactionActivityItem[];
      message: string;
    }
  | { status: 'empty'; account: Address };

export type TransactionActivityProvider = {
  source: 'multibaas' | 'fixture';
  load(): Promise<TransactionActivityResult>;
  subscribeToChanges(listener: () => void): () => void;
};
