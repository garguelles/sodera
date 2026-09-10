import {
  b64ToBytes,
  base64FromUint8Array,
  uint8ArrayToHexString,
} from '@zerodev/webauthn-key';
import { p256 } from '@noble/curves/nist.js';
import { getRandomBytesAsync } from 'expo-crypto';
import { hexToBytes, sha256, toBytes, type Hex } from 'viem';

import { encodePasskeyAssertion, type NativePasskeyAssertion } from './kernel-webauthn';

export const PASSKEY_RP_ID = 'sodera.xyz';
const ALLOWED_ANDROID_ORIGINS = new Set([
  'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  'android:apk-key-hash:p1yJx3Q5vok-W74lrkuuWoBCPeiCm3I4N21udeSWgbA',
]);
const P256_SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d03010703420004';

export type PasskeyErrorKind =
  | 'canceled'
  | 'noCredential'
  | 'noCreateOption'
  | 'providerConfiguration'
  | 'unsupported'
  | 'interrupted'
  | 'domError'
  | 'invalidResponse'
  | 'unknown';

export type NativePasskeyResult =
  | { status: 'success'; responseJson: string }
  | {
      status: 'error';
      error: { kind: Exclude<PasskeyErrorKind, 'invalidResponse'>; type?: string; domError?: string };
    };

export type PasskeyNativeAdapter = {
  createCredential(requestJson: string): Promise<NativePasskeyResult>;
  getCredential(requestJson: string): Promise<NativePasskeyResult>;
  cancel(): void;
};

type CeremonyError = {
  kind: PasskeyErrorKind;
  type?: string;
  domError?: string;
  message?: string;
};

export type RegisteredPrimaryPasskey = {
  id: string;
  publicKeyX: Hex;
  publicKeyY: Hex;
  aaguid: Hex;
  origin: string;
  authenticatorAttachment: string | null;
};

export type PasskeyCeremonyClient = {
  registerPrimaryPasskey(input: {
    userName: string;
    userDisplayName: string;
  }): Promise<
    { ok: true; credential: RegisteredPrimaryPasskey } | { ok: false; error: CeremonyError }
  >;
  authenticatePrimaryPasskey(input: {
    challenge: string;
    credential: RegisteredPrimaryPasskey;
  }): Promise<
    | {
        ok: true;
        assertion: NativePasskeyAssertion & {
          credentialId: string;
          origin: string;
          userPresent: boolean;
          userVerified: boolean;
          signCount: number;
          validatorEnvelope: Hex;
        };
      }
    | { ok: false; error: CeremonyError }
  >;
  cancelPending(): void;
};

export function createPasskeyCeremonyClient(
  adapter: PasskeyNativeAdapter,
  {
    randomBytes = getRandomBytesAsync,
    isForeground = () => true,
  }: {
    randomBytes?: (length: number) => Promise<Uint8Array>;
    isForeground?: () => boolean | Promise<boolean>;
  } = {},
): PasskeyCeremonyClient {
  let operationGeneration = 0;

  return {
    async registerPrimaryPasskey(input) {
      const startedGeneration = ++operationGeneration;
      adapter.cancel();
      let challenge: string;
      let userHandle: string;
      try {
        const [challengeBytes, userHandleBytes] = await Promise.all([
          randomBytes(32),
          randomBytes(32),
        ]);
        if (challengeBytes.length !== 32 || userHandleBytes.length !== 32) {
          throw new Error('Secure random source returned the wrong byte count');
        }
        challenge = base64FromUint8Array(challengeBytes, true);
        userHandle = base64FromUint8Array(userHandleBytes, true);
      } catch {
        return {
          ok: false,
          error: { kind: 'unknown', message: 'Secure randomness is unavailable' },
        };
      }

      if (startedGeneration !== operationGeneration) {
        return { ok: false, error: { kind: 'canceled', message: 'Ceremony was superseded' } };
      }
      const requestJson = JSON.stringify({
        challenge,
        rp: { id: PASSKEY_RP_ID, name: 'Sodera' },
        user: {
          id: userHandle,
          name: input.userName,
          displayName: input.userDisplayName,
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
      const result = await adapter.createCredential(requestJson);

      if (startedGeneration !== operationGeneration) {
        return { ok: false, error: { kind: 'canceled', message: 'Ceremony was superseded' } };
      }
      if (result.status === 'error') return { ok: false, error: result.error };
      if (!(await isForeground())) {
        return { ok: false, error: { kind: 'canceled', message: 'App is not in foreground' } };
      }

      try {
        return { ok: true, credential: parseRegistration(result.responseJson, challenge) };
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: 'invalidResponse',
            message: error instanceof Error ? error.message : 'Invalid registration response',
          },
        };
      }
    },
    async authenticatePrimaryPasskey(input) {
      const startedGeneration = ++operationGeneration;
      adapter.cancel();
      const requestJson = JSON.stringify({
        challenge: input.challenge,
        rpId: PASSKEY_RP_ID,
        allowCredentials: [{ type: 'public-key', id: input.credential.id }],
        userVerification: 'required',
      });
      const result = await adapter.getCredential(requestJson);

      if (startedGeneration !== operationGeneration) {
        return { ok: false, error: { kind: 'canceled', message: 'Ceremony was superseded' } };
      }
      if (result.status === 'error') return { ok: false, error: result.error };
      if (!(await isForeground())) {
        return { ok: false, error: { kind: 'canceled', message: 'App is not in foreground' } };
      }

      try {
        return {
          ok: true,
          assertion: parseAuthentication(
            result.responseJson,
            input.challenge,
            input.credential,
          ),
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: 'invalidResponse',
            message: error instanceof Error ? error.message : 'Invalid authentication response',
          },
        };
      }
    },
    cancelPending() {
      operationGeneration += 1;
      adapter.cancel();
    },
  };
}

function parseRegistration(responseJson: string, expectedChallenge: string): RegisteredPrimaryPasskey {
  const credential = JSON.parse(responseJson) as {
    id?: string;
    rawId?: string;
    type?: string;
    authenticatorAttachment?: string;
    response?: {
      clientDataJSON?: string;
      attestationObject?: string;
      publicKey?: string;
      publicKeyAlgorithm?: number;
    };
  };

  if (!credential.id || credential.id !== credential.rawId || credential.type !== 'public-key') {
    throw new Error('Registration returned an unexpected credential');
  }
  if (
    !credential.response?.clientDataJSON ||
    !credential.response.attestationObject ||
    !credential.response.publicKey
  ) {
    throw new Error('Registration response is missing public credential data');
  }
  if (credential.response.publicKeyAlgorithm !== -7) {
    throw new Error('Registration did not return an ES256 public key');
  }

  const clientData = parseClientData(credential.response.clientDataJSON);
  if (clientData.type !== 'webauthn.create' || clientData.challenge !== expectedChallenge) {
    throw new Error('Registration client data does not match the request');
  }
  if (!ALLOWED_ANDROID_ORIGINS.has(clientData.origin)) {
    throw new Error('Registration did not originate from an approved Android signer');
  }

  const publicKey = uint8ArrayToHexString(b64ToBytes(credential.response.publicKey)).slice(2);
  if (!publicKey.startsWith(P256_SPKI_PREFIX) || publicKey.length !== 182) {
    throw new Error('Registration returned an unexpected P-256 public key');
  }
  const publicKeyX = `0x${publicKey.slice(54, 118)}` as Hex;
  const publicKeyY = `0x${publicKey.slice(118)}` as Hex;
  const aaguid = validateRegistrationAuthenticatorData(
    credential.response.attestationObject,
    credential.id,
    publicKeyX,
    publicKeyY,
  );

  return {
    id: credential.id,
    publicKeyX,
    publicKeyY,
    aaguid,
    origin: clientData.origin,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
  };
}

function parseAuthentication(
  responseJson: string,
  expectedChallenge: string,
  expectedCredential: RegisteredPrimaryPasskey,
) {
  const credential = JSON.parse(responseJson) as {
    id?: string;
    rawId?: string;
    type?: string;
    response?: {
      clientDataJSON?: string;
      authenticatorData?: string;
      signature?: string;
    };
  };
  if (
    credential.id !== expectedCredential.id ||
    credential.rawId !== expectedCredential.id ||
    credential.type !== 'public-key'
  ) {
    throw new Error('Authentication returned a different credential');
  }
  const { clientDataJSON, authenticatorData, signature } = credential.response ?? {};
  if (!clientDataJSON || !authenticatorData || !signature) {
    throw new Error('Authentication response is incomplete');
  }

  const clientData = parseClientData(clientDataJSON);
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== expectedChallenge) {
    throw new Error('Authentication client data does not match the confirmed operation');
  }
  if (clientData.origin !== expectedCredential.origin) {
    throw new Error('Authentication originated from an unexpected Android application');
  }

  const authenticatorBytes = b64ToBytes(authenticatorData);
  if (authenticatorBytes.length < 37) {
    throw new Error('Authenticator data is too short');
  }
  const rpIdHash = uint8ArrayToHexString(authenticatorBytes.slice(0, 32));
  if (rpIdHash !== sha256(toBytes(PASSKEY_RP_ID))) {
    throw new Error('Authenticator data does not match the Sodera RP ID');
  }
  const flags = authenticatorBytes[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) {
    throw new Error('Authenticator did not verify user presence and user verification');
  }

  const assertion = { authenticatorData, clientDataJSON, signature };
  const signedData = new Uint8Array(authenticatorBytes.length + 32);
  signedData.set(authenticatorBytes);
  signedData.set(hexToBytes(sha256(b64ToBytes(clientDataJSON))), authenticatorBytes.length);
  const publicKey = hexToBytes(
    `0x04${expectedCredential.publicKeyX.slice(2)}${expectedCredential.publicKeyY.slice(2)}`,
  );
  if (
    !p256.verify(b64ToBytes(signature), hexToBytes(sha256(signedData)), publicKey, {
      prehash: false,
      lowS: false,
    })
  ) {
    throw new Error('Authentication signature does not match the registered public key');
  }
  return {
    ...assertion,
    credentialId: credential.id,
    origin: clientData.origin,
    userPresent: true,
    userVerified: true,
    signCount:
      ((authenticatorBytes[33] << 24) |
        (authenticatorBytes[34] << 16) |
        (authenticatorBytes[35] << 8) |
        authenticatorBytes[36]) >>>
      0,
    validatorEnvelope: encodePasskeyAssertion(assertion),
  };
}

function parseClientData(value: string) {
  const parsed = JSON.parse(new TextDecoder().decode(b64ToBytes(value))) as {
    type?: string;
    challenge?: string;
    origin?: string;
  };
  if (!parsed.type || !parsed.challenge || !parsed.origin) {
    throw new Error('WebAuthn client data is incomplete');
  }
  return { type: parsed.type, challenge: parsed.challenge, origin: parsed.origin };
}

type CborValue = number | string | boolean | null | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

function validateRegistrationAuthenticatorData(
  attestationObject: string,
  credentialId: string,
  publicKeyX: Hex,
  publicKeyY: Hex,
) {
  const attestationBytes = b64ToBytes(attestationObject);
  const decoded = readCborValue(attestationBytes, 0);
  if (decoded.offset !== attestationBytes.length || !(decoded.value instanceof Map)) {
    throw new Error('Registration returned a malformed attestation object');
  }
  const authenticatorBytes = decoded.value.get('authData');
  if (!(authenticatorBytes instanceof Uint8Array) || authenticatorBytes.length < 56) {
    throw new Error('Registration attestation is missing authenticator data');
  }
  if (uint8ArrayToHexString(authenticatorBytes.slice(0, 32)) !== sha256(toBytes(PASSKEY_RP_ID))) {
    throw new Error('Registration authenticator data does not match the Sodera RP ID');
  }

  const flags = authenticatorBytes[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0 || (flags & 0x40) === 0) {
    throw new Error('Registration did not verify the user and include credential data');
  }

  const credentialIdLength = (authenticatorBytes[53] << 8) | authenticatorBytes[54];
  const credentialIdStart = 55;
  const credentialIdEnd = credentialIdStart + credentialIdLength;
  if (
    credentialIdEnd >= authenticatorBytes.length ||
    !bytesEqual(authenticatorBytes.slice(credentialIdStart, credentialIdEnd), b64ToBytes(credentialId))
  ) {
    throw new Error('Registration attestation returned a different credential ID');
  }

  const credentialPublicKey = readCborValue(authenticatorBytes, credentialIdEnd);
  if (!(credentialPublicKey.value instanceof Map)) {
    throw new Error('Registration attestation is missing a COSE public key');
  }
  const coseKey = credentialPublicKey.value;
  const coseX = coseKey.get(-2);
  const coseY = coseKey.get(-3);
  if (
    coseKey.get(1) !== 2 ||
    coseKey.get(3) !== -7 ||
    coseKey.get(-1) !== 1 ||
    !(coseX instanceof Uint8Array) ||
    !(coseY instanceof Uint8Array) ||
    uint8ArrayToHexString(coseX) !== publicKeyX ||
    uint8ArrayToHexString(coseY) !== publicKeyY
  ) {
    throw new Error('Registration attestation does not match the ES256 public key');
  }

  let endOffset = credentialPublicKey.offset;
  if ((flags & 0x80) !== 0) {
    endOffset = readCborValue(authenticatorBytes, endOffset).offset;
  }
  if (endOffset !== authenticatorBytes.length) {
    throw new Error('Registration authenticator data has unexpected trailing bytes');
  }

  return uint8ArrayToHexString(authenticatorBytes.slice(37, 53));
}

function readCborValue(bytes: Uint8Array, offset: number, depth = 0): { value: CborValue; offset: number } {
  if (depth > 16 || offset >= bytes.length) throw new Error('Malformed CBOR value');
  const initialByte = bytes[offset++];
  const majorType = initialByte >> 5;
  const length = readCborLength(bytes, offset, initialByte & 0x1f);
  offset = length.offset;

  if (majorType === 0) return { value: length.value, offset };
  if (majorType === 1) return { value: -1 - length.value, offset };
  if (majorType === 2 || majorType === 3) {
    const end = offset + length.value;
    if (end > bytes.length) throw new Error('Malformed CBOR value');
    const value = bytes.slice(offset, end);
    return {
      value: majorType === 2 ? value : new TextDecoder().decode(value),
      offset: end,
    };
  }
  if (majorType === 4) {
    const value: CborValue[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const item = readCborValue(bytes, offset, depth + 1);
      value.push(item.value);
      offset = item.offset;
    }
    return { value, offset };
  }
  if (majorType === 5) {
    const value = new Map<CborValue, CborValue>();
    for (let index = 0; index < length.value; index += 1) {
      const key = readCborValue(bytes, offset, depth + 1);
      const item = readCborValue(bytes, key.offset, depth + 1);
      value.set(key.value, item.value);
      offset = item.offset;
    }
    return { value, offset };
  }
  if (majorType === 6) return readCborValue(bytes, offset, depth + 1);
  if (majorType === 7 && length.value >= 20 && length.value <= 22) {
    return { value: length.value === 20 ? false : length.value === 21 ? true : null, offset };
  }
  throw new Error('Unsupported CBOR value');
}

function readCborLength(bytes: Uint8Array, offset: number, additionalInfo: number) {
  if (additionalInfo < 24) return { value: additionalInfo, offset };
  const byteCount = additionalInfo === 24 ? 1 : additionalInfo === 25 ? 2 : additionalInfo === 26 ? 4 : 0;
  if (byteCount === 0 || offset + byteCount > bytes.length) throw new Error('Malformed CBOR length');
  let value = 0;
  for (let index = 0; index < byteCount; index += 1) value = value * 256 + bytes[offset + index];
  return { value, offset: offset + byteCount };
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
