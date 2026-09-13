import type { Address, Hash } from 'viem';

export type TransactionActivityItem = {
  id: string;
  transactionHash: Hash;
  direction: 'sent' | 'received';
  asset: 'ETH' | 'USDC';
  amount: string;
  counterparty: Address;
  timestamp: string;
  blockNumber: number;
};

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
  source: 'blockscout' | 'fixture';
  load(): Promise<TransactionActivityResult>;
  subscribeToChanges(listener: () => void): () => void;
};
