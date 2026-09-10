import assert from 'node:assert/strict';

import { p256 } from '@noble/curves/nist.js';
import { findQuoteIndices } from '@zerodev/webauthn-key';
import {
  bytesToBigInt,
  hexToBytes,
  toHex,
} from 'viem';
import { getUserOperationHash } from 'viem/account-abstraction';

import {
  createSyntheticAssertion,
  SYNTHETIC_CREDENTIAL_LABEL,
  SYNTHETIC_ORIGIN,
  SYNTHETIC_PUBLIC_KEY,
  SYNTHETIC_RP_ID,
} from './lib/synthetic-webauthn-test-credential.mjs';
import {
  assertSepoliaRpc,
  createPublicKeyStorageOverride,
  requireSepoliaRpcUrl,
  SEPOLIA_CHAIN_ID,
  validateUserOperation,
} from './lib/zerodev-webauthn-validator.mjs';

const CHAIN_ID = Number(SEPOLIA_CHAIN_ID);
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const TEST_CALLER = '0x0000000000000000000000000000000000001840';
const WRONG_CALLER = '0x0000000000000000000000000000000000001841';
const rpcUrl = requireSepoliaRpcUrl();
const unpackedUserOperation = {
  sender: TEST_CALLER,
  nonce: 7n,
  factory: '0x2222222222222222222222222222222222222222',
  factoryData: '0x1234',
  callData: '0xabcdef',
  callGasLimit: 100_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  paymaster: '0x3333333333333333333333333333333333333333',
  paymasterVerificationGasLimit: 30_000n,
  paymasterPostOpGasLimit: 20_000n,
  paymasterData: '0x5678',
  signature: '0x',
};
const packedUserOperation = {
  sender: TEST_CALLER,
  nonce: 0n,
  initCode: '0x',
  callData: '0x',
  accountGasLimits: `0x${'00'.repeat(32)}`,
  preVerificationGas: 0n,
  gasFees: `0x${'00'.repeat(32)}`,
  paymasterAndData: '0x',
  signature: '0x',
};

const { bytes: publicKey, x: pubX, y: pubY } = SYNTHETIC_PUBLIC_KEY;
const wrongPublicKey = p256.getPublicKey(2n, false);
const wrongPubX = bytesToBigInt(wrongPublicKey.slice(1, 33));
const wrongPubY = bytesToBigInt(wrongPublicKey.slice(33));

function userOperationHash(overrides = {}, domain = {}) {
  return getUserOperationHash({
    userOperation: { ...unpackedUserOperation, ...overrides },
    entryPointAddress: domain.entryPoint ?? ENTRY_POINT,
    entryPointVersion: '0.7',
    chainId: domain.chainId ?? CHAIN_ID,
  });
}

function storageOverride(x = pubX, y = pubY) {
  return createPublicKeyStorageOverride(
    TEST_CALLER,
    toHex(x, { size: 32 }),
    toHex(y, { size: 32 }),
  );
}

async function validate(hash, signature, { from = TEST_CALLER, override = storageOverride() } = {}) {
  return validateUserOperation({
    rpcUrl,
    account: from,
    packedUserOperation: { ...packedUserOperation, signature },
    userOperationHash: hash,
    stateOverride: override,
  });
}

await assertSepoliaRpc(rpcUrl);

const hash = userOperationHash();
const assertion = createSyntheticAssertion(hash);
const wrongChainHash = userOperationHash({}, { chainId: 1 });
const wrongEntryPointHash = userOperationHash(
  {},
  { entryPoint: '0x0000000000000000000000000000000000000001' },
);
assert.equal(
  p256.verify({ r: assertion.r, s: assertion.s }, hexToBytes(assertion.digest), publicKey),
  true,
);
assert.equal(findQuoteIndices(assertion.clientDataJSON).beforeChallenge, 23n);
assert.equal(assertion.authenticatorData.length, 37);

const results = {};
results.valid = await validate(hash, assertion.signature);
results.repeatAtValidator = await validate(hash, assertion.signature);
const fieldMutations = {
  changedNonce: { nonce: 8n },
  changedSender: { sender: WRONG_CALLER },
  changedFactory: { factory: '0x2222222222222222222222222222222222222223' },
  changedFactoryData: { factoryData: '0x1235' },
  changedCallData: { callData: '0xabcdee' },
  changedCallGas: { callGasLimit: 100_001n },
  changedVerificationGas: { verificationGasLimit: 200_001n },
  changedPreVerificationGas: { preVerificationGas: 50_001n },
  changedMaxFee: { maxFeePerGas: 2_000_000_001n },
  changedPriorityFee: { maxPriorityFeePerGas: 1_000_000_001n },
  changedPaymaster: { paymaster: '0x3333333333333333333333333333333333333334' },
  changedPaymasterVerificationGas: { paymasterVerificationGasLimit: 30_001n },
  changedPaymasterPostOpGas: { paymasterPostOpGasLimit: 20_001n },
  changedPaymasterData: { paymasterData: '0x5679' },
};
for (const [name, mutation] of Object.entries(fieldMutations)) {
  results[name] = await validate(userOperationHash(mutation), assertion.signature);
}
results.wrongChain = await validate(wrongChainHash, assertion.signature);
results.wrongEntryPoint = await validate(wrongEntryPointHash, assertion.signature);
results.wrongAccount = await validate(hash, assertion.signature, { from: WRONG_CALLER });
results.wrongCredential = await validate(hash, assertion.signature, {
  override: storageOverride(wrongPubX, wrongPubY),
});
results.userPresenceMissing = await validate(
  hash,
  createSyntheticAssertion(hash, { flags: 0x04 }).signature,
);
results.userVerificationMissing = await validate(
  hash,
  createSyntheticAssertion(hash, { flags: 0x01 }).signature,
);
results.wrongTypeLocation = await validate(
  hash,
  createSyntheticAssertion(hash, { responseTypeLocation: 2n }).signature,
);
results.highS = await validate(
  hash,
  createSyntheticAssertion(hash, { normalizeS: false }).signature,
);
results.tamperedOrigin = await validate(
  hash,
  createSyntheticAssertion(hash, { tamperOrigin: 'https://tampered.invalid' }).signature,
);
results.tamperedRpId = await validate(
  hash,
  createSyntheticAssertion(hash, { tamperRpId: 'tampered-rp.invalid' }).signature,
);
results.resignedWrongOrigin = await validate(
  hash,
  createSyntheticAssertion(hash, { origin: 'https://wrong-origin.invalid' }).signature,
);
results.resignedWrongRpId = await validate(
  hash,
  createSyntheticAssertion(hash, { rpId: 'wrong-rp.invalid' }).signature,
);

assert.deepEqual(results, {
  valid: 0n,
  repeatAtValidator: 0n,
  changedNonce: 1n,
  changedSender: 1n,
  changedFactory: 1n,
  changedFactoryData: 1n,
  changedCallData: 1n,
  changedCallGas: 1n,
  changedVerificationGas: 1n,
  changedPreVerificationGas: 1n,
  changedMaxFee: 1n,
  changedPriorityFee: 1n,
  changedPaymaster: 1n,
  changedPaymasterVerificationGas: 1n,
  changedPaymasterPostOpGas: 1n,
  changedPaymasterData: 1n,
  wrongChain: 1n,
  wrongEntryPoint: 1n,
  wrongAccount: 1n,
  wrongCredential: 1n,
  userPresenceMissing: 1n,
  userVerificationMissing: 1n,
  wrongTypeLocation: 1n,
  highS: 1n,
  tamperedOrigin: 1n,
  tamperedRpId: 1n,
  resignedWrongOrigin: 0n,
  resignedWrongRpId: 0n,
});

let malformedAssertionReverted = false;
try {
  await validate(hash, '0x12');
} catch (error) {
  assert.match(error.message, /revert/i);
  malformedAssertionReverted = true;
}
assert.equal(malformedAssertionReverted, true);

console.log(
  JSON.stringify(
    {
      credentialLabel: SYNTHETIC_CREDENTIAL_LABEL,
      privateKeyPolicy: 'public test scalar; never use for assets or production',
      publicKey: { x: toHex(pubX, { size: 32 }), y: toHex(pubY, { size: 32 }) },
      rpId: SYNTHETIC_RP_ID,
      origin: SYNTHETIC_ORIGIN,
      userOperationHash: hash,
      challenge: Buffer.from(hash.slice(2), 'hex').toString('base64url'),
      responseTypeLocation: '1',
      challengeLocation: '23',
      derSignature: assertion.der,
      normalizedSignature: { r: toHex(assertion.r), s: toHex(assertion.s) },
      results: Object.fromEntries(
        Object.entries(results).map(([name, result]) => [name, result.toString()]),
      ),
      malformedAssertionReverted,
    },
    null,
    2,
  ),
);
