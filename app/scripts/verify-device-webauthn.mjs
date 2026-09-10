import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isHex, keccak256 } from 'viem';

import {
  assertSepoliaRpc,
  createPublicKeyStorageOverride,
  requireSepoliaRpcUrl,
  validateUserOperation,
  ZERODEV_WEBAUTHN_VALIDATOR,
} from './lib/zerodev-webauthn-validator.mjs';

const PROOF_ACCOUNT = '0x1111111111111111111111111111111111111111';

const rpcUrl = requireSepoliaRpcUrl();
if (!process.argv[2]) throw new Error('Usage: pnpm verify:device-webauthn <evidence.json>');

const evidence = JSON.parse(await readFile(process.argv[2], 'utf8'));
for (const field of ['userOperationHash', 'publicKeyX', 'publicKeyY', 'validatorEnvelope']) {
  if (!isHex(evidence[field])) throw new Error(`${field} must be hex`);
}
assert.equal(evidence.userOperationHash.length, 66);
assert.equal(evidence.publicKeyX.length, 66);
assert.equal(evidence.publicKeyY.length, 66);

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
