import { Hono } from 'hono';

import { uniswapRoutes } from './routes.ts';

export function createUniswapApp() {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true, service: 'uniswap' }));
  app.route('/uniswap', uniswapRoutes);
  return app;
}
