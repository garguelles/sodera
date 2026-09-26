import { describe, expect, it, vi } from 'vitest';

import type { ClaimStore } from './claim-store.ts';
import { createClaims, IneligibleKernelError, IssuerUnavailableError } from './claims.ts';
import { ENSV2 } from './contracts.ts';

describe('public claim eligibility', () => {
  it('rejects the publicly documented synthetic Kernel before redeeming a proof', async () => {
    const store = { submit: vi.fn(), get: vi.fn() } as unknown as ClaimStore;
    const claims = createClaims(store, 'x'.repeat(32), async () => true);
    await expect(claims.submit({ account: ENSV2.publicTestKernel, label: 'gargs',
      name: 'gargs.sodera.eth', claimToken: 'A'.repeat(43), ip: '127.0.0.1' }))
      .rejects.toBeInstanceOf(IneligibleKernelError);
    expect(store.submit).not.toHaveBeenCalled();
  });

  it('rejects a real wallet if registrar authority is revoked after startup', async () => {
    const store = { submit: vi.fn(), get: vi.fn() } as unknown as ClaimStore;
    const claims = createClaims(store, 'x'.repeat(32), async () => false);
    await expect(claims.submit({ account: '0x1111111111111111111111111111111111111111',
      label: 'gargs', name: 'gargs.sodera.eth', claimToken: 'A'.repeat(43), ip: '127.0.0.1' }))
      .rejects.toBeInstanceOf(IssuerUnavailableError);
    expect(store.submit).not.toHaveBeenCalled();
  });
});
