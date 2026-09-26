import { fetch as expoFetch } from 'expo/fetch';
import { createPublicClient, http, isAddress, type Address } from 'viem';
import { sepolia } from 'viem/chains';

import { readSoderaApiUrl } from './claim-auth-client';
import { parseSoderaUsername } from './username';

export type EnsIdentityReader = {
  availability(label: string): Promise<boolean>;
  verify(name: string, account: Address): Promise<boolean>;
};

export function createEnsIdentityReader({
  request = expoFetch,
  baseUrl,
  resolveAddress,
}: {
  request?: typeof expoFetch;
  baseUrl?: string;
  resolveAddress?: (name: string) => Promise<Address | null>;
} = {}): EnsIdentityReader {
  const url = readSoderaApiUrl(baseUrl);
  const resolve = resolveAddress ?? (async (name: string) => {
    const rpc = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
    if (!rpc) throw new Error('EXPO_PUBLIC_SEPOLIA_RPC_URL is required to verify ENS identity');
    return createPublicClient({ chain: sepolia, transport: http(rpc) }).getEnsAddress({ name });
  });
  const read = async (label: string) => {
    const response = await request(`${url}/ens/availability/${encodeURIComponent(label)}`);
    if (!response.ok) throw new Error(`ENS availability unavailable (${response.status})`);
    const data = await response.json() as {
      chainId?: unknown; name?: unknown; status?: unknown; claimable?: unknown;
      owner?: unknown; expiresAt?: unknown;
    };
    if (data.chainId !== sepolia.id || data.name !== `${label}.sodera.eth` ||
      !['available', 'reserved', 'registered'].includes(String(data.status))) {
      throw new Error('ENS service returned an invalid name status');
    }
    return data;
  };

  return {
    async availability(label) {
      const { label: canonical } = parseSoderaUsername(label);
      const state = await read(canonical);
      return state.status === 'available' && state.claimable === true;
    },
    async verify(name, account) {
      const username = parseSoderaUsername(name.replace(/\.sodera\.eth$/, ''));
      if (username.name !== name) return false;
      const state = await read(username.label);
      if (state.status !== 'registered' || typeof state.owner !== 'string' ||
        !isAddress(state.owner) || state.owner.toLowerCase() !== account.toLowerCase() ||
        typeof state.expiresAt !== 'string' || !Number.isFinite(Date.parse(state.expiresAt)) ||
        Date.parse(state.expiresAt) <= Date.now()) return false;
      const resolved = await resolve(name);
      return resolved?.toLowerCase() === account.toLowerCase();
    },
  };
}
