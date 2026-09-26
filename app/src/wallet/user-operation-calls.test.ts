import { encodeFunctionData, erc20Abi, type Address } from 'viem';

import { decodeUserOperationEthTransfers } from './user-operation-calls';
import { encodeBundle, encodeKernelCalls } from './user-operation-calls-fixtures';

const account = '0x1111111111111111111111111111111111111111' as Address;
const recipient = '0x2222222222222222222222222222222222222222' as Address;
const stranger = '0x3333333333333333333333333333333333333333' as Address;
const usdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address;

describe('decodeUserOperationEthTransfers', () => {
  it('reads a single ETH send encoded by the wallet', async () => {
    const callData = await encodeKernelCalls([{ to: recipient, value: 10n ** 17n }]);

    expect(
      decodeUserOperationEthTransfers({ input: encodeBundle(account, 5n, callData), sender: account, nonce: 5n }),
    ).toEqual([{ to: recipient, valueWei: '100000000000000000' }]);
  });

  it('reads only the ETH-carrying calls of a batch', async () => {
    const callData = await encodeKernelCalls([
      { to: recipient, value: 1n },
      {
        to: usdc,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, 5n] }),
      },
      { to: stranger, value: 2n },
    ]);

    expect(
      decodeUserOperationEthTransfers({ input: encodeBundle(account, 1n, callData), sender: account, nonce: 1n }),
    ).toEqual([
      { to: recipient, valueWei: '1' },
      { to: stranger, valueWei: '2' },
    ]);
  });

  it('picks the operation matching sender and nonce in a shared bundle', async () => {
    const mine = await encodeKernelCalls([{ to: recipient, value: 3n }]);
    const theirs = await encodeKernelCalls([{ to: stranger, value: 9n }]);
    const input = encodeBundle(account, 2n, mine, [
      { sender: stranger, nonce: 2n, callData: theirs },
      { sender: account, nonce: 1n, callData: theirs },
    ]);

    expect(decodeUserOperationEthTransfers({ input, sender: account, nonce: 2n })).toEqual([
      { to: recipient, valueWei: '3' },
    ]);
  });

  it('returns an empty list for an operation that moves no ETH', async () => {
    const callData = await encodeKernelCalls([{ to: usdc, value: 0n, data: '0xa9059cbb' }]);

    expect(
      decodeUserOperationEthTransfers({ input: encodeBundle(account, 1n, callData), sender: account, nonce: 1n }),
    ).toEqual([]);
  });

  it('returns null when the transaction cannot be decoded or the operation is absent', async () => {
    const callData = await encodeKernelCalls([{ to: recipient, value: 1n }]);

    expect(decodeUserOperationEthTransfers({ input: '0x1234', sender: account, nonce: 1n })).toBeNull();
    expect(
      decodeUserOperationEthTransfers({ input: encodeBundle(stranger, 1n, callData), sender: account, nonce: 1n }),
    ).toBeNull();
  });
});
