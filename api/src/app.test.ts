import { describe, expect, it, vi } from 'vitest';

import { mountApiRoutes } from './app.ts';
import { createEnsApp } from './ens/app.ts';

describe('one ENS and Uniswap API', () => {
  it('serves both namespaces through the same Hono app', async () => {
    const app = mountApiRoutes(createEnsApp(vi.fn().mockResolvedValue({
      chainId: 11155111, name: 'gargs.sodera.eth', status: 'available', claimable: true,
      owner: null, expiresAt: null,
    })));
    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true, service: 'api' });
    expect(await (await app.request('/ens/availability/gargs')).json()).toMatchObject({ status: 'available' });
    expect(await (await app.request('/uniswap/healthz')).json()).toEqual({ ok: true, module: 'uniswap' });
  });
});
