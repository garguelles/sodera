import {
  createPublicClient,
  http,
  keccak256,
  stringToHex,
  zeroAddress,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';

import { ENSV2, factoryAbi, registryAbi } from './contracts.ts';

export type Availability = {
  chainId: 11155111;
  name: string;
  status: 'available' | 'reserved' | 'registered';
  claimable: boolean;
  owner: string | null;
  expiresAt: string | null;
};

export function createEnsLookup(client: PublicClient, now = Date.now) {
  return async ({ label, name }: { label: string; name: string }): Promise<Availability> => {
    if (await client.getChainId() !== sepolia.id) throw new Error('Unexpected ENS chain');
    const blockNumber = await client.getBlockNumber();
    const [eth, parent, child, implementation] = await Promise.all([
      client.readContract({ address: ENSV2.root, abi: registryAbi, functionName: 'getSubregistry', args: ['eth'], blockNumber }),
      client.readContract({ address: ENSV2.eth, abi: registryAbi, functionName: 'getState', args: [BigInt(keccak256(stringToHex('sodera')))], blockNumber }),
      client.readContract({ address: ENSV2.eth, abi: registryAbi, functionName: 'getSubregistry', args: ['sodera'], blockNumber }),
      client.readContract({ address: ENSV2.factory, abi: factoryAbi, functionName: 'verifyContract', args: [ENSV2.child], blockNumber }),
    ]);
    if (eth.toLowerCase() !== ENSV2.eth.toLowerCase() || parent.status !== 2 ||
      parent.latestOwner.toLowerCase() !== ENSV2.parentOwner.toLowerCase() ||
      Number(parent.expiry) <= now() / 1000 || child.toLowerCase() !== ENSV2.child.toLowerCase() ||
      implementation.toLowerCase() !== ENSV2.implementation.toLowerCase()) {
      throw new Error('ENS namespace is unavailable');
    }
    const [canonicalParent, state] = await Promise.all([
      client.readContract({ address: child, abi: registryAbi, functionName: 'getParent', blockNumber }),
      client.readContract({ address: child, abi: registryAbi, functionName: 'getState', args: [BigInt(keccak256(stringToHex(label)))], blockNumber }),
    ]);
    if (canonicalParent[0].toLowerCase() !== ENSV2.eth.toLowerCase() || canonicalParent[1] !== 'sodera') {
      throw new Error('ENS namespace has moved');
    }
    const status = (['available', 'reserved', 'registered'] as const)[state.status];
    if (!status) throw new Error('Unexpected ENS name status');
    return {
      chainId: sepolia.id,
      name,
      status,
      claimable: status === 'available' && Number(parent.expiry) > now() / 1000 + 365 * 86400,
      owner: status === 'registered' && state.latestOwner !== zeroAddress ? state.latestOwner : null,
      expiresAt: status === 'available' ? null : new Date(Number(state.expiry) * 1000).toISOString(),
    };
  };
}

export function createSepoliaEnsLookup() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('SEPOLIA_RPC_URL is required for the ENS API');
  return createEnsLookup(createPublicClient({ chain: sepolia, transport: http(rpcUrl) }));
}
