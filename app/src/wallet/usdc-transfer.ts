import { encodeFunctionData, erc20Abi, type Address } from 'viem';

import type { KernelExecutionCall } from './kernel-passkey-execution';
import { SEPOLIA_USDC_ADDRESS } from './sepolia';

/** One ERC-20 `transfer` call against the pinned Sepolia USDC contract. */
export function encodeUsdcTransfer({ to, amountMicro }: { to: Address; amountMicro: bigint }): KernelExecutionCall {
  if (amountMicro <= 0n) throw new Error('USDC amount must be greater than zero');
  return {
    to: SEPOLIA_USDC_ADDRESS,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amountMicro] }),
  };
}
