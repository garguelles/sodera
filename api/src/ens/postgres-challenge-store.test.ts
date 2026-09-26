import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChallengeLimitError, type ChallengeStore, type StoredChallenge } from './challenge-store.ts';
import { createPostgresChallengeStore } from './postgres-challenge-store.ts';
import { deriveClaimChallenge } from './challenge-digest.ts';
import { ENSV2 } from './contracts.ts';
import { createIsolatedTestDatabase } from '../test/postgres.ts';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite('Postgres challenge atomicity', () => {
  let database: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let store: ChallengeStore;
  const account = `0x${randomBytes(20).toString('hex')}` as const;
  const createdAt = new Date();
  const input = (id = randomUUID()): StoredChallenge => {
    const nonce = `0x${randomBytes(32).toString('hex')}` as const;
    const expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
    return {
      id, account, label: 'gargs', chainId: 11155111, registry: ENSV2.child,
      challenge: deriveClaimChallenge({ chainId: 11155111, registry: ENSV2.child,
        account, label: 'gargs', expiresAt, nonce }), nonce,
      ipHash: randomBytes(32).toString('hex'), createdAt, expiresAt,
    };
  };

  beforeAll(async () => {
    database = await createIsolatedTestDatabase();
    store = await createPostgresChallengeStore(database.pool);
  });
  afterAll(async () => { await database.close(); });

  it('serializes concurrent account limits and consumes a challenge only once', async () => {
    const attempts = Array.from({ length: 6 }, () => input());
    const results = await Promise.allSettled(attempts.map((value) => store.issue(value)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rejected').map((result) => result.reason))
      .toEqual([expect.any(ChallengeLimitError)]);

    const first = attempts[0]!;
    const consume = { id: first.id, account, label: 'gargs', chainId: 11155111 as const,
      registry: first.registry, now: createdAt };
    const consumed = await Promise.all([store.consume(consume), store.consume(consume)]);
    expect(consumed).toContain(first.challenge);
    expect(consumed).toContain(null);
    const proof = { authenticatorData: 'test-auth', clientDataJSON: 'test-client', signature: 'test-signature' };
    await store.markVerified({ id: first.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: first.expiresAt, proof });
    await expect(store.markVerified({ id: first.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: first.expiresAt, proof }))
      .rejects.toThrow('not recorded');
  });
});
