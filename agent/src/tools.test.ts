import { getAddress, type Address } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { MULTIBAAS_CONTRACTS, type EventQuery } from './multibaas.ts';
import { getActivity, getEthPrice, quoteSwap, resolveName, summarizeActivity, type ToolDependencies } from './tools.ts';
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
    toolResults: [],
    ranges: [],
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

describe('summarize_activity', () => {
  const BOB = '0x4444444444444444444444444444444444444444';
  const PAYMASTER = '0x777777777777aec03fd955926dbf81597e66834c';
  type Query = EventQuery;

  type Rows = Record<string, unknown>[];
  function multibaas(overrides: { sent?: Rows; received?: Rows; gas?: Rows; recentSent?: Rows } = {}) {
    return fakeMultiBaas({
      executeEventQuery: vi.fn(async (query: Query) => {
        const event = query.events[0]!;
        if (event.eventName === 'UserOperationEvent') {
          return overrides.gas ?? [
            { paymaster: '0x0000000000000000000000000000000000000000', gas: '400000000000000' },
            { paymaster: PAYMASTER, gas: '1200000000000000' },
          ];
        }
        const children = (event.filter as { children: { fieldType: string; inputIndex?: number; value: string }[] }).children;
        const sent = children.some((child) => child.inputIndex === 0 && child.value === ACCOUNT.toLowerCase());
        if (query.groupBy) {
          return sent
            ? (overrides.sent ?? [{ counterparty: ALICE, total: '42500000' }, { counterparty: BOB, total: '100000000' }])
            : (overrides.received ?? [{ counterparty: BOB, total: '300000000' }]);
        }
        return sent
          ? (overrides.recentSent ?? [{ timestamp: '2026-09-20 10:00:00+00', counterparty: ALICE, value: '42500000' }])
          : [];
      }),
    });
  }

  it('builds grouped, date-bounded queries by contract and lowercase account', async () => {
    const tool = deps({ multibaas: multibaas() });
    await summarizeActivity(tool, { from: '2026-09-01', to: '2026-09-27' });

    const queries = (tool.multibaas.executeEventQuery as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => query as Query);
    expect(queries).toHaveLength(5);
    for (const query of queries) {
      const text = JSON.stringify(query);
      expect(text).toContain(ACCOUNT.toLowerCase());
      expect(text).toContain('{"fieldType":"triggered_at","operator":"greaterthanorequal","value":"2026-09-01"}');
      expect(text).toContain('{"fieldType":"triggered_at","operator":"lessthan","value":"2026-09-27"}');
    }
    const grouped = queries.filter((query) => query.groupBy);
    expect(grouped.map((query) => query.groupBy)).toEqual(['counterparty', 'counterparty', 'paymaster']);
    expect(grouped.every((query) => query.events[0]!.select.some((field) => field.aggregator === 'add'))).toBe(true);
    expect(JSON.stringify(grouped[2])).toContain(MULTIBAAS_CONTRACTS.entryPoint.address);
    expect(tool.ranges).toEqual([{ from: '2026-09-01', to: '2026-09-27' }]);
  });

  it('totals transfers by counterparty with address book names and splits gas by payer', async () => {
    const result = await summarizeActivity(deps({ multibaas: multibaas() }), { from: '2026-09-01', to: '2026-09-27' });

    expect(result).toEqual({
      range: { firstDay: '2026-09-01', lastDay: '2026-09-26' },
      coverage: expect.stringContaining('ETH transfers are not included'),
      usdc: {
        sent: '142.5',
        received: '300',
        net: '157.5',
        byCounterparty: [
          { address: getAddress(BOB), name: null, sent: '100', received: '300' },
          { address: getAddress(ALICE), name: 'alice', sent: '42.5', received: '0' },
        ],
      },
      gas: { paidEth: '0.0004', sponsoredEth: '0.0012' },
      recent: [
        { direction: 'sent', amount: '42.5', counterparty: getAddress(ALICE), name: 'alice', timestamp: '2026-09-20T10:00:00.000Z' },
      ],
      truncated: false,
    });
  });

  it('limits transfers to a named counterparty and leaves gas out', async () => {
    const tool = deps({ multibaas: multibaas({ sent: [{ counterparty: ALICE, total: '42500000' }], received: [] }) });
    const result = await summarizeActivity(tool, { from: '2026-09-01', to: '2026-09-27', counterparty: 'Alice' });

    expect(result).toMatchObject({ usdc: { sent: '42.5', received: '0', net: '-42.5' }, gas: null });
    const queries = (tool.multibaas.executeEventQuery as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => JSON.stringify(query));
    expect(queries).toHaveLength(4);
    expect(queries.every((query) => query.includes(ALICE.toLowerCase()))).toBe(true);
  });

  it('flags results that hit the query limit and skips malformed rows', async () => {
    const full = Array.from({ length: 50 }, (_, index) => ({
      counterparty: `0x${(index + 16).toString(16).padStart(40, '0')}`,
      total: '1000000',
    }));
    const result = await summarizeActivity(
      deps({ multibaas: multibaas({ sent: [...full, { counterparty: 'nope', total: '5' }, { counterparty: ALICE, total: '1.5' }] }) }),
      { from: '2026-09-01', to: '2026-09-27' },
    );
    expect(result).toMatchObject({ usdc: { sent: '50' }, truncated: true });
  });

  it('rejects bad ranges and unknown counterparties without querying', async () => {
    const tool = deps({ multibaas: multibaas() });
    await expect(summarizeActivity(tool, { from: '2026-09-01T00:00:00Z', to: '2026-09-27' })).resolves.toEqual({
      error: 'from and to must be UTC dates written as YYYY-MM-DD',
    });
    await expect(summarizeActivity(tool, { from: '2026-02-30', to: '2026-03-02' })).resolves.toMatchObject({ error: expect.any(String) });
    await expect(summarizeActivity(tool, { from: '2026-09-27', to: '2026-09-27' })).resolves.toEqual({ error: 'to must be later than from' });
    await expect(summarizeActivity(tool, { from: '2025-01-01', to: '2026-09-27' })).resolves.toEqual({
      error: 'the range can cover at most 366 days',
    });
    await expect(summarizeActivity(tool, { from: '2026-09-01', to: '2026-09-27', counterparty: 'carol' })).resolves.toEqual({
      error: 'unknown counterparty',
    });
    expect(tool.multibaas.executeEventQuery).not.toHaveBeenCalled();
  });
});
