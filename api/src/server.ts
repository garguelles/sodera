import { serve } from '@hono/node-server';

const service = process.env.API_SERVICE;
const port = Number(process.env.PORT ?? '8080');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');

const app = service === 'ens'
  ? (await import('./ens/main.ts')).createEnsService()
  : service === 'uniswap'
    ? (await import('./uniswap/app.ts')).createUniswapApp()
    : null;
if (!app) throw new Error('API_SERVICE must be ens or uniswap');

serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ event: 'listening', service, port: info.port }));
});
