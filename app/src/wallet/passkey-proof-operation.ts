import type { UserOperation } from 'viem/account-abstraction';

export const passkeyProofUserOperation: UserOperation<'0.7'> = {
  sender: '0x1111111111111111111111111111111111111111',
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
