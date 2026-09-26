import {
  decodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  isAddressEqual,
  parseEther,
  parseUnits,
  type Address,
  type Hash,
} from 'viem';

import { SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS, SEPOLIA_USDC_ADDRESS } from './sepolia';
import type {
  TransactionActivityItem,
  TransactionActivityOperationSummary,
  TransactionActivityPayment,
} from './transaction-activity';
import type { UserOperationCall } from './user-operation-calls';

// A Pay with operation otherwise shows up as several rows: the ETH sent to the router, its
// refund, the pool leg, and the transfer to the payee. It is recognised by its calls, which
// Send builds as [...approvals, Trading router swap, transfer to the payee].

type Asset = 'ETH' | 'USDC';

export type PayWithCalls = {
  payAsset: Asset;
  receiveAsset: Asset;
  recipient: Address;
  amount: bigint;
  /** ETH sent with the router call: the quoted maximum when paying with ETH. */
  routerValue: bigint;
};

export function describePayWithCalls(calls: readonly UserOperationCall[]): PayWithCalls | null {
  if (calls.length < 2) return null;
  const router = calls[calls.length - 2];
  const transfer = calls[calls.length - 1];
  if (!isAddressEqual(router.to, SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS)) return null;
  const routerValue = BigInt(router.valueWei);
  const payAsset: Asset = routerValue > 0n ? 'ETH' : 'USDC';

  if (isAddressEqual(transfer.to, SEPOLIA_USDC_ADDRESS)) {
    try {
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: transfer.data });
      if (functionName !== 'transfer' || payAsset === 'USDC') return null;
      return { payAsset, receiveAsset: 'USDC', recipient: getAddress(args[0]), amount: args[1], routerValue };
    } catch {
      return null;
    }
  }
  if (transfer.data !== '0x' || BigInt(transfer.valueWei) === 0n || payAsset === 'ETH') return null;
  return { payAsset, receiveAsset: 'ETH', recipient: transfer.to, amount: BigInt(transfer.valueWei), routerValue };
}

const toUnits = (amount: string, asset: Asset) => (asset === 'ETH' ? parseEther(amount) : parseUnits(amount, 6));
const fromUnits = (amount: bigint, asset: Asset) => (asset === 'ETH' ? formatEther(amount) : formatUnits(amount, 6));

/**
 * Replaces the rows of each Pay with operation with one payment row. What was paid is the net
 * outflow of the pay asset in that transaction; an ETH refund only appears when received ETH
 * loaded, so without it the row shows the maximum sent to the router instead.
 */
export function groupPayWithActivity({
  items,
  operationCalls,
  receivedEthLoaded,
}: {
  items: readonly TransactionActivityItem[];
  operationCalls: ReadonlyMap<string, readonly UserOperationCall[]>;
  receivedEthLoaded: boolean;
}): TransactionActivityItem[] {
  let result = [...items];
  for (const [userOperationHash, calls] of operationCalls) {
    const payment = describePayWithCalls(calls);
    if (!payment) continue;
    const summary = findOperation(result, userOperationHash);
    if (!summary) continue;
    const inTransaction = result.filter(
      (item) => item.kind === 'transfer' && item.transactionHash?.toLowerCase() === summary.transactionHash.toLowerCase(),
    );

    let paidAmount: string | null = null;
    let paidAmountIsMaximum = false;
    if (summary.operation.success) {
      const payeeLeg = inTransaction.find(
        (item) =>
          item.kind === 'transfer' &&
          item.direction === 'sent' &&
          item.asset === payment.receiveAsset &&
          isAddressEqual(item.counterparty, payment.recipient),
      );
      const net = inTransaction.reduce((total, item) => {
        if (item.kind !== 'transfer' || item === payeeLeg || item.asset !== payment.payAsset) return total;
        const amount = toUnits(item.amount, item.asset);
        return item.direction === 'sent' ? total - amount : total + amount;
      }, 0n);
      paidAmountIsMaximum = payment.payAsset === 'ETH' && !receivedEthLoaded;
      paidAmount = -net > 0n ? fromUnits(-net, payment.payAsset) : null;
    }

    const row: TransactionActivityPayment = {
      kind: 'payment',
      id: `pay:${userOperationHash}`,
      transactionHash: summary.transactionHash,
      userOperationHash: summary.operation.userOperationHash,
      asset: payment.receiveAsset,
      amount: fromUnits(payment.amount, payment.receiveAsset),
      counterparty: payment.recipient,
      paidAsset: payment.payAsset,
      paidAmount,
      paidAmountIsMaximum,
      timestamp: summary.timestamp,
      blockNumber: summary.blockNumber,
      operation: summary.operation,
    };
    result = [
      ...result.filter((item) => !inTransaction.includes(item) && !isOperation(item, userOperationHash)),
      row,
    ];
  }
  return result;
}

function isOperation(item: TransactionActivityItem, userOperationHash: string) {
  return item.kind === 'operation' && item.userOperationHash.toLowerCase() === userOperationHash.toLowerCase();
}

function findOperation(
  items: readonly TransactionActivityItem[],
  userOperationHash: string,
): { transactionHash: Hash; timestamp: string; blockNumber: number; operation: TransactionActivityOperationSummary } | null {
  for (const item of items) {
    if (isOperation(item, userOperationHash) && item.kind === 'operation') {
      const { transactionHash, timestamp, blockNumber } = item;
      return {
        transactionHash,
        timestamp,
        blockNumber,
        operation: {
          userOperationHash: item.userOperationHash,
          success: item.success,
          sponsored: item.sponsored,
          actualGasCostWei: item.actualGasCostWei,
        },
      };
    }
    if (
      item.kind === 'transfer' &&
      item.transactionHash &&
      item.operation?.userOperationHash.toLowerCase() === userOperationHash.toLowerCase()
    ) {
      return {
        transactionHash: item.transactionHash,
        timestamp: item.timestamp,
        blockNumber: item.blockNumber,
        operation: item.operation,
      };
    }
  }
  return null;
}
