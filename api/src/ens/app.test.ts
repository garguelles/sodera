import { describe, expect, it, vi } from 'vitest';

import { createEnsApp } from './app.ts';
import type { Availability } from './chain.ts';

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
