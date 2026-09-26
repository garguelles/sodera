import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keccak256, stringToHex } from 'viem';

import { createPostgresChallengeStore } from '../ens/postgres-challenge-store.ts';
import { deriveClaimChallenge } from '../ens/challenge-digest.ts';
import { createPostgresClaimStore } from '../ens/postgres-claim-store.ts';
import { ENSV2 } from '../ens/contracts.ts';
import { createIsolatedTestDatabase } from '../test/postgres.ts';
import { createPostgresWorkQueue } from './postgres-work-queue.ts';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite('Postgres issuer leases', () => {
  let database: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  beforeAll(async () => { database = await createIsolatedTestDatabase(); });
  afterAll(async () => { await database.close(); });

  it('leases concurrent claims to separate workers and rejects stale checkpoints', async () => {
    const challenges = await createPostgresChallengeStore(database.pool);
    const claims = await createPostgresClaimStore(database.pool);
    const queue = createPostgresWorkQueue(database.pool);
    const now = new Date();

    for (let index = 0; index < 2; index += 1) {
      const account = `0x${randomBytes(20).toString('hex')}` as const;
      const label = `test${randomBytes(4).toString('hex')}a`;
      const id = randomUUID();
      const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
      const ipHash = randomBytes(32).toString('hex');
      const nonce = `0x${randomBytes(32).toString('hex')}` as const;
      const expiresAt = new Date(now.getTime() + 300_000);
      await challenges.issue({ id, account, label, chainId: 11155111, registry: ENSV2.child,
        challenge: deriveClaimChallenge({ chainId: 11155111, registry: ENSV2.child,
          account, label, expiresAt, nonce }), nonce,
        ipHash, createdAt: now, expiresAt });
      await challenges.consume({ id, account, label, chainId: 11155111, registry: ENSV2.child, now });
      await challenges.markVerified({ id, tokenHash, expiresAt: new Date(now.getTime() + 600_000),
        proof: { authenticatorData: 'test-auth', clientDataJSON: 'test-client', signature: 'test-signature' } });
      await claims.submit({ account, label, name: `${label}.sodera.eth`,
        labelhash: keccak256(stringToHex(label)), tokenHash, ipHash, now });
    }

    const [first, second] = await Promise.all([queue.lease(), queue.lease()]);
    expect(first?.claim.id).toBeDefined();
    expect(second?.claim.id).toBeDefined();
    expect(first?.claim.id).not.toBe(second?.claim.id);
    expect(await queue.proof(first!.claim)).toEqual({ challenge: expect.any(String), assertion: {
      authenticatorData: 'test-auth', clientDataJSON: 'test-client', signature: 'test-signature',
    } });
    await database.pool.query('UPDATE ens_claim_challenges SET nonce = $2 WHERE claim_id = $1',
      [first!.claim.id, `0x${'ff'.repeat(32)}`]);
    expect(await queue.proof(first!.claim)).toBeNull();
    expect(await queue.lease()).toBeNull();
    await queue.checkpoint(first!, 'queued', { status: 'resolver_submitted', resolverTx: `0x${'aa'.repeat(32)}` });
    await expect(queue.checkpoint(first!, 'queued', { status: 'confirmed' }))
      .rejects.toThrow('lease or state changed');
    await queue.retry(second!, 'rpc_unavailable');
    expect((await claims.get(first!.claim.id))?.status).toBe('resolver_submitted');
  });
});
