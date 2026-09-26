import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ALLOWED_ANDROID_ORIGINS, PASSKEY_RP_ID, verifyKernelClaimProof, verifyPasskeyProof } from './webauthn-proof.ts';

const challenge = Buffer.alloc(32, 17).toString('base64url');
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = publicKey.export({ format: 'jwk' });
const key = { x: Buffer.from(jwk.x!, 'base64url'), y: Buffer.from(jwk.y!, 'base64url') };

function assertion({ origin = [...ALLOWED_ANDROID_ORIGINS][0]!, flags = 0x05, claim = challenge } = {}) {
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(PASSKEY_RP_ID).digest(),
    Buffer.from([flags, 0, 0, 0, 0]),
  ]);
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: claim,
    origin,
  }));
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
  return {
    authenticatorData: authenticatorData.toString('base64url'),
    clientDataJSON: clientDataJSON.toString('base64url'),
    signature: sign('sha256', signed, privateKey).toString('base64url'),
  };
}

describe('Kernel-bound WebAuthn proof', () => {
  it('accepts a valid user-verified Android assertion for the exact challenge and Kernel key', async () => {
    const readKey = async () => key;
    await expect(verifyKernelClaimProof({
      account: '0x1111111111111111111111111111111111111111',
      challenge,
      proof: assertion(),
      readKey,
    })).resolves.toBeUndefined();
  });

  it('rejects replay against a different challenge, wrong origin, and missing UV', () => {
    expect(() => verifyPasskeyProof(assertion(), Buffer.alloc(32, 18).toString('base64url'), key)).toThrow();
    expect(() => verifyPasskeyProof(assertion({ origin: 'https://example.com' }), challenge, key)).toThrow();
    expect(() => verifyPasskeyProof(assertion({ flags: 0x01 }), challenge, key)).toThrow();
  });

  it('rejects tampering or another wallet’s passkey', () => {
    const proof = assertion();
    expect(() => verifyPasskeyProof({ ...proof, signature: sign('sha256', Buffer.from('other'), privateKey).toString('base64url') }, challenge, key)).toThrow('Invalid passkey signature');
    const another = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
    expect(() => verifyPasskeyProof(proof, challenge, {
      x: Buffer.from(another.x!, 'base64url'), y: Buffer.from(another.y!, 'base64url'),
    })).toThrow('Invalid passkey signature');
  });
});
