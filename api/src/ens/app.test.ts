import { describe, expect, it, vi } from 'vitest';

import { createEnsApp } from './app.ts';
import type { Availability } from './chain.ts';
import type { ClaimAuth } from './claim-auth.ts';
import type { Claims } from './claims.ts';

const available: Availability = {
  chainId: 11155111,
  name: 'gargs.sodera.eth',
  status: 'available',
  claimable: true,
  owner: null,
  expiresAt: null,
};

describe('ENS availability API', () => {
  it('returns an on-chain availability result for a canonical label', async () => {
    const lookup = vi.fn().mockResolvedValue(available);
    const response = await createEnsApp(lookup).request('/ens/availability/gargs');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(available);
    expect(lookup).toHaveBeenCalledWith({ label: 'gargs', name: 'gargs.sodera.eth', reserved: false });
  });

  it('rejects invalid and product-reserved labels before using the RPC', async () => {
    const lookup = vi.fn();
    const app = createEnsApp(lookup);
    expect((await app.request('/ens/availability/Gargs')).status).toBe(400);
    const reserved = await app.request('/ens/availability/anon');
    expect(reserved.status).toBe(200);
    expect(await reserved.json()).toMatchObject({ status: 'reserved', claimable: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('fails closed on an unavailable hierarchy and exposes no claim route', async () => {
    const app = createEnsApp(vi.fn().mockRejectedValue(new Error('RPC transport includes secret URL')));
    const response = await app.request('/ens/availability/gargs');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret URL');
    expect((await app.request('/ens/claims', { method: 'POST' })).status).toBe(404);
  });
});

describe('ENS challenge API', () => {
  const account = '0x1111111111111111111111111111111111111111';
  const id = '11111111-1111-4111-8111-111111111111';
  const request = (body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as const;

  it('passes only validated account/label and passkey proof fields to the authentication service', async () => {
    const auth = {
      issue: vi.fn().mockResolvedValue({ id, challenge: 'challenge', expiresAt: '2026-09-26T00:05:00Z' }),
      verify: vi.fn().mockResolvedValue({ claimToken: 'secret', expiresAt: '2026-09-26T00:10:00Z' }),
    } as unknown as ClaimAuth;
    const app = createEnsApp(vi.fn().mockResolvedValue(available), auth);
    const issued = await app.request('/ens/challenges', request({ account, label: 'gargs' }));
    expect(issued.status).toBe(201);
    expect(auth.issue).toHaveBeenCalledWith(expect.objectContaining({ account, label: 'gargs', name: 'gargs.sodera.eth' }));
    const proof = { authenticatorData: 'a', clientDataJSON: 'b', signature: 'c' };
    const verified = await app.request(`/ens/challenges/${id}/verify`, request({ account, label: 'gargs', proof }));
    expect(verified.status).toBe(200);
    expect(auth.verify).toHaveBeenCalledWith({ id, account, label: 'gargs', proof });
  });

  it('rejects malformed and reserved challenge requests before any signer call', async () => {
    const auth = { issue: vi.fn(), verify: vi.fn() } as unknown as ClaimAuth;
    const app = createEnsApp(vi.fn().mockResolvedValue(available), auth);
    expect((await app.request('/ens/challenges', request({ account: 'invalid', label: 'gargs' }))).status).toBe(400);
    expect((await app.request('/ens/challenges', request({ account, label: 'anon' }))).status).toBe(409);
    expect((await app.request('/ens/challenges/bad/verify', request({ account, label: 'gargs' }))).status).toBe(400);
    expect(auth.issue).not.toHaveBeenCalled();
    expect(auth.verify).not.toHaveBeenCalled();
  });
});

describe('ENS claim API', () => {
  it('only accepts a scoped token when the claim route is enabled', async () => {
    const account = '0x1111111111111111111111111111111111111111';
    const id = '11111111-1111-4111-8111-111111111111';
    const claim = { id, account, name: 'gargs.sodera.eth', status: 'queued' };
    const claims = { submit: vi.fn().mockResolvedValue(claim), get: vi.fn().mockResolvedValue(claim),
      getForAccount: vi.fn().mockResolvedValue(claim) } as unknown as Claims;
    const app = createEnsApp(vi.fn().mockResolvedValue(available), undefined, claims);
    const response = await app.request('/ens/claims', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account, label: 'gargs', claimToken: 'A'.repeat(43) }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(claim);
    expect(claims.submit).toHaveBeenCalledWith(expect.objectContaining({ account, label: 'gargs', name: 'gargs.sodera.eth' }));
    expect(await (await app.request(`/ens/claims/${id}`)).json()).toEqual(claim);
    expect(await (await app.request(`/ens/claims/account/${account}`)).json()).toEqual(claim);
    expect(claims.getForAccount).toHaveBeenCalledWith(account);
    expect((await app.request('/ens/claims/account/bad')).status).toBe(400);
    expect((await app.request('/ens/claims', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, label: 'gargs', claimToken: 'bad' }),
    })).status).toBe(400);
  });
});
