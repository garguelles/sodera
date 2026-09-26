import { createPublicClient, decodeFunctionData, getAddress, http, isAddress } from 'viem';
import { sepolia } from 'viem/chains';

import { ENSV2, factoryAbi } from '../ens/contracts.ts';
import { resolverDeployment } from './ens-calls.ts';

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const input = process.env.ENS_DRY_RUN_ACCOUNT;
if (!rpcUrl || !input || !isAddress(input)) {
  throw new Error('SEPOLIA_RPC_URL and ENS_DRY_RUN_ACCOUNT are required');
}
const account = getAddress(input);
const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
if (await client.getChainId() !== sepolia.id) throw new Error('Expected Ethereum Sepolia');
const proxyLogic = await client.readContract({
  address: ENSV2.factory, abi: factoryAbi, functionName: 'proxyLogic',
});
const deployment = resolverDeployment({
  account, name: 'proofcheck.sodera.eth', issuer: ENSV2.issuer, proxyLogic,
});
const call = decodeFunctionData({ abi: factoryAbi, data: deployment.data });
if (call.functionName !== 'deployProxy') throw new Error('Resolver factory calldata mismatch');
const simulation = await client.simulateContract({
  address: ENSV2.factory, account: ENSV2.issuer, abi: factoryAbi,
  functionName: 'deployProxy', args: call.args,
});
const matches = simulation.result.toLowerCase() === deployment.resolver.toLowerCase();
console.log(JSON.stringify({ chainId: sepolia.id, issuer: ENSV2.issuer,
  predictedResolver: deployment.resolver, simulatedResolver: simulation.result,
  matches, transactionSent: false }, null, 2));
if (!matches) throw new Error('Factory predicted a different resolver address');
