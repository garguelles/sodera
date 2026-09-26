import { getAddress, type Address } from 'viem';

import {
  SEPOLIA_AQUA_ADDRESS,
  SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  SEPOLIA_ETH_USD_FEED_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
} from './sepolia';

const ENTRY_POINT_V07_ADDRESS: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

export const MULTIBAAS_API_PREFIX = '/api/v0';
export const MULTIBAAS_CHAIN = 'ethereum';

/**
 * Contracts linked in the MultiBaas deployment. Requests address them by their fixed chain
 * address; the label is the contract name chosen in the MultiBaas console when linking, and is
 * required only for method calls. Aliases are not used because the console cannot rename them.
 */
export const MULTIBAAS_CONTRACTS = Object.freeze({
  usdc: { address: SEPOLIA_USDC_ADDRESS as Address, label: 'usdc' },
  entryPoint: { address: ENTRY_POINT_V07_ADDRESS, label: 'usdc2' },
  ethUsdFeed: { address: SEPOLIA_ETH_USD_FEED_ADDRESS as Address, label: 'ethprice' },
  /** Holds Earn positions and emits their Shipped, Docked, Pulled and Pushed events. */
  aqua: { address: SEPOLIA_AQUA_ADDRESS as Address, label: 'aqua' },
  /** Executes trades against Earn positions; it emits only Swapped. */
  aquaSwapVmRouter: { address: SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS as Address, label: 'aquaswapvmrouter' },
});

/**
 * `input` event-query filters match addresses only in lowercase; a checksummed value returns
 * no rows (confirmed against the deployment by `pnpm verify:multibaas` step 7).
 */
export function formatAddressFilterValue(address: Address) {
  return getAddress(address).toLowerCase();
}

export type MultiBaasConfig = { baseUrl: string; apiKey: string };

export type EventQueryFieldType =
  | 'input'
  | 'contract_label'
  | 'contract_name'
  | 'contract_address'
  | 'contract_address_alias'
  | 'block_number'
  | 'triggered_at'
  | 'event_signature'
  | 'block_hash'
  | 'tx_hash'
  | 'tx_from';

export type EventQueryOperator =
  | 'equal'
  | 'notequal'
  | 'lessthan'
  | 'greaterthan'
  | 'lessthanorequal'
  | 'greaterthanorequal';

export type EventQueryAggregator = 'add' | 'subtract' | 'last' | 'first' | 'min' | 'max';

export type EventQueryField = {
  type: EventQueryFieldType;
  alias: string;
  inputIndex?: number;
  aggregator?: EventQueryAggregator;
};

export type EventQueryFilterRule = {
  fieldType: EventQueryFieldType;
  operator: EventQueryOperator;
  value: string;
  inputIndex?: number;
};

export type EventQueryFilterGroup = {
  rule: 'and' | 'or';
  children: EventQueryFilter[];
};

export type EventQueryFilter = EventQueryFilterRule | EventQueryFilterGroup;

export type EventQueryEvent = {
  eventName: string;
  select: EventQueryField[];
  filter?: EventQueryFilter;
};

export type EventQuery = {
  events: EventQueryEvent[];
  groupBy?: string;
  orderBy?: string;
  order?: 'ASC' | 'DESC';
};

export type MultiBaasAddressInclude = 'balance' | 'nonce' | 'code' | 'contractLookup';

export type MultiBaasClient = {
  executeEventQuery(
    query: EventQuery,
    options?: { offset?: number; limit?: number },
  ): Promise<Record<string, unknown>[]>;
  callMethod(
    addressOrAlias: string,
    label: string,
    method: string,
    args: readonly unknown[],
  ): Promise<unknown>;
  getAddress(
    address: Address | string,
    include: readonly MultiBaasAddressInclude[],
  ): Promise<Record<string, unknown>>;
  getChainStatus(): Promise<Record<string, unknown>>;
};

/** MultiBaas rejects event queries with `limit` above 50 with HTTP 400. */
export const MULTIBAAS_MAX_QUERY_LIMIT = 50;

export function readMultiBaasConfigFromEnv(): MultiBaasConfig {
  // Expo inlines EXPO_PUBLIC_ variables only for static property access.
  const baseUrl = process.env.EXPO_PUBLIC_MULTIBAAS_BASE_URL;
  const apiKey = process.env.EXPO_PUBLIC_MULTIBAAS_API_KEY;
  if (!baseUrl) throw new Error('EXPO_PUBLIC_MULTIBAAS_BASE_URL is not configured');
  if (!apiKey) throw new Error('EXPO_PUBLIC_MULTIBAAS_API_KEY is not configured');
  return { baseUrl, apiKey };
}

export function createMultiBaasClient({
  config,
  fetcher = fetch,
}: {
  config: MultiBaasConfig;
  fetcher?: typeof fetch;
}): MultiBaasClient {
  const apiUrl = `${config.baseUrl.replace(/\/+$/, '')}${MULTIBAAS_API_PREFIX}`;

  const request = async (path: string, body?: unknown) => {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error('MultiBaas could not be reached');
    }
    if (!response.ok) throw new Error(`MultiBaas returned HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('MultiBaas returned invalid data');
    }
    if (!isRecord(payload) || !('result' in payload)) {
      throw new Error('MultiBaas returned invalid data');
    }
    return payload.result;
  };

  return {
    async executeEventQuery(query, { offset = 0, limit = MULTIBAAS_MAX_QUERY_LIMIT } = {}) {
      const pageSize = Math.max(1, Math.min(limit, MULTIBAAS_MAX_QUERY_LIMIT));
      const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize) });
      const result = await request(`/queries?${params.toString()}`, query);
      if (!isRecord(result) || !Array.isArray(result.rows) || !result.rows.every(isRecord)) {
        throw new Error('MultiBaas returned invalid data');
      }
      return result.rows;
    },
    async callMethod(addressOrAlias, label, method, args) {
      const result = await request(
        `/chains/${MULTIBAAS_CHAIN}/addresses/${encodeURIComponent(addressOrAlias)}/contracts/${encodeURIComponent(label)}/methods/${encodeURIComponent(method)}`,
        { args, formatInts: 'as_strings' },
      );
      if (!isRecord(result) || !('output' in result)) {
        throw new Error('MultiBaas returned invalid data');
      }
      if ('kind' in result && result.kind !== 'MethodCallResponse') {
        throw new Error('MultiBaas returned invalid data');
      }
      return result.output;
    },
    async getAddress(address, include) {
      const query = include.length > 0
        ? `?${include.map((value) => `include=${encodeURIComponent(value)}`).join('&')}`
        : '';
      const result = await request(
        `/chains/${MULTIBAAS_CHAIN}/addresses/${encodeURIComponent(address)}${query}`,
      );
      if (!isRecord(result)) throw new Error('MultiBaas returned invalid data');
      return result;
    },
    async getChainStatus() {
      const result = await request(`/chains/${MULTIBAAS_CHAIN}/status`);
      if (!isRecord(result)) throw new Error('MultiBaas returned invalid data');
      return result;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
