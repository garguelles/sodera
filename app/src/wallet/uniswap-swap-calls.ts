import { encodeAbiParameters, encodeFunctionData, erc20Abi, maxUint128, type Hex } from 'viem';

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
// SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f); TAKE_ALL pays the Kernel account.
const EXACT_IN_SINGLE_ACTIONS = '0x060c0f';
const MAX_UINT48 = 2n ** 48n - 1n;

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const;
const exactInputSingleParameters = [
  {
    type: 'tuple',
    components: [
      { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
] as const;
const currencyAmountParameters = [{ type: 'address' }, { type: 'uint256' }] as const;

const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;
const permit2AllowanceAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
] as const;

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
  const swap: KernelExecutionCall = {
    to: SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
    // SETTLE_ALL pays exactly amountIn; any extra ETH would stay in the router for anyone to sweep.
    value: zeroForOne ? amountIn : 0n,
    data: encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [
        V4_SWAP_COMMAND,
        [encodeV4SwapInput({ zeroForOne, amountIn, minAmountOut, currencyIn, currencyOut })],
        deadline,
      ],
    }),
  };
  if (zeroForOne) return [swap];

  return [
    {
      to: SEPOLIA_USDC_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [SEPOLIA_PERMIT2_ADDRESS, amountIn],
      }),
    },
    {
      to: SEPOLIA_PERMIT2_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2AllowanceAbi,
        functionName: 'approve',
        args: [
          SEPOLIA_USDC_ADDRESS,
          SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
          amountIn,
          Number(deadline),
        ],
      }),
    },
    swap,
  ];
}

function encodeV4SwapInput({
  zeroForOne,
  amountIn,
  minAmountOut,
  currencyIn,
  currencyOut,
}: {
  zeroForOne: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  currencyIn: Hex;
  currencyOut: Hex;
}) {
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [
      EXACT_IN_SINGLE_ACTIONS,
      [
        encodeAbiParameters(exactInputSingleParameters, [
          {
            poolKey: SWAP_POOL_KEY,
            zeroForOne,
            amountIn,
            amountOutMinimum: minAmountOut,
            hookData: '0x',
          },
        ]),
        encodeAbiParameters(currencyAmountParameters, [currencyIn, amountIn]),
        encodeAbiParameters(currencyAmountParameters, [currencyOut, minAmountOut]),
      ],
    ],
  );
}
