import { getAddress, type Address } from 'viem';

import type { KernelExecutionCall } from '@/wallet/kernel-passkey-execution';
import { shortenAddress } from '@/wallet/sepolia';
import { encodeUsdcTransfer } from '@/wallet/usdc-transfer';

import type { EnrichedPlan } from './policy';

export type ReviewLine = { title: string; detail: string };

/**
 * Turns a policy-checked plan into Kernel calls, in plan order, plus the lines the review shows.
 * Recipients are already resolved and pinned by the policy; the encoder never resolves names.
 */
export function encodePlan(plan: EnrichedPlan): { calls: KernelExecutionCall[]; lines: ReviewLine[] } {
  const calls: KernelExecutionCall[] = [];
  const lines: ReviewLine[] = [];
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
    // Swaps (PRA-212) and the vault (PRA-216) have no encoder yet; policy keeps them disabled.
    throw new Error(`Not implemented: ${action.type}`);
  }
  return { calls, lines };
}

export function recipientDetail(recipient: { address: Address; name: string | null }) {
  return recipient.name ? `address book · ${shortenAddress(recipient.address)}` : shortenAddress(recipient.address);
}
