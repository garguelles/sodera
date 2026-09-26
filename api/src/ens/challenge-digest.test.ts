import { describe, expect, it } from 'vitest';

import { deriveClaimChallenge } from './challenge-digest.ts';
import { ENSV2 } from './contracts.ts';

describe('ENS WebAuthn challenge binding', () => {
  it('binds the signer challenge to chain, registry, wallet, label and expiry', () => {
    const context = {
      chainId: 11155111 as const,
      registry: ENSV2.child,
      account: '0x1111111111111111111111111111111111111111' as const,
      label: 'gargs',
      expiresAt: new Date('2026-09-27T00:05:00Z'),
      nonce: `0x${'ab'.repeat(32)}` as const,
    };
    const original = deriveClaimChallenge(context);
    expect(original).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveClaimChallenge(context)).toBe(original);
    expect(deriveClaimChallenge({ ...context, label: 'alice' })).not.toBe(original);
    expect(deriveClaimChallenge({ ...context, account: '0x2222222222222222222222222222222222222222' })).not.toBe(original);
    expect(deriveClaimChallenge({ ...context, registry: ENSV2.eth })).not.toBe(original);
    expect(deriveClaimChallenge({ ...context, expiresAt: new Date('2026-09-27T00:06:00Z') })).not.toBe(original);
  });
});
