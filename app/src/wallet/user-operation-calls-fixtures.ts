import { encodeCallDataEpV07 } from '@zerodev/sdk';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';

export type FixtureCall = { to: Address; value: bigint; data?: Hex };

/** Kernel v3 callData built with ZeroDev's own encoder, as the wallet sends it. */
export function encodeKernelCalls(calls: readonly FixtureCall[]) {
  return encodeCallDataEpV07(calls.map((call) => ({ ...call, data: call.data ?? '0x' })));
}

export function encodeBundle(
  sender: Address,
  nonce: bigint,
  callData: Hex,
  others: readonly { sender: Address; nonce: bigint; callData: Hex }[] = [],
): Hex {
  const operation = (op: { sender: Address; nonce: bigint; callData: Hex }) => ({
    sender: op.sender,
    nonce: op.nonce,
    initCode: '0x' as Hex,
    callData: op.callData,
    accountGasLimits: `0x${'00'.repeat(32)}` as Hex,
    preVerificationGas: 0n,
    gasFees: `0x${'00'.repeat(32)}` as Hex,
    paymasterAndData: '0x' as Hex,
    signature: '0x' as Hex,
  });
  return encodeFunctionData({
    abi: entryPoint07Abi,
    functionName: 'handleOps',
    args: [
      [...others, { sender, nonce, callData }].map(operation),
      '0x0000000000000000000000000000000000000001',
    ],
  });
}
