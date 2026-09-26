import { readFileSync } from 'node:fs';

import type { AgentContext } from '../schema.ts';

export const ACCOUNT = '0x1111111111111111111111111111111111111111';
export const ALICE = '0x2222222222222222222222222222222222222222';

export function readVectors<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../docs/plans/${name}`, import.meta.url), 'utf8')) as T;
}

export function createContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    chainId: 11155111,
    now: '2026-09-26T08:00:00.000Z',
    balances: { eth: '1', usdc: '100' },
    prices: { ethUsd: '2000' },
    vaultPosition: { assetsUsdc: '50' },
    sponsorship: { remaining: 5, limit: 10, resetsAt: '2026-09-27T00:00:00.000Z' },
    addressBook: [{ name: 'alice', address: ALICE }],
    capabilities: { send_eth: true, send_usdc: true, swap: false, vault_deposit: false, vault_withdraw: false },
    ...overrides,
  };
}
