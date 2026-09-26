import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { ChallengeLimitError, type ChallengeStore, type StoredChallenge } from './challenge-store.ts';
import { createPostgresChallengeStore } from './postgres-challenge-store.ts';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite('Postgres challenge atomicity', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let store: ChallengeStore;
  const account = `0x${randomBytes(20).toString('hex')}` as const;
  const createdAt = new Date();
  const input = (id = randomUUID()): StoredChallenge => ({
    id,
    account,
    label: 'gargs',
    chainId: 11155111,
    registry: '0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7',
    challenge: randomBytes(32).toString('base64url'),
    ipHash: randomBytes(32).toString('hex'),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 5 * 60_000),
  });

  beforeAll(async () => { store = await createPostgresChallengeStore(pool); });
  afterAll(async () => { await pool.end(); });

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
    await store.markVerified({ id: first.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: first.expiresAt });
    await expect(store.markVerified({ id: first.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: first.expiresAt }))
      .rejects.toThrow('not recorded');
  });
});
