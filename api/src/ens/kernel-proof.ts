import {
  concatHex,
  createPublicClient,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';

import { ENSV2, KERNEL_IMPLEMENTATION_SLOT, kernelAbi, passkeyValidatorAbi } from './contracts.ts';

export type KernelPasskeyKey = { x: Buffer; y: Buffer };

export async function readKernelPasskeyKey(client: PublicClient, account: Address): Promise<KernelPasskeyKey> {
  if (!isAddress(account) || account.toLowerCase() === zeroAddress) throw new Error('Invalid Kernel account');
  if (await client.getChainId() !== sepolia.id) throw new Error('Unexpected Kernel chain');
  const blockNumber = await client.getBlockNumber();
  const code = await client.getCode({ address: account, blockNumber });
  if (!code || code === '0x') throw new Error('Kernel account is not deployed');
  const [implementationSlot, root, moduleInstalled, initialized, key] = await Promise.all([
    client.getStorageAt({ address: account, slot: KERNEL_IMPLEMENTATION_SLOT, blockNumber }),
    client.readContract({ address: account, abi: kernelAbi, functionName: 'rootValidator', blockNumber }),
    client.readContract({ address: account, abi: kernelAbi, functionName: 'isModuleInstalled', args: [1n, ENSV2.passkeyValidator, '0x'], blockNumber }),
    client.readContract({ address: ENSV2.passkeyValidator, abi: passkeyValidatorAbi, functionName: 'isInitialized', args: [account], blockNumber }),
    client.readContract({ address: ENSV2.passkeyValidator, abi: passkeyValidatorAbi, functionName: 'webAuthnValidatorStorage', args: [account], blockNumber }),
  ]);
  if (!implementationSlot || `0x${implementationSlot.slice(-40)}`.toLowerCase() !== ENSV2.kernelImplementation.toLowerCase() ||
      root.toLowerCase() !== concatHex(['0x01', ENSV2.passkeyValidator]).toLowerCase() ||
      !moduleInstalled || !initialized || key[0] === 0n || key[1] === 0n) {
    throw new Error('Account is not controlled by the pinned Primary Passkey validator');
  }
  return {
    x: Buffer.from(key[0].toString(16).padStart(64, '0'), 'hex'),
    y: Buffer.from(key[1].toString(16).padStart(64, '0'), 'hex'),
  };
}

export function createKernelPasskeyReader() {
  const url = process.env.SEPOLIA_RPC_URL;
  if (!url) throw new Error('SEPOLIA_RPC_URL is required for Kernel verification');
  const client = createPublicClient({ chain: sepolia, transport: http(url) });
  return (account: Address) => readKernelPasskeyKey(client, account);
}
