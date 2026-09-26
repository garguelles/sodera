import { serve } from '@hono/node-server';

import { mountApiRoutes } from './app.ts';
import { createEnsService } from './ens/main.ts';

const port = Number(process.env.PORT ?? '8080');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');

const app = mountApiRoutes(await createEnsService());

serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ event: 'listening', service: 'api', port: info.port }));
});
