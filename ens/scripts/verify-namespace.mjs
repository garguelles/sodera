import assert from 'node:assert/strict';

import { createPublicClient, http, isAddress, keccak256, toHex, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';

import { ENSV2, factoryAbi, registryAbi } from './lib/ensv2-sepolia.mjs';

const rpcUrl = process.env.SEPOLIA_RPC_URL;
if (!rpcUrl) throw new Error('SEPOLIA_RPC_URL is required');
const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
assert.equal(await client.getChainId(), sepolia.id, 'RPC is not Ethereum Sepolia');
const blockNumber = await client.getBlockNumber();
const read = (address, functionName, args = []) => client.readContract({
  address, abi: registryAbi, functionName, args, blockNumber,
});

for (const [name, address] of Object.entries({
  'root registry': ENSV2.rootRegistry,
  '.eth registry': ENSV2.ethRegistry,
  factory: ENSV2.factory,
  'user registry implementation': ENSV2.userRegistryImpl,
  'resolver implementation': ENSV2.resolverImpl,
  'universal resolver': ENSV2.universalResolver,
})) {
  const code = await client.getCode({ address, blockNumber });
  assert.ok(code && code !== '0x', `${name} has no bytecode`);
}

assert.equal(
  (await read(ENSV2.rootRegistry, 'getSubregistry', ['eth'])).toLowerCase(),
  ENSV2.ethRegistry.toLowerCase(),
  'The current root does not point to the pinned .eth registry',
);
const labelhash = BigInt(keccak256(toHex('sodera')));
const parent = await read(ENSV2.ethRegistry, 'getState', [labelhash]);
const subregistry = await read(ENSV2.ethRegistry, 'getSubregistry', ['sodera']);
const ownerRoles = parent.latestOwner === zeroAddress
  ? null
  : await read(ENSV2.ethRegistry, 'roles', [labelhash, parent.latestOwner]);
const setSubregistryRole = 1n << 20n;
const namespace = {
  chainId: sepolia.id,
  blockNumber: blockNumber.toString(),
  parentRegistry: ENSV2.ethRegistry,
  parentStatus: ['AVAILABLE', 'RESERVED', 'REGISTERED'][parent.status] ?? `UNKNOWN_${parent.status}`,
  parentOwner: parent.latestOwner,
  parentExpiry: new Date(Number(parent.expiry) * 1000).toISOString(),
  parentOwnerRoles: ownerRoles === null ? null : `0x${ownerRoles.toString(16)}`,
  parentOwnerCanMountSubregistry: ownerRoles === null ? false : (ownerRoles & setSubregistryRole) !== 0n,
  parentRoleCounts: `0x${(await read(ENSV2.ethRegistry, 'roleCount', [labelhash])).toString(16)}`,
  subregistry,
};

const childToInspect = process.env.ENS_CHILD_REGISTRY ?? (subregistry === zeroAddress ? null : subregistry);
if (childToInspect) {
  assert.ok(isAddress(childToInspect), 'ENS_CHILD_REGISTRY must be an address');
  const implementation = await client.readContract({
    address: ENSV2.factory, abi: factoryAbi, functionName: 'verifyContract', args: [childToInspect], blockNumber,
  });
  namespace.inspectedChildRegistry = childToInspect;
  namespace.subregistryImplementation = implementation;
  namespace.subregistryIsOfficialUserRegistry = implementation.toLowerCase() === ENSV2.userRegistryImpl.toLowerCase();
  const [canonicalParent, canonicalLabel] = await read(childToInspect, 'getParent');
  namespace.canonicalParent = canonicalParent;
  namespace.canonicalLabel = canonicalLabel;
  namespace.childEmancipated = await read(childToInspect, 'isEmancipated');
  namespace.childOwnerRootRoles = `0x${(await read(childToInspect, 'roles', [0n, ENSV2.owner])).toString(16)}`;
  namespace.childRootRoleCounts = `0x${(await read(childToInspect, 'roleCount', [0n])).toString(16)}`;
  namespace.childMounted = subregistry.toLowerCase() === childToInspect.toLowerCase();
}

console.log(JSON.stringify(namespace, null, 2));
assert.equal(parent.status, 2, 'sodera.eth is not currently registered');
assert.ok(Number(parent.expiry) > Date.now() / 1000, 'sodera.eth has expired');
assert.ok(namespace.parentOwnerCanMountSubregistry, 'The current parent owner cannot mount a child registry');
if (process.env.ENS_PARENT_OWNER) {
  assert.equal(parent.latestOwner.toLowerCase(), process.env.ENS_PARENT_OWNER.toLowerCase());
}
