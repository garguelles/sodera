import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Address, Hex } from 'viem';

import type { Availability } from './chain.ts';
import type { ChallengeStore } from './challenge-store.ts';
import { deriveClaimChallenge } from './challenge-digest.ts';
import { ENSV2 } from './contracts.ts';
import type { KernelPasskeyKey } from './kernel-proof.ts';
import { verifyPasskeyProof, type PasskeyProof } from './webauthn-proof.ts';

export class NameNotClaimableError extends Error {}
export class InvalidChallengeError extends Error {}
export class InvalidAssertionError extends Error {}

export function createClaimAuth({
  store,
  lookup,
  readKey,
  ipHashKey,
  now = Date.now,
}: {
  store: ChallengeStore;
  lookup: (name: { label: string; name: string }) => Promise<Availability>;
  readKey: (account: Address) => Promise<KernelPasskeyKey>;
  ipHashKey: string;
  now?: () => number;
}) {
  if (ipHashKey.length < 32) throw new Error('ENS_CHALLENGE_IP_KEY must be at least 32 characters');

  return {
    async issue({ account, label, name, ip }: {
      account: Address; label: string; name: string; ip: string;
    }) {
      const result = await lookup({ label, name });
      if (result.status !== 'available' || !result.claimable) {
        throw new NameNotClaimableError('Name cannot be claimed');
      }
      await readKey(account);
      const createdAt = new Date(now());
      const expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
      const id = randomUUID();
      const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
      const challenge = deriveClaimChallenge({ chainId: 11155111, registry: ENSV2.child,
        account, label, expiresAt, nonce });
      await store.issue({
        id,
        account,
        label,
        chainId: 11155111,
        registry: ENSV2.child,
        challenge,
        nonce,
        ipHash: createHmac('sha256', ipHashKey).update(ip).digest('hex'),
        createdAt,
        expiresAt,
      });
      return { id, challenge, name, chainId: 11155111 as const, expiresAt: expiresAt.toISOString() };
    },
    async verify({ id, account, label, proof }: {
      id: string; account: Address; label: string; proof: PasskeyProof;
    }) {
      const challenge = await store.consume({
        id, account, label, chainId: 11155111, registry: ENSV2.child, now: new Date(now()),
      });
      if (!challenge) throw new InvalidChallengeError('Challenge expired or used');
      const key = await readKey(account);
      try {
        verifyPasskeyProof(proof, challenge, key);
      } catch {
        throw new InvalidAssertionError('Invalid passkey assertion');
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now() + 10 * 60_000);
      await store.markVerified({
        id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt,
        proof,
      });
      return { claimToken: token, account, label, expiresAt: expiresAt.toISOString() };
    },
  };
}

export type ClaimAuth = ReturnType<typeof createClaimAuth>;
