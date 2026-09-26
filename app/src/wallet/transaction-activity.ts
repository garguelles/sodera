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

/** A Pay with operation: the swap legs folded into the one transfer the payee received. */
export type TransactionActivityPayment = {
  kind: 'payment';
  id: string;
  transactionHash: Hash | null;
  userOperationHash?: Hash;
  status?: 'submitted' | 'confirmed' | 'failed';
  /** What the payee received. */
  asset: 'ETH' | 'USDC';
  /** Decimal string without a unit. */
  amount: string;
  counterparty: Address;
  paidAsset: 'ETH' | 'USDC';
  /** Decimal string without a unit; null when unknown. */
  paidAmount: string | null;
  /** True when `paidAmount` is the quoted maximum rather than what the swap actually took. */
  paidAmountIsMaximum: boolean;
  timestamp: string;
  blockNumber: number;
  operation: TransactionActivityOperationSummary | null;
};

/**
 * An Earn position opened (deposit) or closed (withdraw) through 1inch Aqua. The tokens stay in the
 * wallet either way; the amounts are the USDC and WETH the position held.
 */
export type TransactionActivityEarn = {
  kind: 'earn';
  id: string;
  transactionHash: Hash;
  direction: 'deposit' | 'withdraw';
  asset: 'USDC';
  /** Decimal string without a unit; null when it cannot be derived from the indexed events. */
  amount: string | null;
  pairedAsset: 'WETH';
  pairedAmount: string | null;
  strategyHash: Hash;
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

export type TransactionActivityItem =
  | TransactionActivityTransfer
  | TransactionActivityPayment
  | TransactionActivityEarn
  | TransactionActivityOperation;

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

/**
 * How the Transactions screen and the home activity widget word an Earn row, such as
 * `Earn deposit · 50 USDC`, with the paired WETH trimmed to six decimals.
 */
export function describeEarnActivity(item: TransactionActivityEarn) {
  const action = item.direction === 'deposit' ? 'Earn deposit' : 'Earn withdrawal';
  const paired = item.pairedAmount === null ? null : `${trimDecimals(item.pairedAmount, 6)} ${item.pairedAsset}`;
  return {
    action,
    title: item.amount === null ? action : `${action} · ${item.amount} ${item.asset}`,
    paired,
    /** Both amounts in words, for accessibility labels. */
    amounts:
      item.amount === null
        ? 'amount unavailable'
        : `${item.amount} ${item.asset}${paired ? ` and ${paired}` : ''}`,
  };
}

function trimDecimals(value: string, digits: number) {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.slice(0, digits).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
