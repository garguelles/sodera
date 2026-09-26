import { setTimeout as sleep } from 'node:timers/promises';

import { Pool } from 'pg';
import { createIssuerChain } from './chain.ts';
import { createPostgresWorkQueue } from './postgres-work-queue.ts';
import { processClaim } from './process-claim.ts';
import { readIssuerMode } from './worker-config.ts';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the private ENS issuer worker`);
  return value;
}

const databaseUrl = required('DATABASE_URL');
const allowedAccount = readIssuerMode({
  mode: process.env.ENS_ISSUER_MODE,
  controlledKernel: process.env.ENS_CONTROLLED_KERNEL,
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
pool.on('error', () => console.error('ENS issuer database connection interrupted; retrying.'));
const chain = createIssuerChain(required('SEPOLIA_RPC_URL'), required('ENS_ISSUER_PRIVATE_KEY'));
const queue = createPostgresWorkQueue(pool);
let running = true;
process.once('SIGTERM', () => { running = false; });
process.once('SIGINT', () => { running = false; });

while (running) {
  try {
    const lease = await queue.lease();
    if (lease) {
      await processClaim(lease, queue, chain, allowedAccount);
    } else {
      await sleep(3_000);
    }
  } catch {
    console.error('ENS issuer worker encountered an error; retrying.');
    await sleep(10_000);
  }
}

await pool.end();
