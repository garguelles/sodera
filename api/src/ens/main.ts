import { Pool } from 'pg';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

import { createEnsApp } from './app.ts';
import { createSepoliaEnsLookup } from './chain.ts';
import { createClaimAuth } from './claim-auth.ts';
import { createKernelPasskeyReader } from './kernel-proof.ts';
import { createPostgresChallengeStore } from './postgres-challenge-store.ts';
import { createPostgresClaimStore } from './postgres-claim-store.ts';
import { createClaims } from './claims.ts';
import { ENSV2, registryAbi } from './contracts.ts';

export async function createEnsService() {
  const lookup = createSepoliaEnsLookup();
  const enabled = process.env.ENS_CLAIMS_ENABLED ?? '0';
  if (enabled !== '0' && enabled !== '1') throw new Error('ENS_CLAIMS_ENABLED must be 0 or 1');
  if (enabled === '1' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to enable ENS claims');
  if (!process.env.DATABASE_URL) return createEnsApp(lookup);
  const ipHashKey = process.env.ENS_CHALLENGE_IP_KEY;
  if (!ipHashKey) throw new Error('ENS_CHALLENGE_IP_KEY is required with DATABASE_URL');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  pool.on('error', () => console.error('API database connection interrupted; queries will reconnect.'));
  try {
    const store = await createPostgresChallengeStore(pool);
    const auth = createClaimAuth({
      store,
      lookup,
      readKey: createKernelPasskeyReader(),
      ipHashKey,
    });
    if (enabled !== '1') return createEnsApp(lookup, auth);
    const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
    const issuerRoles = await client.readContract({
      address: ENSV2.child, abi: registryAbi, functionName: 'roles', args: [0n, ENSV2.issuer],
    });
    if (issuerRoles !== 1n) throw new Error('Issuer needs exactly ROLE_REGISTRAR before opening ENS claims');
    const claimStore = await createPostgresClaimStore(pool);
    return createEnsApp(lookup, auth, createClaims(claimStore, ipHashKey, async () =>
      (await client.readContract({
        address: ENSV2.child, abi: registryAbi, functionName: 'roles', args: [0n, ENSV2.issuer],
      })) === 1n));
  } catch (error) {
    await pool.end();
    throw error;
  }
}
