import {
  CurrencyAmount,
  Percent,
  Rounding,
  TradeType,
  type Currency,
} from '@uniswap/sdk-core';
import { Pool, Route, Trade } from '@uniswap/v4-sdk';
import { createPublicClient, http, parseAbi, parseUnits, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';

import { SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS, SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS } from './sepolia';
import { SWAP_ETH, SWAP_POOL_ID, SWAP_POOL_KEY, SWAP_USDC } from './uniswap-sdk';

export type SwapAsset = 'ETH' | 'USDC';
export type SwapDirection = 'eth-to-usdc' | 'usdc-to-eth';

export const SWAP_ASSET_DECIMALS: Record<SwapAsset, number> = { ETH: 18, USDC: 6 };
const SWAP_ASSET_DISPLAY_DECIMALS: Record<SwapAsset, number> = { ETH: 8, USDC: 2 };
const SWAP_CURRENCIES: Record<SwapAsset, Currency> = { ETH: SWAP_ETH, USDC: SWAP_USDC };
const DISPLAY_FORMAT = { groupSeparator: ',' };

// currency0 is native ETH, so ETH -> USDC swaps zero for one.
export const SWAP_DIRECTIONS = {
  'eth-to-usdc': { input: 'ETH', output: 'USDC', zeroForOne: true },
  'usdc-to-eth': { input: 'USDC', output: 'ETH', zeroForOne: false },
} as const satisfies Record<
  SwapDirection,
  { input: SwapAsset; output: SwapAsset; zeroForOne: boolean }
>;

export const SWAP_SLIPPAGE = new Percent(50, 10_000);
export const SWAP_SLIPPAGE_LABEL = `${SWAP_SLIPPAGE.toFixed(1)}%`;

export type SwapQuote = {
  direction: SwapDirection;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  trade: Trade<Currency, Currency, TradeType.EXACT_INPUT>;
  priceImpact: Percent;
};

export type SwapQuoteClient = Pick<PublicClient, 'getChainId' | 'readContract' | 'simulateContract'>;

const v4QuoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);
const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
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

// The V4 Quoter simulates the swap; the SDK trade built from its result supplies the minimum
// received, execution price and price impact against the pool's current mid price.
export async function quoteSwap(
  { direction, amountIn }: { direction: SwapDirection; amountIn: bigint },
  client?: SwapQuoteClient,
): Promise<SwapQuote> {
  const quoteClient = client ?? (await getDefaultSwapQuoteClient());
  const [{ result }, [sqrtPriceX96, tick], liquidity] = await Promise.all([
    quoteClient.simulateContract({
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
    }),
    quoteClient.readContract({
      address: SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS,
      abi: stateViewAbi,
      functionName: 'getSlot0',
      args: [SWAP_POOL_ID],
    }),
    quoteClient.readContract({
      address: SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS,
      abi: stateViewAbi,
      functionName: 'getLiquidity',
      args: [SWAP_POOL_ID],
    }),
  ]);
  const [amountOut] = result;
  if (amountOut <= 0n) throw new Error('The pool cannot fill this amount');

  const pool = new Pool(
    SWAP_ETH,
    SWAP_USDC,
    SWAP_POOL_KEY.fee,
    SWAP_POOL_KEY.tickSpacing,
    SWAP_POOL_KEY.hooks,
    sqrtPriceX96.toString(),
    liquidity.toString(),
    tick,
  );
  const { input, output } = SWAP_DIRECTIONS[direction];
  const trade = Trade.createUncheckedTrade({
    route: new Route([pool], SWAP_CURRENCIES[input], SWAP_CURRENCIES[output]),
    inputAmount: CurrencyAmount.fromRawAmount(SWAP_CURRENCIES[input], amountIn.toString()),
    outputAmount: CurrencyAmount.fromRawAmount(SWAP_CURRENCIES[output], amountOut.toString()),
    tradeType: TradeType.EXACT_INPUT,
  });
  return {
    direction,
    amountIn,
    amountOut,
    minAmountOut: BigInt(trade.minimumAmountOut(SWAP_SLIPPAGE).quotient.toString()),
    trade,
    priceImpact: trade.priceImpact,
  };
}

export function formatSwapAmount(amount: bigint, asset: SwapAsset) {
  return trimTrailingZeros(
    CurrencyAmount.fromRawAmount(SWAP_CURRENCIES[asset], amount.toString()).toFixed(
      SWAP_ASSET_DISPLAY_DECIMALS[asset],
      DISPLAY_FORMAT,
      Rounding.ROUND_DOWN,
    ),
  );
}

export function formatSwapRate({ direction, trade }: SwapQuote) {
  const usdcPerEth =
    direction === 'eth-to-usdc' ? trade.executionPrice : trade.executionPrice.invert();
  return `1 ETH ≈ ${trimTrailingZeros(usdcPerEth.toFixed(2, DISPLAY_FORMAT, Rounding.ROUND_DOWN))} USDC`;
}

const HIGH_PRICE_IMPACT = new Percent(1, 100);

export function isHighPriceImpact(priceImpact: Percent) {
  return priceImpact.greaterThan(HIGH_PRICE_IMPACT);
}

export function formatPriceImpact(priceImpact: Percent) {
  return priceImpact.lessThan(new Percent(1, 10_000))
    ? '<0.01%'
    : `${priceImpact.toFixed(2, undefined, Rounding.ROUND_UP)}%`;
}

function trimTrailingZeros(value: string) {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

let defaultClient: Promise<SwapQuoteClient> | undefined;

function getDefaultSwapQuoteClient() {
  if (defaultClient) return defaultClient;
  const pending = (async () => {
    const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
    if (!rpcUrl) throw new Error('Ethereum RPC URL is required for swap quotes');
    const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    if ((await client.getChainId()) !== sepolia.id) {
      throw new Error('Swap RPC is connected to the wrong network');
    }
    return client;
  })();
  defaultClient = pending;
  pending.catch(() => {
    if (defaultClient === pending) defaultClient = undefined;
  });
  return pending;
}
