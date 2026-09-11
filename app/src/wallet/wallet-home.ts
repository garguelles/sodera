import type { Address } from 'viem';

export type WalletHomeIdentity = {
  username: string;
  address: Address;
  avatarUrl: string | null;
};

export type WalletHomeBalance = {
  id: string;
  name: string;
  symbol: string;
  amount: string;
  valueUsd: string;
};

export type WalletHomePosition = {
  id: string;
  protocol: string;
  name: string;
  symbol: string;
  amount: string;
  valueUsd: string;
};

export type WalletHomeSnapshot = {
  identity: WalletHomeIdentity;
  portfolio: {
    totalValueUsd: string;
    balances: readonly WalletHomeBalance[];
    positions: readonly WalletHomePosition[];
  };
};

export type WalletHomeResult =
  | { status: 'ready'; snapshot: WalletHomeSnapshot }
  | { status: 'indexing'; snapshot: WalletHomeSnapshot; message: string }
  | { status: 'empty'; identity: WalletHomeIdentity; message: string };

export type WalletHomeProvider = {
  source: 'fixture' | 'live';
  load(): Promise<WalletHomeResult>;
  subscribeToChanges(listener: () => void): () => void;
};
