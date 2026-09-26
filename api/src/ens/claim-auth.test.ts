import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createClaimAuth, InvalidAssertionError, InvalidChallengeError } from './claim-auth.ts';
import type { ChallengeStore, StoredChallenge } from './challenge-store.ts';
import { ALLOWED_ANDROID_ORIGINS, PASSKEY_RP_ID } from './webauthn-proof.ts';

const account = '0x1111111111111111111111111111111111111111';
const username = { label: 'gargs', name: 'gargs.sodera.eth' };
const now = Date.UTC(2026, 8, 26);
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = publicKey.export({ format: 'jwk' });
const key = { x: Buffer.from(jwk.x!, 'base64url'), y: Buffer.from(jwk.y!, 'base64url') };

function proof(challenge: string) {
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(PASSKEY_RP_ID).digest(), Buffer.from([0x05, 0, 0, 0, 0]),
  ]);
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.get', challenge, origin: [...ALLOWED_ANDROID_ORIGINS][0],
  }));
  return {
    authenticatorData: authenticatorData.toString('base64url'),
    clientDataJSON: clientDataJSON.toString('base64url'),
    signature: sign('sha256', Buffer.concat([
      authenticatorData, createHash('sha256').update(clientDataJSON).digest(),
    ]), privateKey).toString('base64url'),
  };
}

function fakeStore() {
  const saved = new Map<string, StoredChallenge & { consumed?: boolean }>();
  const store: ChallengeStore = {
    async issue(value) { saved.set(value.id, value); },
    async consume({ id, account: requested, label, chainId, registry, now: at }) {
      const value = saved.get(id);
      if (!value || value.consumed || value.account !== requested || value.label !== label ||
        value.chainId !== chainId || value.registry !== registry || at >= value.expiresAt) return null;
      value.consumed = true;
      return value.challenge;
    },
    async markVerified() {},
  };
  return { store, saved };
}

function auth(store: ChallengeStore, clock = () => now) {
  return createClaimAuth({
    store, now: clock, ipHashKey: 'x'.repeat(32),
    lookup: vi.fn().mockResolvedValue({ status: 'available', claimable: true }),
    readKey: vi.fn().mockResolvedValue(key),
  });
}

describe('one-time Kernel claim challenge', () => {
  it('binds a fresh challenge to account, label, registry and chain and rejects reuse', async () => {
    const { store, saved } = fakeStore();
    const service = auth(store);
    const challenge = await service.issue({ account, ...username, ip: '127.0.0.1' });
    expect(saved.get(challenge.id)).toMatchObject({
      account, label: 'gargs', chainId: 11155111,
      registry: '0xfBb4ef18Db7F8044a0A19fD1Db7B192327811EC7',
    });
    const verified = await service.verify({ id: challenge.id, account, label: 'gargs', proof: proof(challenge.challenge) });
    expect(verified.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(service.verify({ id: challenge.id, account, label: 'gargs', proof: proof(challenge.challenge) }))
      .rejects.toBeInstanceOf(InvalidChallengeError);
  });

  it('burns a challenge for a bad signature and refuses wrong label or expired challenge', async () => {
    const { store } = fakeStore();
    const service = auth(store);
    const challenge = await service.issue({ account, ...username, ip: '127.0.0.1' });
    await expect(service.verify({ id: challenge.id, account, label: 'other', proof: proof(challenge.challenge) }))
      .rejects.toBeInstanceOf(InvalidChallengeError);
    await expect(service.verify({ id: challenge.id, account, label: 'gargs', proof: proof(Buffer.alloc(32, 1).toString('base64url')) }))
      .rejects.toBeInstanceOf(InvalidAssertionError);
    await expect(service.verify({ id: challenge.id, account, label: 'gargs', proof: proof(challenge.challenge) }))
      .rejects.toBeInstanceOf(InvalidChallengeError);

    const expired = auth(store, () => now + 6 * 60_000);
    const next = await service.issue({ account, ...username, ip: '127.0.0.1' });
    await expect(expired.verify({ id: next.id, account, label: 'gargs', proof: proof(next.challenge) }))
      .rejects.toBeInstanceOf(InvalidChallengeError);
  });
});
