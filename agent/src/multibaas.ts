import { getAddress, isHash, type Address, type Hash } from 'viem';

// Minimal MultiBaas client for the agent's read-only tools. Mirrors the shapes in
// app/src/wallet/multibaas.ts, including the deployment quirks confirmed there: event queries
// return at most 50 rows, `input` filters match lowercase addresses only, timestamps are
// Postgres-style, and bytes32 inputs arrive as a JSON byte array string.

export const MULTIBAAS_CONTRACTS = Object.freeze({
  usdc: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address, label: 'usdc' },
  entryPoint: { address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address, label: 'usdc2' },
  ethUsdFeed: { address: '0x694AA1769357215DE4FAC081bf1f309aDC325306' as Address, label: 'ethprice' },
  aqua: { address: '0x1111113ccf1426a8e30e2bff5e005d929bf6a90a' as Address, label: 'aqua' },
  aquaSwapVmRouter: { address: '0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE' as Address, label: 'aquaswapvmrouter' },
});

export const MULTIBAAS_MAX_QUERY_LIMIT = 50;

export type EventQuery = {
  events: {
    eventName: string;
    select: { type: string; alias: string; inputIndex?: number; aggregator?: 'add' }[];
    filter?: unknown;
  }[];
  /** Required when any select field has an aggregator; names a non-aggregated alias. */
  groupBy?: string;
  orderBy?: string;
  order?: 'ASC' | 'DESC';
};

export type MultiBaasClient = {
  executeEventQuery(query: EventQuery, limit?: number): Promise<Record<string, unknown>[]>;
  callMethod(address: Address, label: string, method: string, args: readonly unknown[]): Promise<unknown>;
};

export function createMultiBaasClient({
  baseUrl,
  apiKey,
  fetcher = fetch,
}: {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
}): MultiBaasClient {
  const apiUrl = `${baseUrl.replace(/\/+$/, '')}/api/v0`;
  const request = async (path: string, body: unknown) => {
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('MultiBaas could not be reached');
    }
    if (!response.ok) throw new Error(`MultiBaas returned HTTP ${response.status}`);
    const payload = (await response.json().catch(() => null)) as { result?: unknown } | null;
    if (!payload || typeof payload !== 'object' || !('result' in payload)) {
      throw new Error('MultiBaas returned invalid data');
    }
    return payload.result;
  };

  return {
    async executeEventQuery(query, limit = MULTIBAAS_MAX_QUERY_LIMIT) {
      const pageSize = Math.max(1, Math.min(limit, MULTIBAAS_MAX_QUERY_LIMIT));
      const result = (await request(`/queries?offset=0&limit=${pageSize}`, query)) as { rows?: unknown };
      if (!Array.isArray(result?.rows)) throw new Error('MultiBaas returned invalid data');
      return result.rows as Record<string, unknown>[];
    },
    async callMethod(address, label, method, args) {
      const result = (await request(
        `/chains/ethereum/addresses/${address}/contracts/${label}/methods/${method}`,
        { args, formatInts: 'as_strings' },
      )) as { kind?: string; output?: unknown };
      if (!result || typeof result !== 'object' || !('output' in result)) {
        throw new Error('MultiBaas returned invalid data');
      }
      return result.output;
    },
  };
}

export function lowercaseAddress(address: Address) {
  return getAddress(address).toLowerCase();
}

export function parseTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, date, time, zone = 'Z'] = match;
  const offset =
    zone === 'Z' ? 'Z' : zone.length === 3 ? `${zone}:00` : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = Date.parse(`${date}T${time}${offset}`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseBytes32(value: unknown): Hash | null {
  if (typeof value === 'string' && isHash(value)) return value;
  if (typeof value !== 'string' || !value.startsWith('[')) return null;
  try {
    const bytes: unknown = JSON.parse(value);
    if (
      !Array.isArray(bytes) ||
      bytes.length !== 32 ||
      !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      return null;
    }
    return `0x${bytes.map((byte: number) => byte.toString(16).padStart(2, '0')).join('')}` as Hash;
  } catch {
    return null;
  }
}
