import { b64ToBytes, base64FromUint8Array } from '@zerodev/webauthn-key';
import { p256 } from '@noble/curves/nist.js';
import { hexToBytes, sha256 } from 'viem';

import {
  createPasskeyCeremonyClient,
  type PasskeyNativeAdapter,
} from './passkey-ceremony';

const challenge = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const userHandle = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';
const credentialId = 'MDEyMzQ1Njc4OQ';
const publicKeyX = '6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296';
const publicKeyY = '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5';
const androidOrigin =
  'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w';
const rpIdHash = '8e10193d4b08a115661d13b6235b8be769f38cee6b8e867cf6ec9f620c6ca87b';
const aaguid = '00'.repeat(16);

describe('Primary Passkey ceremony client', () => {
  it('registers an ES256 resident credential with required user verification', async () => {
    const adapter = createAdapter({
      status: 'success',
      responseJson: registrationResponse(challenge),
    });
    const client = createPasskeyCeremonyClient(adapter, {
      randomBytes: createRandomBytes(),
    });

    const result = await client.registerPrimaryPasskey({
      userName: 'sodera-device-proof',
      userDisplayName: 'Sodera Device Proof',
    });

    expect(JSON.parse(adapter.createCredential.mock.calls[0][0])).toEqual({
      challenge,
      rp: { id: 'sodera.xyz', name: 'Sodera' },
      user: {
        id: userHandle,
        name: 'sodera-device-proof',
        displayName: 'Sodera Device Proof',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      attestation: 'none',
      excludeCredentials: [],
    });
    expect(result).toEqual({
      ok: true,
      credential: {
        id: credentialId,
        publicKeyX: `0x${publicKeyX}`,
        publicKeyY: `0x${publicKeyY}`,
        aaguid: `0x${aaguid}`,
        origin: androidOrigin,
        authenticatorAttachment: 'platform',
      },
    });
  });

  it('requests and validates an assertion from only the registered Primary Passkey', async () => {
    const adapter = createAdapter(
      { status: 'success', responseJson: registrationResponse(challenge) },
      { status: 'success', responseJson: authenticationResponse(challenge) },
    );
    const client = createPasskeyCeremonyClient(adapter, {
      randomBytes: createRandomBytes(),
    });
    const registration = await client.registerPrimaryPasskey({
      userName: 'sodera-device-proof',
      userDisplayName: 'Sodera Device Proof',
    });
    if (!registration.ok) throw new Error('Registration fixture was rejected');

    const result = await client.authenticatePrimaryPasskey({
      challenge,
      credential: registration.credential,
    });

    expect(JSON.parse(adapter.getCredential.mock.calls[0][0])).toEqual({
      challenge,
      rpId: 'sodera.xyz',
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
    });
    expect(result).toMatchObject({
      ok: true,
      assertion: {
        credentialId,
        origin: androidOrigin,
        userPresent: true,
        userVerified: true,
        signCount: 1,
        validatorEnvelope: expect.stringMatching(/^0x[0-9a-f]+$/),
      },
    });
  });

  it.each([
    ['changed challenge', authenticationResponse('changed')],
    ['missing user verification', authenticationResponse(challenge, 0x01)],
    ['wrong RP ID hash', authenticationResponse(challenge, 0x05, '00'.repeat(32))],
  ])('rejects an assertion with %s', async (_name, responseJson) => {
    const adapter = createAdapter(
      { status: 'success', responseJson: registrationResponse(challenge) },
      { status: 'success', responseJson },
    );
    const client = createPasskeyCeremonyClient(adapter, {
      randomBytes: createRandomBytes(),
    });
    const registration = await client.registerPrimaryPasskey({
      userName: 'sodera-device-proof',
      userDisplayName: 'Sodera Device Proof',
    });
    if (!registration.ok) throw new Error('Registration fixture was rejected');

    const result = await client.authenticatePrimaryPasskey({
      challenge,
      credential: registration.credential,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalidResponse' } });
  });

  it.each([
    ['missing user verification', registrationResponse(challenge, 0x41)],
    ['wrong RP ID hash', registrationResponse(challenge, 0x45, '00'.repeat(32))],
    ['different credential ID', registrationResponse(challenge, 0x45, rpIdHash, 'AQID')],
  ])('rejects a registration with %s', async (_name, responseJson) => {
    const adapter = createAdapter({ status: 'success', responseJson });
    const client = createPasskeyCeremonyClient(adapter, { randomBytes: createRandomBytes() });

    const result = await client.registerPrimaryPasskey({
      userName: 'sodera-device-proof',
      userDisplayName: 'Sodera Device Proof',
    });

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalidResponse' } });
  });

  it('discards a provider response after the ceremony is canceled', async () => {
    let resolveGet: (result: Awaited<ReturnType<PasskeyNativeAdapter['getCredential']>>) => void;
    const getCredential = jest.fn(
      () =>
        new Promise<Awaited<ReturnType<PasskeyNativeAdapter['getCredential']>>>((resolve) => {
          resolveGet = resolve;
        }),
    );
    const adapter = {
      createCredential: jest.fn(),
      getCredential,
      cancel: jest.fn(),
    };
    const client = createPasskeyCeremonyClient(adapter);
    const pending = client.authenticatePrimaryPasskey({
      challenge,
      credential: registeredCredential(),
    });

    client.cancelPending();
    resolveGet!({ status: 'success', responseJson: authenticationResponse(challenge) });

    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: 'canceled', message: 'Ceremony was superseded' },
    });
  });

  it('discards an assertion returned while the app is backgrounded', async () => {
    let resolveGet: (result: Awaited<ReturnType<PasskeyNativeAdapter['getCredential']>>) => void;
    const adapter = {
      createCredential: jest.fn(),
      getCredential: jest.fn(
        () =>
          new Promise<Awaited<ReturnType<PasskeyNativeAdapter['getCredential']>>>((resolve) => {
            resolveGet = resolve;
          }),
      ),
      cancel: jest.fn(),
    };
    const client = createPasskeyCeremonyClient(adapter, { isForeground: () => false });
    const pending = client.authenticatePrimaryPasskey({
      challenge,
      credential: registeredCredential(),
    });

    resolveGet!({ status: 'success', responseJson: authenticationResponse(challenge) });

    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: 'canceled', message: 'App is not in foreground' },
    });
  });

  it('fails closed when native secure randomness is unavailable', async () => {
    const adapter = createAdapter({ status: 'success', responseJson: '' });
    const client = createPasskeyCeremonyClient(adapter, {
      randomBytes: jest.fn().mockRejectedValue(new Error('unavailable')),
    });

    const result = await client.registerPrimaryPasskey({
      userName: 'sodera-device-proof',
      userDisplayName: 'Sodera Device Proof',
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unknown', message: 'Secure randomness is unavailable' },
    });
    expect(adapter.createCredential).not.toHaveBeenCalled();
  });

  it('does not launch Credential Manager when canceled during entropy generation', async () => {
    const resolveRandom: ((bytes: Uint8Array) => void)[] = [];
    const randomBytes = jest.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRandom.push(resolve);
        }),
    );
    const adapter = createAdapter({ status: 'success', responseJson: registrationResponse(challenge) });
    const client = createPasskeyCeremonyClient(adapter, { randomBytes });
    const pending = client.registerPrimaryPasskey({
      userName: 'sodera-device-proof',
      userDisplayName: 'Sodera Device Proof',
    });

    client.cancelPending();
    resolveRandom.forEach((resolve) => resolve(new Uint8Array(32)));

    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: 'canceled', message: 'Ceremony was superseded' },
    });
    expect(adapter.createCredential).not.toHaveBeenCalled();
  });
});

function createAdapter(
  createResult: Awaited<ReturnType<PasskeyNativeAdapter['createCredential']>>,
  getResult?: Awaited<ReturnType<PasskeyNativeAdapter['getCredential']>>,
) {
  return {
    createCredential: jest.fn().mockResolvedValue(createResult),
    getCredential: jest.fn().mockResolvedValue(getResult),
    cancel: jest.fn(),
  };
}

function registrationResponse(
  expectedChallenge: string,
  flags = 0x45,
  registrationRpIdHash = rpIdHash,
  attestedCredentialId = credentialId,
) {
  const clientDataJSON = encodeJson({
    type: 'webauthn.create',
    challenge: expectedChallenge,
    origin: androidOrigin,
    crossOrigin: false,
  });
  const spki = `3059301306072a8648ce3d020106082a8648ce3d03010703420004${publicKeyX}${publicKeyY}`;
  const credentialIdBytes = b64ToBytes(attestedCredentialId);
  const cosePublicKey = `a5010203262001215820${publicKeyX}225820${publicKeyY}`;
  const authenticatorData = `${registrationRpIdHash}${flags
    .toString(16)
    .padStart(2, '0')}00000000${aaguid}${credentialIdBytes.length
    .toString(16)
    .padStart(4, '0')}${hexFromBytes(credentialIdBytes)}${cosePublicKey}`;
  const attestationObject = `a363666d74646e6f6e656761747453746d74a068617574684461746158${(
    authenticatorData.length / 2
  )
    .toString(16)
    .padStart(2, '0')}${authenticatorData}`;

  return JSON.stringify({
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON,
      attestationObject: base64FromUint8Array(hexToBytes(`0x${attestationObject}`), true),
      publicKey: base64FromUint8Array(hexToBytes(`0x${spki}`), true),
      publicKeyAlgorithm: -7,
      transports: ['internal'],
    },
    clientExtensionResults: {},
  });
}

function encodeJson(value: unknown) {
  return base64FromUint8Array(new TextEncoder().encode(JSON.stringify(value)), true);
}

function createRandomBytes() {
  let call = 0;
  return jest.fn(async (length: number) => {
    const start = call++ * length;
    return Uint8Array.from({ length }, (_, index) => start + index);
  });
}

function authenticationResponse(
  expectedChallenge: string,
  flags = 0x05,
  rpIdHashValue = rpIdHash,
) {
  const authenticatorData = `${rpIdHashValue}${flags.toString(16).padStart(2, '0')}00000001`;
  const clientDataJSON = encodeJson({
    type: 'webauthn.get',
    challenge: expectedChallenge,
    origin: androidOrigin,
    crossOrigin: false,
  });
  const authenticatorBytes = hexToBytes(`0x${authenticatorData}`);
  const signedData = new Uint8Array(authenticatorBytes.length + 32);
  signedData.set(authenticatorBytes);
  signedData.set(hexToBytes(sha256(b64ToBytes(clientDataJSON))), authenticatorBytes.length);
  const signature = p256.sign(hexToBytes(sha256(signedData)), 1n, {
    prehash: false,
    lowS: false,
    extraEntropy: false,
  });

  return JSON.stringify({
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON,
      authenticatorData: base64FromUint8Array(hexToBytes(`0x${authenticatorData}`), true),
      signature: base64FromUint8Array(signature.toBytes('der'), true),
      userHandle: null,
    },
    clientExtensionResults: {},
  });
}

function registeredCredential() {
  return {
    id: credentialId,
    publicKeyX: `0x${publicKeyX}` as const,
    publicKeyY: `0x${publicKeyY}` as const,
    aaguid: `0x${aaguid}` as const,
    origin: androidOrigin,
    authenticatorAttachment: 'platform',
  };
}

function hexFromBytes(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
