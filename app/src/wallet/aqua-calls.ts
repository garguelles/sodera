import { encodeFunctionData, erc20Abi, maxUint256, parseAbi, type Hash, type Hex } from 'viem';

import { AQUA_TOKENS } from './aqua-strategy';
import type { KernelExecutionCall } from './kernel-passkey-execution';
import {
  SEPOLIA_AQUA_ADDRESS,
  SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  SEPOLIA_WETH_ADDRESS,
} from './sepolia';

export const aquaAbi = parseAbi([
  'function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)',
  'function dock(address app, bytes32 strategyHash, address[] tokens)',
  'function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)',
]);
export const wethAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256 wad)']);

/**
 * Opens an Earn position: wraps the ETH the wallet lacks, lets Aqua pull both tokens, and ships the
 * strategy. The tokens stay in the wallet; Aqua pulls them only when a trade fills.
 *
 * The approvals are unlimited because Aqua pulls on every trade, so an exact allowance would run
 * out after enough trading. Aqua can only pull within the balances the maker shipped, and closing
 * resets both approvals to zero.
 */
export function buildOpenPositionCalls({
  order,
  usdcAmount,
  wethAmount,
  wrapWei,
}: {
  order: Hex;
  usdcAmount: bigint;
  wethAmount: bigint;
  /** ETH to wrap first; zero when the wallet already holds enough WETH. */
  wrapWei: bigint;
}): KernelExecutionCall[] {
  if (usdcAmount <= 0n || wethAmount <= 0n) throw new Error('Both position amounts must be positive');
  if (wrapWei < 0n || wrapWei > wethAmount) throw new Error('Wrap amount is out of range');

  const calls: KernelExecutionCall[] = [];
  if (wrapWei > 0n) {
    calls.push({
      to: SEPOLIA_WETH_ADDRESS,
      value: wrapWei,
      data: encodeFunctionData({ abi: wethAbi, functionName: 'deposit' }),
    });
  }
  calls.push(
    approveAqua(SEPOLIA_USDC_ADDRESS, maxUint256),
    approveAqua(SEPOLIA_WETH_ADDRESS, maxUint256),
    {
      to: SEPOLIA_AQUA_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: aquaAbi,
        functionName: 'ship',
        args: [SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, order, [...AQUA_TOKENS], [usdcAmount, wethAmount]],
      }),
    },
  );
  return calls;
}

/** Closes an Earn position, clears Aqua's approvals, and unwraps `unwrapWei` back to ETH. */
export function buildClosePositionCalls({
  strategyHash,
  unwrapWei,
}: {
  strategyHash: Hash;
  unwrapWei: bigint;
}): KernelExecutionCall[] {
  if (unwrapWei < 0n) throw new Error('Unwrap amount is out of range');

  const calls: KernelExecutionCall[] = [
    {
      to: SEPOLIA_AQUA_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: aquaAbi,
        functionName: 'dock',
        // Aqua requires every token of the strategy.
        args: [SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, strategyHash, [...AQUA_TOKENS]],
      }),
    },
    approveAqua(SEPOLIA_USDC_ADDRESS, 0n),
    approveAqua(SEPOLIA_WETH_ADDRESS, 0n),
  ];
  if (unwrapWei > 0n) {
    calls.push({
      to: SEPOLIA_WETH_ADDRESS,
      value: 0n,
      data: encodeFunctionData({ abi: wethAbi, functionName: 'withdraw', args: [unwrapWei] }),
    });
  }
  return calls;
}

function approveAqua(token: typeof SEPOLIA_USDC_ADDRESS | typeof SEPOLIA_WETH_ADDRESS, amount: bigint) {
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SEPOLIA_AQUA_ADDRESS, amount] }),
  } satisfies KernelExecutionCall;
}
