import { createPublicClient, formatUnits, http, parseAbi, parseUnits, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';

import { SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS } from './sepolia';
import { SWAP_POOL_KEY } from './uniswap-sdk';

export type SwapAsset = 'ETH' | 'USDC';
export type SwapDirection = 'eth-to-usdc' | 'usdc-to-eth';

export const SWAP_ASSET_DECIMALS: Record<SwapAsset, number> = { ETH: 18, USDC: 6 };
const SWAP_ASSET_DISPLAY_DECIMALS: Record<SwapAsset, number> = { ETH: 8, USDC: 2 };

// currency0 is native ETH, so ETH -> USDC swaps zero for one.
export const SWAP_DIRECTIONS = {
  'eth-to-usdc': { input: 'ETH', output: 'USDC', zeroForOne: true },
  'usdc-to-eth': { input: 'USDC', output: 'ETH', zeroForOne: false },
} as const satisfies Record<
  SwapDirection,
  { input: SwapAsset; output: SwapAsset; zeroForOne: boolean }
>;

export const SWAP_SLIPPAGE_BPS = 50n;
const BPS_DENOMINATOR = 10_000n;

export type SwapQuote = {
  direction: SwapDirection;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
};

export type SwapQuoteClient = Pick<PublicClient, 'getChainId' | 'simulateContract'>;

const v4QuoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export function parseSwapAmount({
  direction,
  amount,
  balance,
}: {
  direction: SwapDirection;
  amount: string;
  balance: bigint;
}) {
  const asset = SWAP_DIRECTIONS[direction].input;
  const decimals = SWAP_ASSET_DECIMALS[asset];
  const match = /^(\d*)(?:\.(\d*))?$/.exec(amount.trim().replace(',', '.'));
  if (!match || (!match[1] && !match[2])) throw new Error(`Enter a valid ${asset} amount`);
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new Error(`${asset} amounts can have at most ${decimals} decimals`);
  }
  const value = parseUnits(`${whole || '0'}.${fraction || '0'}`, decimals);
  if (value <= 0n) throw new Error('Amount must be greater than zero');
  if (value > balance) throw new Error(`Amount exceeds the available ${asset} balance`);
  return value;
}

export async function quoteSwap(
  { direction, amountIn }: { direction: SwapDirection; amountIn: bigint },
  client?: SwapQuoteClient,
): Promise<SwapQuote> {
  const quoteClient = client ?? (await getDefaultSwapQuoteClient());
  const { result } = await quoteClient.simulateContract({
    address: SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
    abi: v4QuoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        poolKey: SWAP_POOL_KEY,
        zeroForOne: SWAP_DIRECTIONS[direction].zeroForOne,
        exactAmount: amountIn,
        hookData: '0x',
      },
    ],
  });
  const [amountOut] = result;
  if (amountOut <= 0n) throw new Error('The pool cannot fill this amount');
  return {
    direction,
    amountIn,
    amountOut,
    minAmountOut: (amountOut * (BPS_DENOMINATOR - SWAP_SLIPPAGE_BPS)) / BPS_DENOMINATOR,
  };
}

export function formatSwapAmount(amount: bigint, asset: SwapAsset) {
  const [whole, fraction = ''] = formatUnits(amount, SWAP_ASSET_DECIMALS[asset]).split('.');
  const shownFraction = fraction.slice(0, SWAP_ASSET_DISPLAY_DECIMALS[asset]).replace(/0+$/, '');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return shownFraction ? `${groupedWhole}.${shownFraction}` : groupedWhole;
}

export function formatSwapRate({ direction, amountIn, amountOut }: SwapQuote) {
  const oneEth = 10n ** BigInt(SWAP_ASSET_DECIMALS.ETH);
  const usdcPerEth =
    direction === 'eth-to-usdc' ? (amountOut * oneEth) / amountIn : (amountIn * oneEth) / amountOut;
  return `1 ETH ≈ ${formatSwapAmount(usdcPerEth, 'USDC')} USDC`;
}

let defaultClient: Promise<SwapQuoteClient> | undefined;

function getDefaultSwapQuoteClient() {
  if (defaultClient) return defaultClient;
  const pending = (async () => {
    const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
    if (!rpcUrl) throw new Error('EXPO_PUBLIC_SEPOLIA_RPC_URL is required for swap quotes');
    const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    if ((await client.getChainId()) !== sepolia.id) {
      throw new Error('Swap RPC is not Ethereum Sepolia');
    }
    return client;
  })();
  defaultClient = pending;
  pending.catch(() => {
    if (defaultClient === pending) defaultClient = undefined;
  });
  return pending;
}
