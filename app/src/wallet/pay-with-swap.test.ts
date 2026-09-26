import { decodeFunctionData, encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from 'viem';

import type { PayQuote, PayQuoteRequest } from '../agent/agent-client';
import { buildPayWithCalls, PayWithSwapRejectedError, verifyPayWithSwap } from './pay-with-swap';
import {
  ethForTenUsdc,
  ethForUsdcViaV3,
  PAY_FIXTURE_ACCOUNT,
  usdcForCentiEth,
  usdcForMilliEth,
} from './pay-with-swap-fixtures';
import {
  SEPOLIA_PERMIT2_ADDRESS,
  SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
} from './sepolia';

const PAYEE: Address = '0x000000000000000000000000000000000000bEEF';
const STRANGER = '000000000000000000000000000000000000dead';
const routerAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const permit2Abi = parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)']);

function requestFor(quote: PayQuote): PayQuoteRequest {
  return { account: PAY_FIXTURE_ACCOUNT, payAsset: quote.payAsset, receiveAsset: quote.receiveAsset, amountOut: quote.amountOut };
}

function verify(quote: PayQuote, request = requestFor(quote)) {
  return verifyPayWithSwap({ request, quote, nowMs: Date.parse(quote.quotedAt) });
}

function withData(quote: PayQuote, data: string): PayQuote {
  return { ...quote, swap: { ...quote.swap, data } };
}

function reencode(quote: PayQuote, edit: (commands: Hex, inputs: readonly Hex[]) => [Hex, readonly Hex[]]) {
  const { args } = decodeFunctionData({ abi: routerAbi, data: quote.swap.data as Hex });
  const [commands, inputs] = edit(args[0], args[1]);
  return withData(quote, encodeFunctionData({ abi: routerAbi, functionName: 'execute', args: [commands, inputs, args[2]] }));
}

describe('pay with swap guard', () => {
  it.each([
    ['10 USDC paid with ETH through v4', ethForTenUsdc],
    ['0.001 ETH paid with USDC through v4', usdcForMilliEth],
    ['250 USDC paid with ETH through v3', ethForUsdcViaV3],
    ['0.02 ETH paid with USDC through v4', usdcForCentiEth],
  ])('accepts the real %s quote', (_name, quote) => {
    expect(verify(quote)).toEqual({
      swap: { to: SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS, value: BigInt(quote.swap.value), data: quote.swap.data },
      maxAmountIn: BigInt(quote.maxAmountIn),
      amountOut: BigInt(quote.amountOut),
      deadline: quote.deadline,
    });
  });

  const tampered: [string, PayQuote, PayQuoteRequest?][] = [
    ['a quote for another amount', ethForTenUsdc, { ...requestFor(ethForTenUsdc), amountOut: '9999999' }],
    ['a quote in the other direction', ethForTenUsdc, { ...requestFor(ethForTenUsdc), payAsset: 'USDC', receiveAsset: 'ETH' }],
    ['a foreign target', { ...ethForTenUsdc, swap: { ...ethForTenUsdc.swap, to: `0x${STRANGER}` } }],
    ['a wrong selector', withData(ethForTenUsdc, `0xdeadbeef${ethForTenUsdc.swap.data.slice(10)}`)],
    ['excess ETH value', { ...ethForTenUsdc, swap: { ...ethForTenUsdc.swap, value: String(BigInt(ethForTenUsdc.maxAmountIn) + 1n) } }],
    ['ETH value when paying with USDC', { ...usdcForMilliEth, swap: { ...usdcForMilliEth.swap, value: '1' } }],
    ['a deadline that differs from the quote', { ...usdcForMilliEth, deadline: usdcForMilliEth.deadline + 1 }],
    ['a lower maximum than the swap allows', { ...usdcForMilliEth, maxAmountIn: String(BigInt(usdcForMilliEth.amountIn)) }],
    ['a v4 take and sweep to someone else', withData(ethForTenUsdc, ethForTenUsdc.swap.data.replace(/fbf2213c7f5de314729293ff1b541f8591637658/gi, STRANGER))],
    ['a v4 take to someone else', withData(usdcForMilliEth, usdcForMilliEth.swap.data.replace(/fbf2213c7f5de314729293ff1b541f8591637658/gi, STRANGER))],
    ['a v3 swap and unwrap to someone else', withData(ethForUsdcViaV3, ethForUsdcViaV3.swap.data.replace(/fbf2213c7f5de314729293ff1b541f8591637658/gi, STRANGER))],
    ['a command allowed to revert', reencode(usdcForMilliEth, (_commands, inputs) => ['0x90', inputs])],
    ['an unknown command', reencode(usdcForMilliEth, (_commands, inputs) => ['0x05', inputs])],
    ['commands without inputs', reencode(usdcForMilliEth, (commands) => [commands, []])],
    ['a wrap when paying with USDC', reencode(usdcForMilliEth, (_commands, inputs) => ['0x0b10', [decodeWrapInput(ethForUsdcViaV3), inputs[0]]])],
  ];

  it.each(tampered.map(([name, quote, request]) => ({ name, quote, request })))('rejects $name', ({ quote, request }) => {
    expect(() => verify(quote, request)).toThrow(PayWithSwapRejectedError);
  });

  it('rejects expired quotes and deadlines too far out', () => {
    const request = requestFor(usdcForMilliEth);
    expect(() => verifyPayWithSwap({ request, quote: usdcForMilliEth, nowMs: usdcForMilliEth.deadline * 1000 })).toThrow(
      'expired',
    );
    expect(() => verifyPayWithSwap({ request, quote: usdcForMilliEth, nowMs: Date.parse('2026-09-26T08:00:00Z') })).toThrow(
      'too far out',
    );
  });
});

function decodeWrapInput(quote: PayQuote) {
  return decodeFunctionData({ abi: routerAbi, data: quote.swap.data as Hex }).args[1][0];
}

describe('pay with calls', () => {
  it('pays with ETH as the router call and the transfer to the payee', () => {
    const calls = buildPayWithCalls({
      request: requestFor(ethForTenUsdc),
      quote: ethForTenUsdc,
      recipient: PAYEE,
      nowMs: Date.parse(ethForTenUsdc.quotedAt),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      to: SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS,
      value: BigInt(ethForTenUsdc.maxAmountIn),
      data: ethForTenUsdc.swap.data,
    });
    expect(calls[1].to).toBe(SEPOLIA_USDC_ADDRESS);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[1].data }).args).toEqual([PAYEE, 10_000_000n]);
  });

  it('pays with USDC after approvals capped at the quoted maximum until the deadline', () => {
    const calls = buildPayWithCalls({
      request: requestFor(usdcForMilliEth),
      quote: usdcForMilliEth,
      recipient: PAYEE,
      nowMs: Date.parse(usdcForMilliEth.quotedAt),
    });
    const maxAmountIn = BigInt(usdcForMilliEth.maxAmountIn);

    expect(calls.map((call) => call.to)).toEqual([
      SEPOLIA_USDC_ADDRESS,
      SEPOLIA_PERMIT2_ADDRESS,
      SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS,
      PAYEE,
    ]);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data }).args).toEqual([SEPOLIA_PERMIT2_ADDRESS, maxAmountIn]);
    expect(decodeFunctionData({ abi: permit2Abi, data: calls[1].data }).args).toEqual([
      SEPOLIA_USDC_ADDRESS,
      SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS,
      maxAmountIn,
      usdcForMilliEth.deadline,
    ]);
    expect(calls[2].value).toBe(0n);
    expect(calls[3]).toEqual({ to: PAYEE, value: 1_000_000_000_000_000n, data: '0x' });
  });
});
