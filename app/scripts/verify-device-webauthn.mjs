import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { p256 } from '@noble/curves/nist.js';
import {
  b64ToBytes,
  findQuoteIndices,
  parseAndNormalizeSig,
  uint8ArrayToHexString,
} from '@zerodev/webauthn-key';
import {
  concat,
  decodeAbiParameters,
  hexToBytes,
  isHex,
  keccak256,
  sha256,
  toBytes,
} from 'viem';

import {
  assertSepoliaRpc,
  createPublicKeyStorageOverride,
  requireSepoliaRpcUrl,
  validateUserOperation,
  ZERODEV_WEBAUTHN_VALIDATOR,
} from './lib/zerodev-webauthn-validator.mjs';

const PROOF_ACCOUNT = '0x1111111111111111111111111111111111111111';

const rpcUrl = requireSepoliaRpcUrl();
const evidencePath = process.argv[2] ?? new URL('./fixtures/pra185-device-assertion.json', import.meta.url);

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
for (const field of ['userOperationHash', 'publicKeyX', 'publicKeyY', 'validatorEnvelope']) {
  if (!isHex(evidence[field])) throw new Error(`${field} must be hex`);
}
assert.equal(evidence.userOperationHash.length, 66);
assert.equal(evidence.publicKeyX.length, 66);
assert.equal(evidence.publicKeyY.length, 66);

const authenticatorData = b64ToBytes(evidence.authenticatorData);
const clientDataBytes = b64ToBytes(evidence.clientDataJSON);
const clientDataJSON = new TextDecoder().decode(clientDataBytes);
const clientData = JSON.parse(clientDataJSON);
const expectedChallenge = Buffer.from(evidence.userOperationHash.slice(2), 'hex').toString('base64url');
assert.equal(clientData.type, 'webauthn.get');
assert.equal(clientData.challenge, expectedChallenge);
assert.equal(clientData.origin, evidence.origin);
assert.equal(uint8ArrayToHexString(authenticatorData.slice(0, 32)), sha256(toBytes(evidence.rpId)));
assert.equal((authenticatorData[32] & 0x01) !== 0, evidence.userPresent);
assert.equal((authenticatorData[32] & 0x04) !== 0, evidence.userVerified);
assert.equal(
  new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset,
    authenticatorData.byteLength,
  ).getUint32(33),
  evidence.signCount,
);

const [envelopeAuthenticatorData, envelopeClientDataJSON, responseTypeLocation, r, s, usePrecompiled] =
  decodeAbiParameters(
    [
      { type: 'bytes' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bool' },
    ],
    evidence.validatorEnvelope,
  );
const normalizedSignature = parseAndNormalizeSig(
  uint8ArrayToHexString(b64ToBytes(evidence.signature)),
);
assert.equal(envelopeAuthenticatorData, uint8ArrayToHexString(authenticatorData));
assert.equal(envelopeClientDataJSON, clientDataJSON);
assert.equal(responseTypeLocation, findQuoteIndices(clientDataJSON).beforeType);
assert.deepEqual({ r, s }, normalizedSignature);
assert.equal(usePrecompiled, true);

const digest = sha256(concat([authenticatorData, hexToBytes(sha256(clientDataBytes))]));
const publicKey = hexToBytes(`0x04${evidence.publicKeyX.slice(2)}${evidence.publicKeyY.slice(2)}`);
assert.equal(p256.verify(normalizedSignature, hexToBytes(digest), publicKey), true);
assert.equal(keccak256(evidence.validatorEnvelope), evidence.validatorEnvelopeHash);

await assertSepoliaRpc(rpcUrl);

const stateOverride = createPublicKeyStorageOverride(
  PROOF_ACCOUNT,
  evidence.publicKeyX,
  evidence.publicKeyY,
);
const packedUserOperation = {
  sender: PROOF_ACCOUNT,
  nonce: 0n,
  initCode: '0x',
  callData: '0x',
  accountGasLimits: `0x${'00'.repeat(32)}`,
  preVerificationGas: 0n,
  gasFees: `0x${'00'.repeat(32)}`,
  paymasterAndData: '0x',
  signature: evidence.validatorEnvelope,
};

async function validate(userOperationHash) {
  return validateUserOperation({
    rpcUrl,
    account: PROOF_ACCOUNT,
    packedUserOperation,
    userOperationHash,
    stateOverride,
  });
}

const changedHash = `${evidence.userOperationHash.slice(0, -1)}${
  evidence.userOperationHash.endsWith('0') ? '1' : '0'
}`;
const result = {
  valid: await validate(evidence.userOperationHash),
  changedChallenge: await validate(changedHash),
};
assert.deepEqual(result, { valid: 0n, changedChallenge: 1n });

console.log(
  JSON.stringify(
    {
      validator: ZERODEV_WEBAUTHN_VALIDATOR,
      account: PROOF_ACCOUNT,
      userOperationHash: evidence.userOperationHash,
      credentialIdHash: evidence.credentialIdHash,
      validatorEnvelopeHash: keccak256(evidence.validatorEnvelope),
      results: Object.fromEntries(
        Object.entries(result).map(([name, value]) => [name, value.toString()]),
      ),
    },
    null,
    2,
  ),
);
