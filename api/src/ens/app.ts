import { Hono } from 'hono';

import { parseUsername } from './username.ts';
import type { Availability } from './chain.ts';

export function createEnsApp(lookup: (name: { label: string; name: string }) => Promise<Availability>) {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true, service: 'ens' }));
  app.get('/ens/availability/:label', async (c) => {
    let username: ReturnType<typeof parseUsername>;
    try {
      username = parseUsername(c.req.param('label'));
    } catch {
      return c.json({ error: 'invalid_label' }, 400);
    }
    if (username.reserved) {
      return c.json({ chainId: 11155111, name: username.name, status: 'reserved', claimable: false, owner: null, expiresAt: null });
    }
    try {
      return c.json(await lookup(username));
    } catch {
      return c.json({ error: 'ens_unavailable' }, 503);
    }
  });
  return app;
}
