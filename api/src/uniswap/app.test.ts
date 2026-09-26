import { describe, expect, it } from 'vitest';

import { createUniswapApp } from './app.ts';

describe('Uniswap service entrypoint', () => {
  it('serves its own namespace without requiring ENS configuration', async () => {
    const app = createUniswapApp();
    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true, service: 'uniswap' });
    expect(await (await app.request('/uniswap/healthz')).json()).toEqual({ ok: true, module: 'uniswap' });
    expect((await app.request('/ens/availability/gargs')).status).toBe(404);
  });
});
