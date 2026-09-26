import assert from 'node:assert/strict';

import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';

import { ENSV2, factoryAbi, registryAbi } from './lib/ensv2-sepolia.mjs';

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const suppliedIssuer = process.env.ENS_ISSUER_ADDRESS;
if (!rpcUrl || !suppliedIssuer || !isAddress(suppliedIssuer)) {
  throw new Error('SEPOLIA_RPC_URL and ENS_ISSUER_ADDRESS are required');
}
const issuer = getAddress(suppliedIssuer);
assert.notEqual(issuer, zeroAddress);
assert.notEqual(issuer.toLowerCase(), ENSV2.owner.toLowerCase());

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
assert.equal(await client.getChainId(), sepolia.id);
const blockNumber = await client.getBlockNumber();
const [mounted, implementation, ownerRoles, issuerRoles, issuerCode] = await Promise.all([
  client.readContract({ address: ENSV2.ethRegistry, abi: registryAbi, functionName: 'getSubregistry', args: ['sodera'], blockNumber }),
  client.readContract({ address: ENSV2.factory, abi: factoryAbi, functionName: 'verifyContract', args: [ENSV2.childRegistry], blockNumber }),
  client.readContract({ address: ENSV2.childRegistry, abi: registryAbi, functionName: 'roles', args: [0n, ENSV2.owner], blockNumber }),
  client.readContract({ address: ENSV2.childRegistry, abi: registryAbi, functionName: 'roles', args: [0n, issuer], blockNumber }),
  client.getCode({ address: issuer, blockNumber }),
]);
assert.equal(mounted.toLowerCase(), ENSV2.childRegistry.toLowerCase(), 'Mounted namespace changed');
assert.equal(implementation.toLowerCase(), ENSV2.userRegistryImpl.toLowerCase(), 'Child implementation changed');
assert.ok((ownerRoles & (1n << 128n)) !== 0n, 'Parent owner cannot grant ROLE_REGISTRAR');
assert.equal(issuerRoles, 0n, 'Issuer already has root roles; inspect before granting');
assert.ok(!issuerCode || issuerCode === '0x', 'Issuer must be an externally owned account');

const simulation = await client.simulateContract({
  account: ENSV2.owner,
  address: ENSV2.childRegistry,
  abi: registryAbi,
  functionName: 'grantRootRoles',
  args: [1n, issuer],
  blockNumber,
});
assert.equal(simulation.result, true);
console.log(JSON.stringify({
  chainId: sepolia.id,
  preflightBlock: blockNumber.toString(),
  owner: ENSV2.owner,
  issuer,
  currentIssuerRoles: `0x${issuerRoles.toString(16)}`,
  requestedRole: 'ROLE_REGISTRAR only',
  to: ENSV2.childRegistry,
  valueWei: '0',
  data: encodeFunctionData({ abi: registryAbi, functionName: 'grantRootRoles', args: [1n, issuer] }),
  expectedAfterSigning: 'roles(ROOT_RESOURCE, issuer) == 0x1',
  simulated: true,
  transactionSent: false,
}, null, 2));
