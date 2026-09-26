import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { Address } from 'viem';

import type { KernelPasskeyKey } from './kernel-proof.ts';

export const PASSKEY_RP_ID = 'sodera.xyz';
export const ALLOWED_ANDROID_ORIGINS = new Set([
  'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  'android:apk-key-hash:p1yJx3Q5vok-W74lrkuuWoBCPeiCm3I4N21udeSWgbA',
]);

export type PasskeyProof = {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
};

function base64url(value: string, maxLength: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > maxLength) {
    throw new Error('Malformed passkey proof');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || decoded.toString('base64url') !== value) {
    throw new Error('Malformed passkey proof');
  }
  return decoded;
}

export function verifyPasskeyProof(proof: PasskeyProof, challenge: string, key: KernelPasskeyKey) {
  const expectedChallenge = base64url(challenge, 64);
  if (expectedChallenge.length !== 32 || key.x.length !== 32 || key.y.length !== 32) {
    throw new Error('Invalid passkey signing context');
  }
  const authenticatorData = base64url(proof.authenticatorData, 1024);
  const clientDataBytes = base64url(proof.clientDataJSON, 4096);
  const signature = base64url(proof.signature, 512);
  if (authenticatorData.length < 37 || clientDataBytes.length > 3072) throw new Error('Malformed passkey proof');
  let clientData: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
  try {
    clientData = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientDataBytes));
  } catch {
    throw new Error('Malformed passkey client data');
  }
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== challenge ||
      !clientData.origin || !ALLOWED_ANDROID_ORIGINS.has(clientData.origin) || clientData.crossOrigin === true) {
    throw new Error('Passkey ceremony does not match the claim challenge');
  }
  const rpHash = createHash('sha256').update(PASSKEY_RP_ID).digest();
  if (!timingSafeEqual(authenticatorData.subarray(0, 32), rpHash) ||
      (authenticatorData[32]! & 0x05) !== 0x05) {
    throw new Error('Passkey ceremony lacks the Sodera RP or verified user');
  }
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: key.x.toString('base64url'), y: key.y.toString('base64url') },
      format: 'jwk',
    });
  } catch {
    throw new Error('Invalid Kernel passkey public key');
  }
  const signed = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientDataBytes).digest(),
  ]);
  if (!verify('sha256', signed, publicKey, signature)) throw new Error('Invalid passkey signature');
}

export async function verifyKernelClaimProof({
  account,
  challenge,
  proof,
  readKey,
}: {
  account: Address;
  challenge: string;
  proof: PasskeyProof;
  readKey: (account: Address) => Promise<KernelPasskeyKey>;
}) {
  verifyPasskeyProof(proof, challenge, await readKey(account));
}
