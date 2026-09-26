import { Actions, V4Planner } from '@uniswap/v4-sdk';
import { encodeFunctionData, erc20Abi, maxUint128, parseAbi, type Address, type Hex } from 'viem';

import type { KernelExecutionCall } from './kernel-passkey-execution';
import {
  SEPOLIA_PERMIT2_ADDRESS,
  SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
} from './sepolia';
import { SWAP_POOL_KEY } from './uniswap-sdk';
import { SWAP_DIRECTIONS, type SwapDirection } from './uniswap-quote';

export const SWAP_DEADLINE_SECONDS = 600;

const V4_SWAP_COMMAND = '0x10';
const MAX_UINT48 = 2n ** 48n - 1n;

const universalRouterAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);
const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

export function swapDeadline(nowMs = Date.now()) {
  return BigInt(Math.floor(nowMs / 1000) + SWAP_DEADLINE_SECONDS);
}

export function buildSwapCalls({
  direction,
  amountIn,
  minAmountOut,
  deadline,
}: {
  direction: SwapDirection;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
}): KernelExecutionCall[] {
  if (amountIn <= 0n || amountIn > maxUint128) throw new Error('Swap amount is out of range');
  if (minAmountOut <= 0n || minAmountOut > maxUint128) {
    throw new Error('Minimum received is out of range');
  }
  if (deadline <= 0n || deadline > MAX_UINT48) throw new Error('Swap deadline is out of range');

  const { zeroForOne } = SWAP_DIRECTIONS[direction];
  const [currencyIn, currencyOut] = zeroForOne
    ? [SWAP_POOL_KEY.currency0, SWAP_POOL_KEY.currency1]
    : [SWAP_POOL_KEY.currency1, SWAP_POOL_KEY.currency0];

  // Swap the exact input in the pinned pool, pay it from the Kernel account, and send the output
  // back to the Kernel account (TAKE_ALL pays the caller). addTrade would emit the multi-hop form.
  const planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
    {
      poolKey: SWAP_POOL_KEY,
      zeroForOne,
      amountIn: amountIn.toString(),
      amountOutMinimum: minAmountOut.toString(),
      hookData: '0x',
    },
  ]);
  planner.addAction(Actions.SETTLE_ALL, [currencyIn, amountIn.toString()]);
  planner.addAction(Actions.TAKE_ALL, [currencyOut, minAmountOut.toString()]);

  const swap: KernelExecutionCall = {
    to: SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
    // SETTLE_ALL pays exactly amountIn; any extra ETH would stay in the router for anyone to sweep.
    value: zeroForOne ? amountIn : 0n,
    data: encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [V4_SWAP_COMMAND, [planner.finalize() as Hex], deadline],
    }),
  };
  if (zeroForOne) return [swap];

  return [
    ...buildUsdcPermit2Approvals({
      spender: SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
      amount: amountIn,
      expiration: Number(deadline),
    }),
    swap,
  ];
}

/** Lets `spender` pull at most `amount` USDC through Permit2 until `expiration` (unix seconds). */
export function buildUsdcPermit2Approvals({
  spender,
  amount,
  expiration,
}: {
  spender: Address;
  amount: bigint;
  expiration: number;
}): KernelExecutionCall[] {
  return [
    {
      to: SEPOLIA_USDC_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [SEPOLIA_PERMIT2_ADDRESS, amount],
      }),
    },
    {
      to: SEPOLIA_PERMIT2_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'approve',
        args: [SEPOLIA_USDC_ADDRESS, spender, amount, expiration],
      }),
    },
  ];
}
