import { Hono } from 'hono';

export const uniswapRoutes = new Hono();

uniswapRoutes.get('/healthz', (c) => c.json({ ok: true, module: 'uniswap' }));
