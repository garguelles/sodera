import type { Hono } from 'hono';

import { uniswapRoutes } from './uniswap/routes.ts';

export function mountApiRoutes<T extends Hono>(app: T): T {
  app.route('/uniswap', uniswapRoutes);
  return app;
}
