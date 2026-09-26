import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { formatUnits, getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

import {
  MULTIBAAS_CONTRACTS,
  lowercaseAddress,
  parseBytes32,
  parseTimestamp,
  type MultiBaasClient,
} from './multibaas.ts';
import type { AgentContext } from './schema.ts';

export const ETH_USD_MAX_AGE_SECONDS = 7_200;
export const ETH_USD_MAX_FUTURE_SECONDS = 300;

export type ToolDependencies = {
  account: Address;
  context: AgentContext;
  multibaas: MultiBaasClient;
  resolveEns: (name: string) => Promise<Address | null>;
  now: () => number;
  /** Names resolved during this request, shared with the policy check. */
  resolvedNames: Map<string, Address>;
  /** Tool names called during this request, for the request log. */
  calls: string[];
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

export async function quoteSwap() {
  // PRA-212 has not published a pinned Uniswap route yet. The tool stays declared so the
  // tool list, and therefore the prompt cache, does not change when swaps arrive.
  return { error: 'swaps unavailable' };
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
  try {
    return JSON.stringify(await body());
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : 'tool failed' });
  }
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
      run: () => runSafely(deps, 'quote_swap', () => quoteSwap()),
    }),
    betaZodTool({
      name: 'get_eth_price',
      description: 'Current ETH price in US dollars from the Chainlink feed on Sepolia.',
      inputSchema: z.object({}),
      run: () => runSafely(deps, 'get_eth_price', () => getEthPrice(deps)),
    }),
  ];
}
