import { encodeFunctionData, getAddress, parseAbi, zeroAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import {
  createPayQuoter,
  PayQuoteRequestSchema,
  TRADING_UNIVERSAL_ROUTER,
  UnexpectedPayCallsError,
  type PayQuoteRequest,
} from './pay-quote.ts';
import type { TradingApiClient } from './uniswap-trading.ts';
import { ACCOUNT } from './test/fixtures.ts';

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const NOW = Date.parse('2026-09-26T08:00:00.000Z');
const ROUTER_DEADLINE = NOW / 1000 + 1800;
const executeAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const routerData = (deadline = ROUTER_DEADLINE) =>
  encodeFunctionData({ abi: executeAbi, functionName: 'execute', args: ['0x10', ['0x'], BigInt(deadline)] });
const ROUTER_DATA = routerData();

const ethToUsdc: PayQuoteRequest = { account: ACCOUNT, payAsset: 'ETH', receiveAsset: 'USDC', amountOut: '10000000' };
const usdcToEth: PayQuoteRequest = {
  account: ACCOUNT,
  payAsset: 'USDC',
  receiveAsset: 'ETH',
  amountOut: '1000000000000000',
};

function quoteResponse(request: PayQuoteRequest, overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    routing: 'CLASSIC',
    permitData: request.payAsset === 'USDC' ? { domain: {}, types: {}, values: {} } : null,
    quote: {
      quoteId: 'quote-1',
      input: { amount: '1000', maximumAmount: '1005' },
      output: { amount: request.amountOut },
      routeString: '[v4] 100.00% = pool',
      priceImpact: 0.84,
    },
    ...overrides,
  };
}

function routerCall(value = '0') {
  return { to: TRADING_UNIVERSAL_ROUTER, data: ROUTER_DATA, value };
}

function setup(quote: Record<string, unknown>, calls: unknown[]) {
  const trading: TradingApiClient = {
    quote: vi.fn().mockResolvedValue(quote),
    swap5792: vi.fn().mockResolvedValue({ calls }),
  };
  return { trading, quotePay: createPayQuoter({ trading, now: () => NOW }) };
}

describe('pay quote request schema', () => {
  it('accepts either direction and rejects same assets, bad amounts and addresses', () => {
    expect(PayQuoteRequestSchema.safeParse(ethToUsdc).success).toBe(true);
    expect(PayQuoteRequestSchema.safeParse(usdcToEth).success).toBe(true);
    expect(PayQuoteRequestSchema.safeParse({ ...ethToUsdc, receiveAsset: 'ETH' }).success).toBe(false);
    expect(PayQuoteRequestSchema.safeParse({ ...ethToUsdc, amountOut: '0' }).success).toBe(false);
    expect(PayQuoteRequestSchema.safeParse({ ...ethToUsdc, amountOut: '1.5' }).success).toBe(false);
    expect(PayQuoteRequestSchema.safeParse({ ...ethToUsdc, amountOut: String(10_001n * 10n ** 6n) }).success).toBe(false);
    expect(PayQuoteRequestSchema.safeParse({ ...usdcToEth, amountOut: String(2n * 10n ** 18n) }).success).toBe(false);
    expect(PayQuoteRequestSchema.safeParse({ ...ethToUsdc, account: '0x123' }).success).toBe(false);
  });
});

describe('pay quoter', () => {
  it('asks for an exact-output quote to the account, never to a recipient', async () => {
    const { trading, quotePay } = setup(quoteResponse(ethToUsdc), [routerCall('1005')]);

    await quotePay(ethToUsdc);

    expect(trading.quote).toHaveBeenCalledWith({
      type: 'EXACT_OUTPUT',
      amount: '10000000',
      tokenIn: zeroAddress,
      tokenOut: USDC,
      tokenInChainId: 11155111,
      tokenOutChainId: 11155111,
      swapper: getAddress(ACCOUNT),
      slippageTolerance: 0.5,
      routingPreference: 'BEST_PRICE',
      protocols: ['V2', 'V3', 'V4'],
    });
    expect(JSON.stringify(vi.mocked(trading.quote).mock.calls)).not.toContain('recipient');
  });

  it('keeps only the router call and returns the quoted bounds', async () => {
    const approvals = [
      { to: USDC, data: '0x095ea7b3', value: '0' },
      { to: PERMIT2, data: '0x87517c45', value: '0' },
    ];
    const { trading, quotePay } = setup(quoteResponse(usdcToEth), [...approvals, routerCall()]);

    const quote = await quotePay(usdcToEth);

    expect(trading.swap5792).toHaveBeenCalledWith({
      quote: quoteResponse(usdcToEth).quote,
      permitData: { domain: {}, types: {}, values: {} },
    });
    expect(quote).toEqual({
      quoteId: 'quote-1',
      requestId: 'req-1',
      quotedAt: '2026-09-26T08:00:00.000Z',
      deadline: ROUTER_DEADLINE,
      routerVersion: '2.1.2',
      payAsset: 'USDC',
      receiveAsset: 'ETH',
      amountIn: '1000',
      maxAmountIn: '1005',
      amountOut: '1000000000000000',
      route: '[v4] 100.00% = pool',
      priceImpactPercent: 0.84,
      swap: { to: TRADING_UNIVERSAL_ROUTER, value: '0', data: ROUTER_DATA },
    });
  });

  it('rejects quotes and calls it cannot vouch for', async () => {
    const cases: [PayQuoteRequest, Record<string, unknown>, unknown[]][] = [
      [ethToUsdc, quoteResponse(ethToUsdc), []],
      [ethToUsdc, quoteResponse(ethToUsdc), [routerCall('1005'), routerCall('1')]],
      [ethToUsdc, quoteResponse(ethToUsdc), [{ ...routerCall('1005'), data: '0xdeadbeef' }]],
      [ethToUsdc, quoteResponse(ethToUsdc), [{ ...routerCall('1005'), data: routerData(NOW / 1000 - 1) }]],
      [ethToUsdc, quoteResponse(ethToUsdc), [{ ...routerCall('1005'), data: routerData(NOW / 1000 + 3600) }]],
      [ethToUsdc, quoteResponse(ethToUsdc), [routerCall('1006')]],
      [usdcToEth, quoteResponse(usdcToEth), [routerCall('1')]],
      [
        ethToUsdc,
        quoteResponse(ethToUsdc, { quote: { ...quoteResponse(ethToUsdc).quote, output: { amount: '9999999' } } }),
        [routerCall('1005')],
      ],
    ];
    for (const [request, quote, calls] of cases) {
      await expect(setup(quote, calls).quotePay(request)).rejects.toBeInstanceOf(UnexpectedPayCallsError);
    }

    const dutch = setup(quoteResponse(ethToUsdc, { routing: 'DUTCH_V2' }), [routerCall('1005')]);
    await expect(dutch.quotePay(ethToUsdc)).rejects.toMatchObject({ code: 'UnexpectedQuote' });
  });
});
