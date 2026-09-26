import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem';
import { z } from 'zod';

import {
  MULTIBAAS_CONTRACTS,
  MULTIBAAS_MAX_QUERY_LIMIT,
  lowercaseAddress,
  parseBytes32,
  parseTimestamp,
  type MultiBaasClient,
} from './multibaas.ts';
import { roundUnits } from './propose.ts';
import type { AgentContext } from './schema.ts';
import type { SwapDirection, SwapQuoter } from './uniswap.ts';

export const ETH_USD_MAX_AGE_SECONDS = 7_200;
export const ETH_USD_MAX_FUTURE_SECONDS = 300;
export const SUMMARY_MAX_RANGE_DAYS = 366;
export const ACTIVITY_COVERAGE = 'USDC transfers and account operations, by UTC day. ETH transfers are not included.';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DAY_MS = 86_400_000;

export type ToolDependencies = {
  account: Address;
  context: AgentContext;
  multibaas: MultiBaasClient;
  resolveEns: (name: string) => Promise<Address | null>;
  quoteSwap: SwapQuoter;
  now: () => number;
  /** Names resolved during this request, shared with the policy check. */
  resolvedNames: Map<string, Address>;
  /** Tool names called during this request, for the request log. */
  calls: string[];
  /** Every tool result returned during this request, for the answer grounding check. */
  toolResults: string[];
  /** Date ranges `summarize_activity` covered during this request, in call order. */
  ranges: { from: string; to: string }[];
};

type ActivityRow = {
  direction: 'sent' | 'received' | 'operation';
  asset: 'USDC' | null;
  amount: string | null;
  counterparty: Address | null;
  timestamp: string;
  success: boolean | null;
};

export async function getActivity(deps: ToolDependencies, { limit = 20 }: { limit?: number }) {
  const account = lowercaseAddress(deps.account);
  const pageSize = Math.min(Math.max(limit, 1), 20);
  const transferQuery = (inputIndex: 0 | 1) => ({
    events: [
      {
        eventName: 'Transfer',
        select: [
          { type: 'triggered_at', alias: 'timestamp' },
          { type: 'input', inputIndex: 0, alias: 'from' },
          { type: 'input', inputIndex: 1, alias: 'to' },
          { type: 'input', inputIndex: 2, alias: 'value' },
        ],
        filter: {
          rule: 'and',
          children: [
            { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.usdc.address },
            { fieldType: 'input', inputIndex, operator: 'equal', value: account },
          ],
        },
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC' as const,
  });
  const operationQuery = {
    events: [
      {
        eventName: 'UserOperationEvent',
        select: [
          { type: 'triggered_at', alias: 'timestamp' },
          { type: 'input', inputIndex: 0, alias: 'userOpHash' },
          { type: 'input', inputIndex: 4, alias: 'success' },
        ],
        filter: {
          rule: 'and',
          children: [
            { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.entryPoint.address },
            { fieldType: 'input', inputIndex: 1, operator: 'equal', value: account },
          ],
        },
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC' as const,
  };

  const [sent, received, operations] = await Promise.all([
    deps.multibaas.executeEventQuery(transferQuery(0), pageSize),
    deps.multibaas.executeEventQuery(transferQuery(1), pageSize),
    deps.multibaas.executeEventQuery(operationQuery, pageSize),
  ]);

  const rows: ActivityRow[] = [];
  for (const [direction, list] of [
    ['sent', sent],
    ['received', received],
  ] as const) {
    for (const row of list) {
      const timestamp = parseTimestamp(row.timestamp);
      const counterparty = direction === 'sent' ? row.to : row.from;
      if (!timestamp || typeof row.value !== 'string' || !/^\d+$/.test(row.value)) continue;
      if (typeof counterparty !== 'string' || !isAddress(counterparty, { strict: false })) continue;
      rows.push({
        direction,
        asset: 'USDC',
        amount: formatUnits(BigInt(row.value), 6),
        counterparty: getAddress(counterparty),
        timestamp,
        success: null,
      });
    }
  }
  for (const row of operations) {
    const timestamp = parseTimestamp(row.timestamp);
    if (!timestamp || !parseBytes32(row.userOpHash)) continue;
    rows.push({
      direction: 'operation',
      asset: null,
      amount: null,
      counterparty: null,
      timestamp,
      success: row.success === true || row.success === 'true',
    });
  }
  rows.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  return { activity: rows.slice(0, pageSize) };
}

/** A UTC calendar date. MultiBaas `triggered_at` filters accept only this form (confirmed 2026-09-27). */
function isUtcDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

type CounterpartyTotal = { address: Address; name: string | null; sent: bigint; received: bigint };

/**
 * Totals for a date range, computed by MultiBaas with grouped `add` aggregations so the model
 * reports figures instead of adding them up. `to` is exclusive.
 */
export async function summarizeActivity(
  deps: ToolDependencies,
  { from, to, counterparty }: { from: string; to: string; counterparty?: string },
) {
  if (!isUtcDate(from) || !isUtcDate(to)) return { error: 'from and to must be UTC dates written as YYYY-MM-DD' };
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (days <= 0) return { error: 'to must be later than from' };
  if (days > SUMMARY_MAX_RANGE_DAYS) return { error: `the range can cover at most ${SUMMARY_MAX_RANGE_DAYS} days` };

  let other: string | null = null;
  if (counterparty) {
    if (isAddress(counterparty, { strict: false })) {
      other = lowercaseAddress(getAddress(counterparty));
    } else {
      const resolved = await resolveName(deps, { name: counterparty });
      if ('error' in resolved) return { error: 'unknown counterparty' };
      other = lowercaseAddress(resolved.address);
    }
  }

  const account = lowercaseAddress(deps.account);
  const range = [
    { fieldType: 'triggered_at', operator: 'greaterthanorequal', value: from },
    { fieldType: 'triggered_at', operator: 'lessthan', value: to },
  ];
  const transferFilter = (accountIndex: 0 | 1) => {
    const otherIndex = accountIndex === 0 ? 1 : 0;
    return {
      rule: 'and',
      children: [
        { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.usdc.address },
        { fieldType: 'input', inputIndex: accountIndex, operator: 'equal', value: account },
        ...(other ? [{ fieldType: 'input', inputIndex: otherIndex, operator: 'equal', value: other }] : []),
        ...range,
      ],
    };
  };
  const totalsQuery = (accountIndex: 0 | 1) => ({
    events: [
      {
        eventName: 'Transfer',
        select: [
          { type: 'input', inputIndex: accountIndex === 0 ? 1 : 0, alias: 'counterparty' },
          { type: 'input', inputIndex: 2, alias: 'total', aggregator: 'add' as const },
        ],
        filter: transferFilter(accountIndex),
      },
    ],
    groupBy: 'counterparty',
  });
  const recentQuery = (accountIndex: 0 | 1) => ({
    events: [
      {
        eventName: 'Transfer',
        select: [
          { type: 'triggered_at', alias: 'timestamp' },
          { type: 'input', inputIndex: accountIndex === 0 ? 1 : 0, alias: 'counterparty' },
          { type: 'input', inputIndex: 2, alias: 'value' },
        ],
        filter: transferFilter(accountIndex),
      },
    ],
    orderBy: 'timestamp',
    order: 'DESC' as const,
  });
  const gasQuery = {
    events: [
      {
        eventName: 'UserOperationEvent',
        select: [
          { type: 'input', inputIndex: 2, alias: 'paymaster' },
          { type: 'input', inputIndex: 5, alias: 'gas', aggregator: 'add' as const },
        ],
        filter: {
          rule: 'and',
          children: [
            { fieldType: 'contract_address', operator: 'equal', value: MULTIBAAS_CONTRACTS.entryPoint.address },
            { fieldType: 'input', inputIndex: 1, operator: 'equal', value: account },
            ...range,
          ],
        },
      },
    ],
    groupBy: 'paymaster',
  };

  const limit = MULTIBAAS_MAX_QUERY_LIMIT;
  const [sentTotals, receivedTotals, recentSent, recentReceived, gasRows] = await Promise.all([
    deps.multibaas.executeEventQuery(totalsQuery(0), limit),
    deps.multibaas.executeEventQuery(totalsQuery(1), limit),
    deps.multibaas.executeEventQuery(recentQuery(0), 10),
    deps.multibaas.executeEventQuery(recentQuery(1), 10),
    // Gas is not tied to a counterparty, so it is only reported for the whole wallet.
    other ? Promise.resolve([]) : deps.multibaas.executeEventQuery(gasQuery, limit),
  ]);
  deps.ranges.push({ from, to });

  const names = new Map(deps.context.addressBook.map((entry) => [entry.address.toLowerCase(), entry.name]));
  const byCounterparty = new Map<string, CounterpartyTotal>();
  let sent = 0n;
  let received = 0n;
  for (const [direction, rows] of [
    ['sent', sentTotals],
    ['received', receivedTotals],
  ] as const) {
    for (const row of rows) {
      if (typeof row.counterparty !== 'string' || !isAddress(row.counterparty, { strict: false })) continue;
      if (typeof row.total !== 'string' || !/^\d+$/.test(row.total)) continue;
      const key = row.counterparty.toLowerCase();
      const entry = byCounterparty.get(key) ?? {
        address: getAddress(key),
        name: names.get(key) ?? null,
        sent: 0n,
        received: 0n,
      };
      entry[direction] += BigInt(row.total);
      byCounterparty.set(key, entry);
      if (direction === 'sent') sent += BigInt(row.total);
      else received += BigInt(row.total);
    }
  }

  let paidGas = 0n;
  let sponsoredGas = 0n;
  for (const row of gasRows) {
    if (typeof row.paymaster !== 'string' || typeof row.gas !== 'string' || !/^\d+$/.test(row.gas)) continue;
    if (row.paymaster.toLowerCase() === ZERO_ADDRESS) paidGas += BigInt(row.gas);
    else sponsoredGas += BigInt(row.gas);
  }

  const recent = [
    ...recentSent.map((row) => ({ direction: 'sent' as const, row })),
    ...recentReceived.map((row) => ({ direction: 'received' as const, row })),
  ]
    .flatMap(({ direction, row }) => {
      const timestamp = parseTimestamp(row.timestamp);
      if (!timestamp || typeof row.value !== 'string' || !/^\d+$/.test(row.value)) return [];
      if (typeof row.counterparty !== 'string' || !isAddress(row.counterparty, { strict: false })) return [];
      return [
        {
          direction,
          amount: formatUnits(BigInt(row.value), 6),
          counterparty: getAddress(row.counterparty),
          name: names.get(row.counterparty.toLowerCase()) ?? null,
          timestamp,
        },
      ];
    })
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 10);

  return {
    // Both days are included, so the model can state the period without converting the exclusive `to`.
    range: { firstDay: from, lastDay: new Date(Date.parse(to) - DAY_MS).toISOString().slice(0, 10) },
    coverage: ACTIVITY_COVERAGE,
    usdc: {
      sent: formatUnits(sent, 6),
      received: formatUnits(received, 6),
      net: formatUnits(received - sent, 6),
      byCounterparty: [...byCounterparty.values()]
        .sort((left, right) => {
          const difference = right.sent + right.received - (left.sent + left.received);
          return difference > 0n ? 1 : difference < 0n ? -1 : 0;
        })
        .slice(0, 10)
        .map((entry) => ({
          address: entry.address,
          name: entry.name,
          sent: formatUnits(entry.sent, 6),
          received: formatUnits(entry.received, 6),
        })),
    },
    // Gas is rounded to 6 decimals; the exact wei figures are unreadable on the answer card.
    gas: other ? null : { paidEth: roundUnits(paidGas, 18, 6), sponsoredEth: roundUnits(sponsoredGas, 18, 6) },
    recent,
    truncated: [sentTotals, receivedTotals, gasRows].some((rows) => rows.length >= limit),
  };
}

export async function resolveName(deps: ToolDependencies, { name }: { name: string }) {
  const key = name.trim().toLowerCase();
  const entry = deps.context.addressBook.find((item) => item.name.toLowerCase() === key);
  if (entry) {
    const address = getAddress(entry.address);
    deps.resolvedNames.set(key, address);
    return { address, source: 'address_book' as const };
  }
  if (!key.includes('.')) return { error: 'unknown' };
  const address = await deps.resolveEns(key);
  if (!address) return { error: 'unknown' };
  deps.resolvedNames.set(key, getAddress(address));
  return { address: getAddress(address), source: 'ens' as const };
}

const SWAP_ASSETS: Record<SwapDirection, { input: 'ETH' | 'USDC'; output: 'ETH' | 'USDC' }> = {
  eth_to_usdc: { input: 'ETH', output: 'USDC' },
  usdc_to_eth: { input: 'USDC', output: 'ETH' },
};
const DECIMALS = { ETH: 18, USDC: 6 } as const;

/** Quote from the pinned Uniswap v4 pool; the phone quotes again at review before signing. */
export async function quoteSwap(
  deps: ToolDependencies,
  { direction, amountIn }: { direction: SwapDirection; amountIn: string },
) {
  if (!deps.context.capabilities.swap) return { error: 'swaps unavailable' };
  const { input, output } = SWAP_ASSETS[direction];
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amountIn) || (amountIn.split('.')[1] ?? '').length > DECIMALS[input]) {
    return { error: `amountIn must be a decimal ${input} amount with at most ${DECIMALS[input]} decimals` };
  }
  const amount = parseUnits(amountIn, DECIMALS[input]);
  if (amount <= 0n) return { error: 'amountIn must be greater than zero' };
  const quote = await deps.quoteSwap(direction, amount);
  return {
    amountIn: `${amountIn} ${input}`,
    expectedOut: `${formatUnits(quote.amountOut, DECIMALS[output])} ${output}`,
    minimumOut: `${formatUnits(quote.minAmountOut, DECIMALS[output])} ${output}`,
    slippage: '0.5%',
    venue: 'Uniswap v4 on Sepolia',
  };
}

export async function getEthPrice(deps: ToolDependencies) {
  const feed = MULTIBAAS_CONTRACTS.ethUsdFeed;
  const [decimalsOutput, round] = await Promise.all([
    deps.multibaas.callMethod(feed.address, feed.label, 'decimals', []),
    deps.multibaas.callMethod(feed.address, feed.label, 'latestRoundData', []),
  ]);
  const decimals = Number(decimalsOutput);
  if (!Number.isInteger(decimals) || !Array.isArray(round) || round.length !== 5) {
    return { error: 'price feed returned invalid data' };
  }
  const answer = BigInt(String(round[1]));
  const updatedAt = Number(round[3]);
  const nowSeconds = Math.floor(deps.now() / 1000);
  if (
    answer <= 0n ||
    updatedAt === 0 ||
    updatedAt > nowSeconds + ETH_USD_MAX_FUTURE_SECONDS ||
    nowSeconds - updatedAt > ETH_USD_MAX_AGE_SECONDS
  ) {
    return { error: 'price is stale' };
  }
  return { usd: formatUnits(answer, decimals), updatedAt: new Date(updatedAt * 1000).toISOString() };
}

/** Wraps a tool body so failures reach the model as data instead of failing the run. */
async function runSafely(deps: ToolDependencies, name: string, body: () => Promise<unknown>) {
  deps.calls.push(name);
  let result: string;
  try {
    result = JSON.stringify(await body());
  } catch (error) {
    result = JSON.stringify({ error: error instanceof Error ? error.message : 'tool failed' });
  }
  deps.toolResults.push(result);
  return result;
}

export function createTools(deps: ToolDependencies) {
  return [
    betaZodTool({
      name: 'get_activity',
      description:
        "Recent activity for the user's wallet: USDC transfers in and out and wallet operations, newest first. Use only when the request refers to past activity, such as 'the person I paid yesterday'.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
      run: (input) => runSafely(deps, 'get_activity', () => getActivity(deps, input)),
    }),
    betaZodTool({
      name: 'summarize_activity',
      description:
        "Totals for the user's wallet over whole UTC days: USDC sent and received with a breakdown by counterparty, gas the wallet paid versus gas that was sponsored, and the ten most recent transfers. Use for any question about amounts, counterparties, gas, or a period.",
      inputSchema: z.object({
        from: z.string().describe('First UTC day included, as YYYY-MM-DD. Work it out from the snapshot time.'),
        to: z.string().describe('First UTC day after the range, as YYYY-MM-DD. Use the day after the snapshot date to include today.'),
        counterparty: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe('Name or 0x address to limit transfers to. Gas is not reported when this is set.'),
      }),
      run: (input) => runSafely(deps, 'summarize_activity', () => summarizeActivity(deps, input)),
    }),
    betaZodTool({
      name: 'resolve_name',
      description:
        "Resolve a recipient name to an address. Checks the user's address book first, then ENS for names containing a dot. Returns {address, source} or {error: 'unknown'}.",
      inputSchema: z.object({ name: z.string().min(1).max(255) }),
      run: (input) => runSafely(deps, 'resolve_name', () => resolveName(deps, input)),
    }),
    betaZodTool({
      name: 'quote_swap',
      description:
        'Quote a swap between ETH and USDC. Call before proposing a swap so the summary can state the expected output.',
      inputSchema: z.object({
        direction: z.enum(['eth_to_usdc', 'usdc_to_eth']),
        amountIn: z.string(),
      }),
      run: (input) => runSafely(deps, 'quote_swap', () => quoteSwap(deps, input)),
    }),
    betaZodTool({
      name: 'get_eth_price',
      description: 'Current ETH price in US dollars from the Chainlink feed on Sepolia.',
      inputSchema: z.object({}),
      run: () => runSafely(deps, 'get_eth_price', () => getEthPrice(deps)),
    }),
  ];
}
