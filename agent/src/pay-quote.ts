import { decodeFunctionData, getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';

import { TradingApiError, TRADING_ROUTER_VERSION, type TradingApiClient } from './uniswap-trading.ts';

// Pay a recipient an exact amount of one asset while spending the other, routed by the Uniswap
// Trading API. The payee never reaches Uniswap or this service: the swap output goes to the
// account, and the app appends its own transfer, approvals and checks.
// See docs/plans/pay-with-any-token.md and docs/research/trading-api-pay-with-sepolia.md.

export const SEPOLIA_CHAIN_ID = 11155111;
export const TRADING_UNIVERSAL_ROUTER: Address = '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3';
const SLIPPAGE_PERCENT = 0.5;
// /swap_5792 ignores a requested deadline and encodes its own, 30 minutes after quoting.
const MAX_DEADLINE_SECONDS = 30 * 60 + 120;
const universalRouterAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);

export const PAY_ASSETS = {
  ETH: { address: zeroAddress, decimals: 18, maxAmountOut: 10n ** 18n },
  USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address, decimals: 6, maxAmountOut: 10_000n * 10n ** 6n },
} as const;
export type PayAsset = keyof typeof PAY_ASSETS;

const payAsset = z.enum(['ETH', 'USDC']);
export const PayQuoteRequestSchema = z
  .object({
    account: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid address'),
    payAsset,
    receiveAsset: payAsset,
    amountOut: z.string().regex(/^[1-9]\d{0,39}$/, 'Base-unit integer'),
  })
  .refine((request) => request.payAsset !== request.receiveAsset, 'Assets must differ')
  // Zod still runs object refinements when a field failed, so skip values the field checks reject.
  .refine((request) => {
    const asset = PAY_ASSETS[request.receiveAsset as PayAsset] as (typeof PAY_ASSETS)[PayAsset] | undefined;
    if (!asset || !/^[1-9]\d*$/.test(String(request.amountOut))) return true;
    return BigInt(request.amountOut) <= asset.maxAmountOut;
  }, 'Amount is above the limit');
export type PayQuoteRequest = z.infer<typeof PayQuoteRequestSchema>;

export type PayQuote = {
  quoteId: string | null;
  requestId: string | null;
  quotedAt: string;
  deadline: number;
  routerVersion: string;
  payAsset: PayAsset;
  receiveAsset: PayAsset;
  amountIn: string;
  maxAmountIn: string;
  amountOut: string;
  route: string | null;
  priceImpactPercent: number | null;
  swap: { to: Address; value: string; data: Hex };
};

/** Thrown when the API answered but its calls are not the single router call Sodera expects. */
export class UnexpectedPayCallsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnexpectedPayCallsError';
  }
}

export function createPayQuoter({ trading, now = Date.now }: { trading: TradingApiClient; now?: () => number }) {
  return async (request: PayQuoteRequest): Promise<PayQuote> => {
    const account = getAddress(request.account);
    const input = PAY_ASSETS[request.payAsset];
    const output = PAY_ASSETS[request.receiveAsset];

    const quoted = await trading.quote({
      type: 'EXACT_OUTPUT',
      amount: request.amountOut,
      tokenIn: input.address,
      tokenOut: output.address,
      tokenInChainId: SEPOLIA_CHAIN_ID,
      tokenOutChainId: SEPOLIA_CHAIN_ID,
      swapper: account,
      slippageTolerance: SLIPPAGE_PERCENT,
      routingPreference: 'BEST_PRICE',
      protocols: ['V2', 'V3', 'V4'],
    });
    const quote = quoted.quote;
    if (quoted.routing !== 'CLASSIC' || !quote?.input?.amount) {
      throw new TradingApiError(502, 'UnexpectedQuote', `Expected a CLASSIC quote, got ${String(quoted.routing)}`);
    }
    const amountIn = BigInt(quote.input.amount);
    const maxAmountIn = BigInt(quote.input.maximumAmount ?? quote.input.amount);
    if (BigInt(quote.output?.amount ?? '0') !== BigInt(request.amountOut)) {
      throw new UnexpectedPayCallsError('Quote output does not match the requested amount');
    }

    const quotedAt = now();
    const batch = await trading.swap5792({
      quote,
      ...(quoted.permitData ? { permitData: quoted.permitData } : {}),
    });

    // The API also returns unlimited approvals; the app replaces them with ones capped at maxAmountIn.
    const calls: { to?: string; data?: string; value?: string }[] = Array.isArray(batch.calls) ? batch.calls : [];
    const routerCalls = calls.filter((call) => call.to?.toLowerCase() === TRADING_UNIVERSAL_ROUTER.toLowerCase());
    const [routerCall] = routerCalls;
    if (routerCalls.length !== 1 || !routerCall?.data) {
      throw new UnexpectedPayCallsError('Expected exactly one Universal Router execute call');
    }
    let deadline: number;
    try {
      const { functionName, args } = decodeFunctionData({ abi: universalRouterAbi, data: routerCall.data as Hex });
      if (functionName !== 'execute') throw new Error('not execute');
      deadline = Number(args[2]);
    } catch {
      throw new UnexpectedPayCallsError('Expected exactly one Universal Router execute call');
    }
    const nowSeconds = Math.floor(quotedAt / 1000);
    if (deadline <= nowSeconds || deadline > nowSeconds + MAX_DEADLINE_SECONDS) {
      throw new UnexpectedPayCallsError('Router deadline is outside the expected window');
    }
    const value = BigInt(routerCall.value ?? '0');
    if (request.payAsset === 'ETH' ? value > maxAmountIn : value !== 0n) {
      throw new UnexpectedPayCallsError('Router call value is outside the quoted bounds');
    }

    return {
      quoteId: typeof quote.quoteId === 'string' ? quote.quoteId : null,
      requestId: typeof quoted.requestId === 'string' ? quoted.requestId : null,
      quotedAt: new Date(quotedAt).toISOString(),
      deadline,
      routerVersion: TRADING_ROUTER_VERSION,
      payAsset: request.payAsset,
      receiveAsset: request.receiveAsset,
      amountIn: amountIn.toString(),
      maxAmountIn: maxAmountIn.toString(),
      amountOut: request.amountOut,
      route: typeof quote.routeString === 'string' ? quote.routeString : null,
      priceImpactPercent: typeof quote.priceImpact === 'number' ? quote.priceImpact : null,
      swap: { to: TRADING_UNIVERSAL_ROUTER, value: value.toString(), data: routerCall.data as Hex },
    };
  };
}

export type PayQuoter = ReturnType<typeof createPayQuoter>;
