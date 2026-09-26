import { Pool } from 'pg';

import { createEnsApp } from './app.ts';
import { createSepoliaEnsLookup } from './chain.ts';
import { createClaimAuth } from './claim-auth.ts';
import { createKernelPasskeyReader } from './kernel-proof.ts';
import { createPostgresChallengeStore } from './postgres-challenge-store.ts';

export async function createEnsService() {
  const lookup = createSepoliaEnsLookup();
  if (!process.env.DATABASE_URL) return createEnsApp(lookup);
  const ipHashKey = process.env.ENS_CHALLENGE_IP_KEY;
  if (!ipHashKey) throw new Error('ENS_CHALLENGE_IP_KEY is required with DATABASE_URL');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  try {
    const store = await createPostgresChallengeStore(pool);
    return createEnsApp(lookup, createClaimAuth({
      store,
      lookup,
      readKey: createKernelPasskeyReader(),
      ipHashKey,
    }));
  } catch (error) {
    await pool.end();
    throw error;
  }
}
