import { describe, expect, it, vi } from 'vitest';
import { concatHex, type PublicClient } from 'viem';

import { ENSV2 } from './contracts.ts';
import { readKernelPasskeyKey } from './kernel-proof.ts';

const account = '0x1111111111111111111111111111111111111111';

function reader(root: string = concatHex(['0x01', ENSV2.passkeyValidator]), code: string | undefined = '0x1234') {
  return {
    getChainId: vi.fn().mockResolvedValue(11155111),
    getBlockNumber: vi.fn().mockResolvedValue(42n),
    getCode: vi.fn().mockResolvedValue(code),
    getStorageAt: vi.fn().mockResolvedValue(`0x${'0'.repeat(24)}${ENSV2.kernelImplementation.slice(2)}`),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'rootValidator') return root;
      if (functionName === 'isModuleInstalled' || functionName === 'isInitialized') return true;
      if (functionName === 'webAuthnValidatorStorage') return [1n, 2n];
      throw new Error('Unexpected read');
    }),
  } as unknown as PublicClient;
}

describe('deployed Kernel signer gate', () => {
  it('reads the current initialized passkey validator key', async () => {
    const key = await readKernelPasskeyKey(reader(), account);
    expect(key.x.toString('hex')).toBe(`${'0'.repeat(63)}1`);
    expect(key.y.toString('hex')).toBe(`${'0'.repeat(63)}2`);
  });

  it('rejects undeployed accounts and a different root validator', async () => {
    await expect(readKernelPasskeyKey(reader(undefined, '0x'), account)).rejects.toThrow('not deployed');
    await expect(readKernelPasskeyKey(reader('0x' + '00'.repeat(21)), account)).rejects.toThrow('not controlled');
  });
});
