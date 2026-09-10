import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toHex,
} from 'viem';

export const SEPOLIA_CHAIN_ID = 11155111n;
export const ZERODEV_WEBAUTHN_VALIDATOR = '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69';

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

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `RPC failed with HTTP ${response.status}`);
  }
  return payload.result;
}

export function requireSepoliaRpcUrl() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? process.env.ZERODEV_SEPOLIA_BUNDLER_RPC;
  if (!rpcUrl) {
    throw new Error('SEPOLIA_RPC_URL or ZERODEV_SEPOLIA_BUNDLER_RPC is required');
  }
  return rpcUrl;
}

export async function assertSepoliaRpc(rpcUrl) {
  const chainId = await rpc(rpcUrl, 'eth_chainId', []);
  if (BigInt(chainId) !== SEPOLIA_CHAIN_ID) {
    throw new Error(`Expected Sepolia chain ID ${SEPOLIA_CHAIN_ID}, received ${BigInt(chainId)}`);
  }
}

export function createPublicKeyStorageOverride(account, publicKeyX, publicKeyY) {
  const xSlot = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [account, 0n],
    ),
  );
  return {
    [ZERODEV_WEBAUTHN_VALIDATOR]: {
      stateDiff: {
        [xSlot]: publicKeyX,
        [toHex(BigInt(xSlot) + 1n, { size: 32 })]: publicKeyY,
      },
    },
  };
}

export async function validateUserOperation({
  rpcUrl,
  account,
  packedUserOperation,
  userOperationHash,
  stateOverride,
}) {
  const data = encodeFunctionData({
    abi: validatorAbi,
    functionName: 'validateUserOp',
    args: [packedUserOperation, userOperationHash],
  });
  const result = await rpc(rpcUrl, 'eth_call', [
    { from: account, to: ZERODEV_WEBAUTHN_VALIDATOR, data },
    'latest',
    stateOverride,
  ]);
  return decodeFunctionResult({ abi: validatorAbi, functionName: 'validateUserOp', data: result });
}
