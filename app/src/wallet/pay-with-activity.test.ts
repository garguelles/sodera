import type { Address, Hash } from 'viem';

import type { PayQuote } from '../agent/agent-client';
import { describePayWithCalls, groupPayWithActivity } from './pay-with-activity';
import { buildPayWithCalls } from './pay-with-swap';
import { ethForTenUsdc, PAY_FIXTURE_ACCOUNT, usdcForMilliEth } from './pay-with-swap-fixtures';
import type { TransactionActivityItem, TransactionActivityTransfer } from './transaction-activity';
import { decodeUserOperationCalls } from './user-operation-calls';
import { encodeBundle, encodeKernelCalls } from './user-operation-calls-fixtures';
import { buildSwapCalls } from './uniswap-swap-calls';

const PAYEE: Address = '0x000000000000000000000000000000000000bEEF';
const ROUTER: Address = '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3';
const POOL_MANAGER: Address = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543';
const userOperationHash = `0x${'aa'.repeat(32)}` as Hash;
const transactionHash = `0x${'bb'.repeat(32)}` as Hash;
const operation = { userOperationHash, success: true, sponsored: true, actualGasCostWei: '1' };

function payCalls(quote: PayQuote) {
  const request = { account: PAY_FIXTURE_ACCOUNT, payAsset: quote.payAsset, receiveAsset: quote.receiveAsset, amountOut: quote.amountOut };
  return buildPayWithCalls({ request, quote, recipient: PAYEE, nowMs: Date.parse(quote.quotedAt) }).map((call) => ({
    to: call.to,
    valueWei: call.value.toString(),
    data: call.data,
  }));
}

function leg(
  direction: 'sent' | 'received',
  asset: 'ETH' | 'USDC',
  amount: string,
  counterparty: Address,
  withOperation = true,
): TransactionActivityTransfer {
  return {
    kind: 'transfer',
    id: `${direction}:${asset}:${counterparty}:${amount}`,
    transactionHash,
    direction,
    asset,
    amount,
    counterparty,
    timestamp: '2026-09-26T13:04:00.000Z',
    blockNumber: 10,
    operation: withOperation ? operation : null,
  };
}

const unrelated: TransactionActivityItem = {
  ...leg('received', 'USDC', '5', PAYEE, false),
  id: 'unrelated',
  transactionHash: `0x${'cc'.repeat(32)}` as Hash,
};

describe('describePayWithCalls', () => {
  it('recognises the calls Send builds, as decoded from the bundle', async () => {
    const calls = payCalls(usdcForMilliEth);
    const callData = await encodeKernelCalls(calls.map((call) => ({ ...call, value: BigInt(call.valueWei) })));
    const decoded = decodeUserOperationCalls({ input: encodeBundle(PAY_FIXTURE_ACCOUNT, 7n, callData), sender: PAY_FIXTURE_ACCOUNT, nonce: 7n });

    expect(describePayWithCalls(decoded!)).toEqual({
      payAsset: 'USDC',
      receiveAsset: 'ETH',
      recipient: PAYEE,
      amount: 1_000_000_000_000_000n,
      routerValue: 0n,
    });
    expect(describePayWithCalls(payCalls(ethForTenUsdc))).toMatchObject({ payAsset: 'ETH', receiveAsset: 'USDC', amount: 10_000_000n });
  });

  it('ignores plain sends and Swap', () => {
    expect(describePayWithCalls([{ to: PAYEE, valueWei: '1', data: '0x' }])).toBeNull();
    const swap = buildSwapCalls({ direction: 'usdc-to-eth', amountIn: 1_000_000n, minAmountOut: 1n, deadline: 1_900_000_000n });
    expect(describePayWithCalls(swap.map((call) => ({ to: call.to, valueWei: call.value.toString(), data: call.data })))).toBeNull();
  });
});

describe('groupPayWithActivity', () => {
  const ethPayment = [
    leg('sent', 'ETH', '0.000283822217138077', ROUTER),
    leg('received', 'USDC', '10', POOL_MANAGER),
    leg('sent', 'USDC', '10', PAYEE),
  ];
  const refund = leg('received', 'ETH', '0.000001412050831532', ROUTER, false);
  const operationCalls = new Map([[userOperationHash, payCalls(ethForTenUsdc)]]);

  it('folds a payment with ETH into one row that nets out the refund', () => {
    const items = groupPayWithActivity({ items: [...ethPayment, refund, unrelated], operationCalls, receivedEthLoaded: true });

    expect(items).toEqual([
      unrelated,
      expect.objectContaining({
        kind: 'payment',
        transactionHash,
        asset: 'USDC',
        amount: '10',
        counterparty: PAYEE,
        paidAsset: 'ETH',
        paidAmount: '0.000282410166306545',
        paidAmountIsMaximum: false,
        operation,
      }),
    ]);
  });

  it('shows the maximum sent to the router when the refund could not be loaded', () => {
    const [payment] = groupPayWithActivity({ items: ethPayment, operationCalls, receivedEthLoaded: false });
    expect(payment).toMatchObject({ paidAmount: '0.000283822217138077', paidAmountIsMaximum: true });
  });

  it('folds a payment with USDC using what the pool pulled', () => {
    const items = groupPayWithActivity({
      items: [
        leg('sent', 'USDC', '22.814954', POOL_MANAGER),
        leg('sent', 'ETH', '0.001', PAYEE),
        leg('received', 'ETH', '0.001', POOL_MANAGER, false),
      ],
      operationCalls: new Map([[userOperationHash, payCalls(usdcForMilliEth)]]),
      receivedEthLoaded: false,
    });
    expect(items).toEqual([
      expect.objectContaining({ kind: 'payment', asset: 'ETH', amount: '0.001', paidAsset: 'USDC', paidAmount: '22.814954', paidAmountIsMaximum: false }),
    ]);
  });

  it('keeps a failed payment as one row without a paid amount', () => {
    const failed = { ...operation, success: false };
    const items = groupPayWithActivity({
      items: [{ kind: 'operation', id: 'op', transactionHash, userOperationHash, success: false, sponsored: true, actualGasCostWei: '1', timestamp: '2026-09-26T13:04:00.000Z', blockNumber: 10 }],
      operationCalls,
      receivedEthLoaded: true,
    });
    expect(items).toEqual([expect.objectContaining({ kind: 'payment', paidAmount: null, operation: failed })]);
  });
});
