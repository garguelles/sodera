import { getAddress, type Address } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { MULTIBAAS_CONTRACTS } from './multibaas.ts';
import { getActivity, getEthPrice, quoteSwap, resolveName, type ToolDependencies } from './tools.ts';
import { fakeMultiBaas } from './test/fakes.ts';
import { createSwapQuoter, SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS, SWAP_POOL_KEY } from './uniswap.ts';
import { ACCOUNT, ALICE, createContext } from './test/fixtures.ts';

const now = Date.parse('2026-09-26T08:00:00Z');

function deps(overrides: Partial<ToolDependencies> = {}): ToolDependencies {
  return {
    account: getAddress(ACCOUNT),
    context: createContext(),
    multibaas: fakeMultiBaas(),
    resolveEns: vi.fn().mockResolvedValue(null),
    quoteSwap: vi.fn(),
    now: () => now,
    resolvedNames: new Map(),
    calls: [],
    ...overrides,
  };
}

describe('resolve_name', () => {
  it('prefers the address book and records the result for the policy check', async () => {
    const resolveEns = vi.fn();
    const tool = deps({ resolveEns });

    await expect(resolveName(tool, { name: 'Alice' })).resolves.toEqual({
      address: getAddress(ALICE),
      source: 'address_book',
    });
    expect(resolveEns).not.toHaveBeenCalled();
    expect(tool.resolvedNames.get('alice')).toBe(getAddress(ALICE));
  });

  it('falls back to ENS for dotted names', async () => {
    const ens = '0x3333333333333333333333333333333333333333' as Address;
    const tool = deps({ resolveEns: vi.fn().mockResolvedValue(ens) });

    await expect(resolveName(tool, { name: 'bob.eth' })).resolves.toEqual({ address: ens, source: 'ens' });
    expect(tool.resolvedNames.get('bob.eth')).toBe(ens);
  });

  it('returns unknown for names it cannot resolve', async () => {
    const resolveEns = vi.fn().mockResolvedValue(null);
    await expect(resolveName(deps({ resolveEns }), { name: 'carol.eth' })).resolves.toEqual({ error: 'unknown' });
    await expect(resolveName(deps({ resolveEns }), { name: 'carol' })).resolves.toEqual({ error: 'unknown' });
    expect(resolveEns).toHaveBeenCalledTimes(1);
  });
});

describe('get_eth_price', () => {
  const feed = (updatedAt: number, answer = '268775750636') =>
    fakeMultiBaas({
      callMethod: vi.fn(async (_address, _label, method) =>
        method === 'decimals' ? '8' : ['1', answer, String(updatedAt), String(updatedAt), '1'],
      ),
    });

  it('reads a fresh price through the linked feed', async () => {
    const multibaas = feed(now / 1000 - 60);
    await expect(getEthPrice(deps({ multibaas }))).resolves.toEqual({
      usd: '2687.75750636',
      updatedAt: new Date(now - 60_000).toISOString(),
    });
    expect(multibaas.callMethod).toHaveBeenCalledWith(
      MULTIBAAS_CONTRACTS.ethUsdFeed.address,
      'ethprice',
      'latestRoundData',
      [],
    );
  });

  it('refuses stale, future, or non-positive prices', async () => {
    await expect(getEthPrice(deps({ multibaas: feed(now / 1000 - 7_201) }))).resolves.toEqual({ error: 'price is stale' });
    await expect(getEthPrice(deps({ multibaas: feed(now / 1000 + 301) }))).resolves.toEqual({ error: 'price is stale' });
    await expect(getEthPrice(deps({ multibaas: feed(now / 1000, '0') }))).resolves.toEqual({ error: 'price is stale' });
  });
});

describe('quote_swap', () => {
  const swapContext = createContext({ capabilities: { ...createContext().capabilities, swap: true } });

  it('quotes through the pinned pool in the input asset\'s units', async () => {
    const quote = vi.fn().mockResolvedValue({ amountOut: 26_877_575n, minAmountOut: 26_743_855n });
    await expect(quoteSwap(deps({ context: swapContext, quoteSwap: quote }), { direction: 'eth_to_usdc', amountIn: '0.01' })).resolves.toEqual({
      amountIn: '0.01 ETH',
      expectedOut: '26.877575 USDC',
      minimumOut: '26.743855 USDC',
      slippage: '0.5%',
      venue: 'Uniswap v4 on Sepolia',
    });
    expect(quote).toHaveBeenCalledWith('eth_to_usdc', 10_000_000_000_000_000n);

    await quoteSwap(deps({ context: swapContext, quoteSwap: quote }), { direction: 'usdc_to_eth', amountIn: '5' });
    expect(quote).toHaveBeenLastCalledWith('usdc_to_eth', 5_000_000n);
  });

  it('rejects malformed amounts and swaps the phone has not enabled', async () => {
    const quote = vi.fn();
    await expect(quoteSwap(deps({ context: swapContext, quoteSwap: quote }), { direction: 'usdc_to_eth', amountIn: '1.0000001' })).resolves.toMatchObject({
      error: expect.stringContaining('at most 6 decimals'),
    });
    await expect(quoteSwap(deps({ quoteSwap: quote }), { direction: 'eth_to_usdc', amountIn: '0.01' })).resolves.toEqual({
      error: 'swaps unavailable',
    });
    expect(quote).not.toHaveBeenCalled();
  });
});

describe('createSwapQuoter', () => {
  it('calls the V4 quoter with the pinned pool and derives the SDK minimum', async () => {
    const simulateContract = vi.fn().mockResolvedValue({ result: [1_005_000n, 90_000n] });
    const quoter = createSwapQuoter({ simulateContract });

    await expect(quoter('usdc_to_eth', 5_000_000n)).resolves.toEqual({ amountOut: 1_005_000n, minAmountOut: 1_000_000n });
    expect(simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
        functionName: 'quoteExactInputSingle',
        args: [{ poolKey: SWAP_POOL_KEY, zeroForOne: false, exactAmount: 5_000_000n, hookData: '0x' }],
      }),
    );
  });

  it('refuses an empty quote', async () => {
    const quoter = createSwapQuoter({ simulateContract: vi.fn().mockResolvedValue({ result: [0n, 0n] }) });
    await expect(quoter('eth_to_usdc', 1n)).rejects.toThrow('The pool cannot fill this amount');
  });
});

describe('get_activity', () => {
  it('queries by contract address and lowercase account, and merges rows newest first', async () => {
    const executeEventQuery = vi.fn(async (query: { events: { eventName: string; filter?: unknown }[] }) => {
      const event = query.events[0]!;
      if (event.eventName === 'UserOperationEvent') {
        return [{ timestamp: '2026-09-26 07:00:00+00', userOpHash: `[${Array(32).fill(1).join(', ')}]`, success: 'true' }];
      }
      const filter = event.filter as { children: { inputIndex?: number }[] };
      return filter.children.some((child) => child.inputIndex === 0)
        ? [{ timestamp: '2026-09-26 06:00:00+00', from: ACCOUNT, to: ALICE, value: '1500000' }]
        : [{ timestamp: '2026-09-26 07:30:00+00', from: ALICE, to: ACCOUNT, value: '250000' }];
    });

    const result = await getActivity(deps({ multibaas: fakeMultiBaas({ executeEventQuery }) }), {});

    expect(result.activity).toEqual([
      { direction: 'received', asset: 'USDC', amount: '0.25', counterparty: getAddress(ALICE), timestamp: '2026-09-26T07:30:00.000Z', success: null },
      { direction: 'operation', asset: null, amount: null, counterparty: null, timestamp: '2026-09-26T07:00:00.000Z', success: true },
      { direction: 'sent', asset: 'USDC', amount: '1.5', counterparty: getAddress(ALICE), timestamp: '2026-09-26T06:00:00.000Z', success: null },
    ]);
    const filters = executeEventQuery.mock.calls.map(([query]) => JSON.stringify(query));
    expect(filters.every((filter) => filter.includes(ACCOUNT.toLowerCase()))).toBe(true);
    expect(filters.some((filter) => filter.includes(MULTIBAAS_CONTRACTS.entryPoint.address))).toBe(true);
  });
});
