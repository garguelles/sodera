import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAddress, keccak256, stringToHex } from 'viem';

import { createPostgresChallengeStore } from './postgres-challenge-store.ts';
import { createPostgresClaimStore } from './postgres-claim-store.ts';
import { deriveClaimChallenge } from './challenge-digest.ts';
import { ENSV2 } from './contracts.ts';
import { ClaimConflictError, InvalidClaimTokenError, type ClaimStore } from './claim-store.ts';
import type { ChallengeStore } from './challenge-store.ts';
import { createIsolatedTestDatabase } from '../test/postgres.ts';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite('Postgres claim redemption', () => {
  let database: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let challenges: ChallengeStore;
  let claims: ClaimStore;
  const now = new Date();
  const account = `0x${randomBytes(20).toString('hex')}` as const;
  const ipHash = randomBytes(32).toString('hex');

  beforeAll(async () => {
    database = await createIsolatedTestDatabase();
    challenges = await createPostgresChallengeStore(database.pool);
    claims = await createPostgresClaimStore(database.pool);
  });
  afterAll(async () => { await database.close(); });

  async function verifiedToken(holder: `0x${string}`, label: string, hash = ipHash) {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const nonce = `0x${randomBytes(32).toString('hex')}` as const;
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    await challenges.issue({
      id, account: holder, label, chainId: 11155111, registry: ENSV2.child,
      challenge: deriveClaimChallenge({ chainId: 11155111, registry: ENSV2.child,
        account: holder, label, expiresAt, nonce }), nonce, ipHash: hash,
      createdAt: now, expiresAt,
    });
    await challenges.consume({ id, account: holder, label, chainId: 11155111, registry: ENSV2.child, now });
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await challenges.markVerified({ id, tokenHash, expiresAt: new Date(now.getTime() + 10 * 60_000),
      proof: { authenticatorData: 'test-auth', clientDataJSON: 'test-client', signature: 'test-signature' } });
    return tokenHash;
  }

  const claimInput = (holder: `0x${string}`, label: string, tokenHash: string) => ({
    account: holder,
    label,
    name: `${label}.sodera.eth`,
    labelhash: keccak256(stringToHex(label)),
    tokenHash,
    ipHash,
    now,
  });

  it('consumes one proof atomically, returns one claim for concurrent retries, and reserves wallet and label', async () => {
    const label = `test${randomBytes(4).toString('hex')}a`;
    const tokenHash = await verifiedToken(account, label);
    const results = await Promise.all([
      claims.submit(claimInput(account, label, tokenHash)),
      claims.submit(claimInput(account, label, tokenHash)),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results[0]).toMatchObject({ account: getAddress(account), label, status: 'queued' });
    expect(await claims.get(results[0].id)).toMatchObject({ status: 'queued' });
    expect(await claims.getForAccount(account)).toMatchObject({ id: results[0].id, label });

    const freshProof = await verifiedToken(account, label);
    const resumed = await claims.submit(claimInput(account, label, freshProof));
    expect(resumed.id).toBe(results[0].id);

    const nextLabel = `test${randomBytes(4).toString('hex')}a`;
    const secondToken = await verifiedToken(account, nextLabel);
    await expect(claims.submit(claimInput(account, nextLabel, secondToken)))
      .rejects.toBeInstanceOf(ClaimConflictError);
    const secondAccount = `0x${randomBytes(20).toString('hex')}` as const;
    expect(await claims.getForAccount(secondAccount)).toBeNull();
    const thirdToken = await verifiedToken(secondAccount, label);
    await expect(claims.submit(claimInput(secondAccount, label, thirdToken)))
      .rejects.toBeInstanceOf(ClaimConflictError);
    await expect(claims.submit(claimInput(secondAccount, nextLabel, tokenHash)))
      .rejects.toBeInstanceOf(InvalidClaimTokenError);
  });

  it('allows multiple fresh demo wallets and names from the same local IP', async () => {
    const hash = randomBytes(32).toString('hex');
    for (let index = 0; index < 4; index += 1) {
      const holder = `0x${randomBytes(20).toString('hex')}` as const;
      const label = `test${randomBytes(4).toString('hex')}a`;
      const tokenHash = await verifiedToken(holder, label, hash);
      const input = { ...claimInput(holder, label, tokenHash), ipHash: hash };
      await expect(claims.submit(input)).resolves.toMatchObject({ status: 'queued' });
    }
  });
});
