import { p256 } from '@noble/curves/nist.js';
import {
  base64FromUint8Array,
  findQuoteIndices,
  isRIP7212SupportedNetwork,
  parseAndNormalizeSig,
} from '@zerodev/webauthn-key';
import {
  bytesToBigInt,
  bytesToHex,
  concatBytes,
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  sha256,
  toBytes,
} from 'viem';

export const SYNTHETIC_CREDENTIAL_LABEL =
  'sodera.synthetic.p256.v1.DO-NOT-USE-IN-PRODUCTION';
export const SYNTHETIC_RP_ID = 'synthetic.sodera.invalid';
export const SYNTHETIC_ORIGIN = `https://${SYNTHETIC_RP_ID}`;

const PRIVATE_KEY = 1n;
const CURVE_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const signatureAbi = [
  { name: 'authenticatorData', type: 'bytes' },
  { name: 'clientDataJSON', type: 'string' },
  { name: 'responseTypeLocation', type: 'uint256' },
  { name: 'r', type: 'uint256' },
  { name: 's', type: 'uint256' },
  { name: 'usePrecompiled', type: 'bool' },
];

const publicKey = p256.getPublicKey(PRIVATE_KEY, false);
export const SYNTHETIC_PUBLIC_KEY = {
  bytes: publicKey,
  x: bytesToBigInt(publicKey.slice(1, 33)),
  y: bytesToBigInt(publicKey.slice(33)),
};

export function createSyntheticAssertion(
  hash,
  {
    chainId = 11155111,
    flags = 0x05,
    origin = SYNTHETIC_ORIGIN,
    rpId = SYNTHETIC_RP_ID,
    responseTypeLocation,
    normalizeS = true,
    tamperOrigin,
    tamperRpId,
  } = {},
) {
  const challenge = Buffer.from(hash.slice(2), 'hex').toString('base64url');
  const signedClientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"${origin}","crossOrigin":false}`;
  const signedAuthenticatorData = concatBytes([
    hexToBytes(sha256(toBytes(rpId))),
    Uint8Array.from([flags, 0, 0, 0, 1]),
  ]);
  const digest = hexToBytes(
    sha256(
      concatBytes([
        signedAuthenticatorData,
        hexToBytes(sha256(toBytes(signedClientDataJSON))),
      ]),
    ),
  );
  const der = p256.sign(digest, PRIVATE_KEY, {
    prehash: false,
    lowS: false,
    extraEntropy: false,
  });
  let { r, s } = parseAndNormalizeSig(bytesToHex(der.toBytes('der')));
  if (!normalizeS) s = CURVE_ORDER - s;
  const clientDataJSON = tamperOrigin
    ? signedClientDataJSON.replace(origin, tamperOrigin)
    : signedClientDataJSON;
  const authenticatorData = tamperRpId
    ? concatBytes([
        hexToBytes(sha256(toBytes(tamperRpId))),
        signedAuthenticatorData.slice(32),
      ])
    : signedAuthenticatorData;
  const discoveredLocation = findQuoteIndices(clientDataJSON).beforeType;

  return {
    authenticatorData,
    challenge,
    clientDataJSON,
    digest: bytesToHex(digest),
    der: bytesToHex(der.toBytes('der')),
    r,
    responseTypeLocation: responseTypeLocation ?? discoveredLocation,
    s,
    signature: encodeAbiParameters(signatureAbi, [
      bytesToHex(authenticatorData),
      clientDataJSON,
      responseTypeLocation ?? discoveredLocation,
      r,
      s,
      isRIP7212SupportedNetwork(chainId),
    ]),
  };
}

export function rawHashFromMessage(message) {
  if (typeof message !== 'object' || !message || !('raw' in message)) {
    throw new Error('Synthetic credential requires a raw UserOperation hash');
  }

  const hash =
    typeof message.raw === 'string' ? message.raw : bytesToHex(new Uint8Array(message.raw));
  if (hexToBytes(hash).length !== 32) {
    throw new Error('UserOperation hash must be exactly 32 bytes');
  }
  return hash;
}

const authenticatorIdBytes = toBytes(SYNTHETIC_CREDENTIAL_LABEL);
export const syntheticWebAuthnKey = {
  pubX: SYNTHETIC_PUBLIC_KEY.x,
  pubY: SYNTHETIC_PUBLIC_KEY.y,
  authenticatorId: base64FromUint8Array(authenticatorIdBytes, true),
  authenticatorIdHash: keccak256(authenticatorIdBytes),
  rpID: SYNTHETIC_RP_ID,
  async signMessageCallback(message, rpId, chainId) {
    return createSyntheticAssertion(rawHashFromMessage(message), { rpId, chainId }).signature;
  },
};
