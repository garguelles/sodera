import { getAddress, type Address } from 'viem';

import type { KernelExecutionCall } from '@/wallet/kernel-passkey-execution';
import { shortenAddress } from '@/wallet/sepolia';
import {
  formatSwapAmount,
  quoteSwap as quoteUniswapSwap,
  SWAP_DIRECTIONS,
  SWAP_SLIPPAGE_LABEL,
  type SwapDirection,
  type SwapQuote,
} from '@/wallet/uniswap-quote';
import { buildSwapCalls, swapDeadline } from '@/wallet/uniswap-swap-calls';
import { encodeUsdcTransfer } from '@/wallet/usdc-transfer';

import type { EnrichedPlan } from './policy';

export type ReviewLine = { title: string; detail: string };

export type EncodedPlan = {
  calls: KernelExecutionCall[];
  lines: ReviewLine[];
  /** Unix seconds after which a swap in the plan can no longer execute; null without a swap. */
  expiresAt: bigint | null;
};

export type PlanEncoderDependencies = {
  quoteSwap?: (request: { direction: SwapDirection; amountIn: bigint }) => Promise<SwapQuote>;
  now?: () => number;
};

const SWAP_DIRECTION: Record<'eth_to_usdc' | 'usdc_to_eth', SwapDirection> = {
  eth_to_usdc: 'eth-to-usdc',
  usdc_to_eth: 'usdc-to-eth',
};

/**
 * Turns a policy-checked plan into Kernel calls, in plan order, plus the lines the review shows.
 * Recipients are already resolved and pinned by the policy; the encoder never resolves names.
 * Swaps are quoted here, at review time, so the minimum received reflects the pool right now.
 */
export async function encodePlan(
  plan: EnrichedPlan,
  { quoteSwap = (request) => quoteUniswapSwap(request), now = Date.now }: PlanEncoderDependencies = {},
): Promise<EncodedPlan> {
  const calls: KernelExecutionCall[] = [];
  const lines: ReviewLine[] = [];
  let expiresAt: bigint | null = null;
  for (const item of plan.actions) {
    const { action } = item;
    if (action.type === 'send_eth' || action.type === 'send_usdc') {
      if (!item.recipient || item.amountBase === 'all') throw new Error('Plan action is missing its recipient or amount');
      const to: Address = getAddress(item.recipient.address);
      calls.push(
        action.type === 'send_eth'
          ? { to, value: item.amountBase, data: '0x' }
          : encodeUsdcTransfer({ to, amountMicro: item.amountBase }),
      );
      lines.push({
        title: `Send ${action.amount} ${item.asset} to ${item.recipient.name ?? shortenAddress(to)}`,
        detail: recipientDetail(item.recipient),
      });
      continue;
    }
    if (action.type === 'swap') {
      if (item.amountBase === 'all') throw new Error('Plan action is missing its amount');
      const direction = SWAP_DIRECTION[action.direction];
      const { input, output } = SWAP_DIRECTIONS[direction];
      const quote = await quoteSwap({ direction, amountIn: item.amountBase });
      const deadline = swapDeadline(now());
      calls.push(...buildSwapCalls({ direction, amountIn: item.amountBase, minAmountOut: quote.minAmountOut, deadline }));
      lines.push({
        title: `Swap ${action.amountIn} ${input} for ~${formatSwapAmount(quote.amountOut, output)} ${output}`,
        detail: `at least ${formatSwapAmount(quote.minAmountOut, output)} ${output} · Uniswap v4 · ${SWAP_SLIPPAGE_LABEL} max slippage`,
      });
      expiresAt = expiresAt === null || deadline < expiresAt ? deadline : expiresAt;
      continue;
    }
    // The vault (PRA-216) has no encoder yet; policy keeps it disabled.
    throw new Error(`Not implemented: ${action.type}`);
  }
  return { calls, lines, expiresAt };
}

export function recipientDetail(recipient: { address: Address; name: string | null }) {
  return recipient.name ? `address book · ${shortenAddress(recipient.address)}` : shortenAddress(recipient.address);
}
