import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';

import { createEnsLookup } from './chain.ts';
import { ENSV2 } from './contracts.ts';

const now = Date.UTC(2026, 8, 26);

function reader(parentOwner: string = ENSV2.parentOwner, mountedChild: string = ENSV2.child) {
  return {
    getChainId: vi.fn().mockResolvedValue(11155111),
    getBlockNumber: vi.fn().mockResolvedValue(123n),
    readContract: vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === 'verifyContract') return ENSV2.implementation;
      if (functionName === 'getSubregistry') return address === ENSV2.root ? ENSV2.eth : mountedChild;
      if (functionName === 'getParent') return [ENSV2.eth, 'sodera'];
      if (functionName === 'getState') return address === ENSV2.eth
        ? { status: 2, expiry: BigInt(now / 1000 + 2 * 365 * 86400), latestOwner: parentOwner }
        : { status: 0, expiry: 0n, latestOwner: '0x0000000000000000000000000000000000000000' };
      throw new Error('Unexpected contract read');
    }),
  } as unknown as PublicClient;
}

describe('ENS namespace gate', () => {
  it('returns available only when the canonical registry and parent are intact', async () => {
    await expect(createEnsLookup(reader(), () => now)({ label: 'gargs', name: 'gargs.sodera.eth' }))
      .resolves.toMatchObject({ status: 'available', claimable: true, owner: null });
  });

  it('stops availability when the parent changes owner or redirects the subtree', async () => {
    const input = { label: 'gargs', name: 'gargs.sodera.eth' };
    await expect(createEnsLookup(reader('0x2222222222222222222222222222222222222222'), () => now)(input))
      .rejects.toThrow('ENS namespace is unavailable');
    await expect(createEnsLookup(reader(ENSV2.parentOwner, '0x3333333333333333333333333333333333333333'), () => now)(input))
      .rejects.toThrow('ENS namespace is unavailable');
  });
});
