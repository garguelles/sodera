import { describe, expect, it } from 'vitest';

import { createIssuerChain } from './chain.ts';

describe('private ENS issuer identity', () => {
  it('refuses to start with a signer other than the approved issuer address', () => {
    expect(() => createIssuerChain('https://ethereum-sepolia-rpc.publicnode.com',
      `0x${'0'.repeat(63)}1`)).toThrow('does not match the approved public address');
    expect(() => createIssuerChain('https://ethereum-sepolia-rpc.publicnode.com',
      `${'0'.repeat(63)}1`)).toThrow('does not match the approved public address');
  });
});
