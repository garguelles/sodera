import assert from 'node:assert/strict';

import { createPublicClient, getAddress, http, isAddress, keccak256, toHex, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';

import { ENSV2, factoryAbi, registryAbi } from './lib/ensv2-sepolia.mjs';

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const rawIssuer = process.env.ENS_ISSUER_ADDRESS;
if (!rpcUrl) throw new Error('SEPOLIA_RPC_URL is required');
if (!rawIssuer || !isAddress(rawIssuer)) throw new Error('ENS_ISSUER_ADDRESS must be a valid public address');
const issuer = getAddress(rawIssuer);
assert.notEqual(issuer, zeroAddress, 'Issuer cannot be the zero address');
assert.notEqual(issuer.toLowerCase(), ENSV2.owner.toLowerCase(), 'Issuer must be separate from the parent owner');

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
assert.equal(await client.getChainId(), sepolia.id, 'RPC is not Ethereum Sepolia');
const blockNumber = await client.getBlockNumber();
const [ethPointer, parentState, child] = await Promise.all([
  client.readContract({ address: ENSV2.rootRegistry, abi: registryAbi, functionName: 'getSubregistry', args: ['eth'], blockNumber }),
  client.readContract({ address: ENSV2.ethRegistry, abi: registryAbi, functionName: 'getState', args: [BigInt(keccak256(toHex('sodera')))], blockNumber }),
  client.readContract({ address: ENSV2.ethRegistry, abi: registryAbi, functionName: 'getSubregistry', args: ['sodera'], blockNumber }),
]);
assert.equal(ethPointer.toLowerCase(), ENSV2.ethRegistry.toLowerCase(), 'The .eth registry pointer changed');
assert.equal(parentState.status, 2, 'sodera.eth is not registered');
assert.equal(parentState.latestOwner.toLowerCase(), ENSV2.owner.toLowerCase(), 'sodera.eth owner changed');
assert.ok(Number(parentState.expiry) > Date.now() / 1000, 'sodera.eth has expired');
assert.equal(child.toLowerCase(), ENSV2.childRegistry.toLowerCase(), 'Mounted child registry changed');
const implementation = await client.readContract({
  address: ENSV2.factory,
  abi: factoryAbi,
  functionName: 'verifyContract',
  args: [child],
  blockNumber,
});
assert.equal(implementation.toLowerCase(), ENSV2.userRegistryImpl.toLowerCase(), 'Child implementation changed');

const [roles, balance, code, canonicalParent, childEmancipated] = await Promise.all([
  client.readContract({
    address: child,
    abi: registryAbi,
    functionName: 'roles',
    args: [0n, issuer],
    blockNumber,
  }),
  client.getBalance({ address: issuer, blockNumber }),
  client.getCode({ address: issuer, blockNumber }),
  client.readContract({ address: child, abi: registryAbi, functionName: 'getParent', blockNumber }),
  client.readContract({ address: child, abi: registryAbi, functionName: 'isEmancipated', blockNumber }),
]);
assert.equal(canonicalParent[0].toLowerCase(), ENSV2.ethRegistry.toLowerCase(), 'Child canonical parent changed');
assert.equal(canonicalParent[1], 'sodera', 'Child canonical label changed');
assert.equal(childEmancipated, true, 'Child registry is no longer emancipated');
assert.ok(!code || code === '0x', 'Issuer address must be an externally owned account');
const registrarRole = 1n;
console.log(JSON.stringify({
  chainId: sepolia.id,
  blockNumber: blockNumber.toString(),
  issuer,
  registry: child,
  rootRoles: `0x${roles.toString(16)}`,
  registrarGranted: (roles & registrarRole) !== 0n,
  externallyOwnedAccount: true,
  sepoliaEthWei: balance.toString(),
}, null, 2));
assert.ok(roles === 0n || roles === registrarRole, 'Issuer has unexpected root roles');
