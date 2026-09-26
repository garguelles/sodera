import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  hexToBigInt,
  parseAbi,
  sliceHex,
  size,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';

export type UserOperationEthTransfer = { to: Address; valueWei: string };

export type UserOperationTransactionReader = {
  getTransaction(args: { hash: Hash }): Promise<{ input: Hex }>;
};

const kernelExecuteAbi = parseAbi(['function execute(bytes32 mode, bytes executionCalldata)']);
const KERNEL_CALL_TYPE_SINGLE = '0x00';
const KERNEL_CALL_TYPE_BATCH = '0x01';

/**
 * Reads the native ETH transfers a Kernel user operation made, straight from the bundle
 * transaction that carried it. Returns null when the transaction cannot be decoded.
 */
export function decodeUserOperationEthTransfers({
  input,
  sender,
  nonce,
}: {
  input: Hex;
  sender: Address;
  nonce: bigint;
}): UserOperationEthTransfer[] | null {
  try {
    const bundle = decodeFunctionData({ abi: entryPoint07Abi, data: input });
    if (bundle.functionName !== 'handleOps') return null;
    const [operations] = bundle.args as unknown as [readonly { sender: Address; nonce: bigint; callData: Hex }[]];
    const operation = operations.find(
      (candidate) =>
        candidate.sender.toLowerCase() === sender.toLowerCase() && candidate.nonce === nonce,
    );
    if (!operation) return null;
    return decodeKernelCalls(operation.callData)
      ?.filter((call) => call.value > 0n)
      .map((call) => ({ to: getAddress(call.target), valueWei: call.value.toString() })) ?? null;
  } catch {
    return null;
  }
}

function decodeKernelCalls(callData: Hex) {
  const execute = decodeFunctionData({ abi: kernelExecuteAbi, data: callData });
  const [mode, executionCalldata] = execute.args;
  const callType = sliceHex(mode, 0, 1);
  if (callType === KERNEL_CALL_TYPE_SINGLE) {
    if (size(executionCalldata) < 52) return null;
    return [
      {
        target: sliceHex(executionCalldata, 0, 20) as Address,
        value: hexToBigInt(sliceHex(executionCalldata, 20, 52)),
      },
    ];
  }
  if (callType === KERNEL_CALL_TYPE_BATCH) {
    const [calls] = decodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { name: 'target', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'callData', type: 'bytes' },
          ],
        },
      ],
      executionCalldata,
    );
    return calls.map((call) => ({ target: call.target, value: call.value }));
  }
  return null;
}

export async function readUserOperationEthTransfers(
  reader: UserOperationTransactionReader,
  operation: { transactionHash: Hash; sender: Address; nonce: bigint },
) {
  const transaction = await reader.getTransaction({ hash: operation.transactionHash });
  return decodeUserOperationEthTransfers({
    input: transaction.input,
    sender: operation.sender,
    nonce: operation.nonce,
  });
}
