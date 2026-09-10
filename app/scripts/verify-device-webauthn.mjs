import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  isHex,
  keccak256,
  toHex,
} from 'viem';

const VALIDATOR = '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69';
const PROOF_ACCOUNT = '0x1111111111111111111111111111111111111111';
const SEPOLIA_CHAIN_ID = 11155111n;

const validatorAbi = [
  {
    type: 'function',
    name: 'validateUserOp',
    stateMutability: 'payable',
    inputs: [
      {
        name: '_userOp',
        type: 'tuple',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: '_userOpHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'validationData', type: 'uint256' }],
  },
];

const rpcUrl = process.env.SEPOLIA_RPC_URL ?? process.env.ZERODEV_SEPOLIA_BUNDLER_RPC;
if (!rpcUrl) throw new Error('SEPOLIA_RPC_URL or ZERODEV_SEPOLIA_BUNDLER_RPC is required');
if (!process.argv[2]) throw new Error('Usage: pnpm verify:device-webauthn <evidence.json>');

const evidence = JSON.parse(await readFile(process.argv[2], 'utf8'));
for (const field of ['userOperationHash', 'publicKeyX', 'publicKeyY', 'validatorEnvelope']) {
  if (!isHex(evidence[field])) throw new Error(`${field} must be hex`);
}
assert.equal(evidence.userOperationHash.length, 66);
assert.equal(evidence.publicKeyX.length, 66);
assert.equal(evidence.publicKeyY.length, 66);

const chainResponse = await fetch(rpcUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
});
const chainPayload = await chainResponse.json();
if (!chainResponse.ok || chainPayload.error) {
  throw new Error(chainPayload.error?.message || `RPC failed with HTTP ${chainResponse.status}`);
}
assert.equal(BigInt(chainPayload.result), SEPOLIA_CHAIN_ID);

const xSlot = keccak256(
  encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [PROOF_ACCOUNT, 0n],
  ),
);
const stateOverride = {
  [VALIDATOR]: {
    stateDiff: {
      [xSlot]: evidence.publicKeyX,
      [toHex(BigInt(xSlot) + 1n, { size: 32 })]: evidence.publicKeyY,
    },
  },
};
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
  const data = encodeFunctionData({
    abi: validatorAbi,
    functionName: 'validateUserOp',
    args: [packedUserOperation, userOperationHash],
  });
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ from: PROOF_ACCOUNT, to: VALIDATOR, data }, 'latest', stateOverride],
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `RPC failed with HTTP ${response.status}`);
  }
  return decodeFunctionResult({ abi: validatorAbi, functionName: 'validateUserOp', data: payload.result });
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
      validator: VALIDATOR,
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
