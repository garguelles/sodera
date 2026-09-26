import { parseAbi, zeroAddress, type Address } from 'viem';

// Mirrors app/src/wallet/uniswap-sdk.ts and uniswap-quote.ts, pinned in
// docs/research/PRA-212-uniswap-v4-sepolia-route.md. The service only quotes for the plan's
// summary; the phone quotes again at review and builds the transaction from its own quote.

export type SwapDirection = 'eth_to_usdc' | 'usdc_to_eth';

export const SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS: Address = '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227';
const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

// currency0 is native ETH (the zero address sorts first), so ETH -> USDC swaps zero for one.
export const SWAP_POOL_KEY = {
  currency0: zeroAddress,
  currency1: USDC,
  fee: 20,
  tickSpacing: 1,
  hooks: zeroAddress,
} as const;

/** 0.5%, the app's SWAP_SLIPPAGE. Minimum received is amountOut / (1 + slippage), as in the SDK. */
export const SLIPPAGE_BPS = 50n;

const v4QuoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export type QuoteClient = {
  simulateContract(parameters: {
    address: Address;
    abi: typeof v4QuoterAbi;
    functionName: 'quoteExactInputSingle';
    args: readonly [
      {
        poolKey: typeof SWAP_POOL_KEY;
        zeroForOne: boolean;
        exactAmount: bigint;
        hookData: '0x';
      },
    ];
  }): Promise<{ result: readonly [bigint, bigint] }>;
};

export function createSwapQuoter(client: QuoteClient) {
  return async (direction: SwapDirection, amountIn: bigint) => {
    const { result } = await client.simulateContract({
      address: SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
      abi: v4QuoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey: SWAP_POOL_KEY, zeroForOne: direction === 'eth_to_usdc', exactAmount: amountIn, hookData: '0x' }],
    });
    const [amountOut] = result;
    if (amountOut <= 0n) throw new Error('The pool cannot fill this amount');
    return { amountOut, minAmountOut: (amountOut * 10_000n) / (10_000n + SLIPPAGE_BPS) };
  };
}

export type SwapQuoter = ReturnType<typeof createSwapQuoter>;
