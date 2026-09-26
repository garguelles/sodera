import assert from 'node:assert/strict';

import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  http,
  keccak256,
  namehash,
  parseAbi,
  stringToHex,
  zeroAddress,
} from 'viem';
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

const labelhash = BigInt(keccak256(stringToHex('sodera')));
const [ethPointer, parent, childPointer] = await Promise.all([
  read(ENSV2.rootRegistry, 'getSubregistry', ['eth']),
  read(ENSV2.ethRegistry, 'getState', [labelhash]),
  read(ENSV2.ethRegistry, 'getSubregistry', ['sodera']),
]);
assert.equal(ethPointer.toLowerCase(), ENSV2.ethRegistry.toLowerCase(), 'The .eth pointer has changed');
assert.equal(parent.status, 2, 'sodera.eth is not registered');
assert.equal(parent.latestOwner.toLowerCase(), ENSV2.owner.toLowerCase(), 'The parent owner has changed');
assert.equal(childPointer, zeroAddress, 'sodera.eth already has a child registry');
assert.ok(Number(parent.expiry) > Date.now() / 1000 + 365 * 86400, 'Renew sodera.eth before issuing names');

const setSubregistryRole = 1n << 20n;
const parentOwnerRoles = await read(ENSV2.ethRegistry, 'roles', [labelhash, ENSV2.owner]);
assert.ok((parentOwnerRoles & setSubregistryRole) !== 0n, 'The owner cannot mount a child registry');

for (const [name, address] of Object.entries({
  factory: ENSV2.factory,
  implementation: ENSV2.userRegistryImpl,
})) {
  const code = await client.getCode({ address, blockNumber });
  assert.ok(code && code !== '0x', `${name} has no bytecode`);
}

const roleSetParent = 1n << 8n;
const roleRegistrarAdmin = 1n << 128n;
const roleRenewAdmin = 1n << 144n;
const ownerRootRoles = roleSetParent | roleRegistrarAdmin | roleRenewAdmin;
const salt = BigInt(keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
  [keccak256(stringToHex('UserRegistry')), namehash('sodera.eth'), 0n],
)));
const initializer = encodeFunctionData({
  abi: parseAbi(['function initialize((address account, uint256 roleBitmap)[] grants)']),
  functionName: 'initialize',
  args: [[{ account: ENSV2.owner, roleBitmap: ownerRootRoles }]],
});
const factoryArgs = [ENSV2.userRegistryImpl, salt, initializer];
const proxyLogic = await client.readContract({
  address: ENSV2.factory,
  abi: factoryAbi,
  functionName: 'proxyLogic',
  blockNumber,
});
const outerSalt = keccak256(encodeAbiParameters(
  [{ type: 'address' }, { type: 'uint256' }],
  [ENSV2.owner, salt],
));
const creationCode = concatHex([
  '0x3d604d80600a3d3981f3363d3d373d3d3d363d73',
  proxyLogic,
  '0x5af43d82803e903d91602b57fd5bf3',
  outerSalt,
]);
const childRegistry = getCreate2Address({
  from: ENSV2.factory,
  salt: outerSalt,
  bytecodeHash: keccak256(creationCode),
});
const existingChildCode = await client.getCode({ address: childRegistry, blockNumber });
assert.ok(!existingChildCode || existingChildCode === '0x', 'Predicted child already exists');

const simulation = await client.simulateContract({
  account: ENSV2.owner,
  address: ENSV2.factory,
  abi: factoryAbi,
  functionName: 'deployProxy',
  args: factoryArgs,
  blockNumber,
});
assert.equal(simulation.result.toLowerCase(), childRegistry.toLowerCase(), 'Factory returned a different address');

console.log(JSON.stringify({
  chainId: sepolia.id,
  preflightBlock: blockNumber.toString(),
  owner: ENSV2.owner,
  parentExpiry: new Date(Number(parent.expiry) * 1000).toISOString(),
  predictedChildRegistry: childRegistry,
  ownerInitialRootRoles: {
    bitmap: `0x${ownerRootRoles.toString(16)}`,
    grants: ['ROLE_SET_PARENT', 'ROLE_REGISTRAR_ADMIN', 'ROLE_RENEW_ADMIN'],
    noRegistryUpgradeOrNameOverrideRoles: true,
  },
  steps: [
    {
      action: 'Deploy UserRegistry proxy through ENS VerifiableFactory',
      to: ENSV2.factory,
      valueWei: '0',
      data: encodeFunctionData({ abi: factoryAbi, functionName: 'deployProxy', args: factoryArgs }),
      expected: `Factory.verifyContract(${childRegistry}) returns ${ENSV2.userRegistryImpl}`,
    },
    {
      action: 'Set the new registry canonical parent',
      to: childRegistry,
      valueWei: '0',
      data: encodeFunctionData({
        abi: registryAbi,
        functionName: 'setParent',
        args: [ENSV2.ethRegistry, 'sodera'],
      }),
      expected: `getParent() returns (${ENSV2.ethRegistry}, sodera)`,
    },
    {
      action: 'Mount the registry beneath sodera.eth',
      to: ENSV2.ethRegistry,
      valueWei: '0',
      data: encodeFunctionData({
        abi: registryAbi,
        functionName: 'setSubregistry',
        args: [labelhash, childRegistry],
      }),
      expected: `getSubregistry(sodera) returns ${childRegistry}`,
    },
  ],
}, null, 2));
