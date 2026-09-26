import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  http,
  isHex,
  keccak256,
  parseAbi,
  stringToHex,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import type { ClaimRecord } from '../ens/claim-store.ts';
import { ENSV2, factoryAbi, registrationAbi, registryAbi, resolverAbi } from '../ens/contracts.ts';
import { readKernelPasskeyKey } from '../ens/kernel-proof.ts';
import { verifyPasskeyProof } from '../ens/webauthn-proof.ts';
import type { StoredClaimProof } from './postgres-work-queue.ts';
import { RESOLVER_OWNER_ROLES, registrationCall, resolverAddressCall, resolverDeployment } from './ens-calls.ts';

const addressAbi = parseAbi(['function addr(bytes32 node) view returns (address)']);
const ONE_YEAR = 365n * 24n * 60n * 60n;

export function createIssuerChain(rpcUrl: string, secret: string) {
  const key = /^[0-9a-fA-F]{64}$/.test(secret) ? `0x${secret}` : secret;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key) || !isHex(key)) {
    throw new Error('ENS_ISSUER_PRIVATE_KEY must be a 32-byte hex key');
  }
  const issuer = privateKeyToAccount(key as Hex);
  if (issuer.address.toLowerCase() !== ENSV2.issuer.toLowerCase()) {
    throw new Error('ENS issuer key does not match the approved public address');
  }
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const wallet = createWalletClient({ chain: sepolia, transport: http(rpcUrl), account: issuer });

  return {
    issuer: issuer.address,
    async verifyClaimProof(claim: ClaimRecord, proof: StoredClaimProof) {
      const key = await readKernelPasskeyKey(publicClient, claim.account);
      verifyPasskeyProof(proof.assertion, proof.challenge, key);
    },
    async namespace(claim: ClaimRecord) {
      if (claim.chainId !== sepolia.id || claim.registry.toLowerCase() !== ENSV2.child.toLowerCase()) {
        throw new Error('Claim uses a different ENS deployment');
      }
      if (await publicClient.getChainId() !== sepolia.id) throw new Error('Issuer RPC is not Sepolia');
      const blockNumber = await publicClient.getBlockNumber();
      const [eth, parent, child, implementation, canonicalParent, nameState, resolver, issuerRoles] = await Promise.all([
        publicClient.readContract({ address: ENSV2.root, abi: registryAbi, functionName: 'getSubregistry', args: ['eth'], blockNumber }),
        publicClient.readContract({ address: ENSV2.eth, abi: registryAbi, functionName: 'getState', args: [BigInt(keccak256(stringToHex('sodera')))], blockNumber }),
        publicClient.readContract({ address: ENSV2.eth, abi: registryAbi, functionName: 'getSubregistry', args: ['sodera'], blockNumber }),
        publicClient.readContract({ address: ENSV2.factory, abi: factoryAbi, functionName: 'verifyContract', args: [ENSV2.child], blockNumber }),
        publicClient.readContract({ address: ENSV2.child, abi: registryAbi, functionName: 'getParent', blockNumber }),
        publicClient.readContract({ address: ENSV2.child, abi: registryAbi, functionName: 'getState', args: [BigInt(claim.labelhash)], blockNumber }),
        publicClient.readContract({ address: ENSV2.child, abi: registrationAbi, functionName: 'getResolver', args: [claim.label], blockNumber }),
        publicClient.readContract({ address: ENSV2.child, abi: registryAbi, functionName: 'roles', args: [0n, issuer.address], blockNumber }),
      ]);
      if (eth.toLowerCase() !== ENSV2.eth.toLowerCase() || parent.status !== 2 ||
        parent.latestOwner.toLowerCase() !== ENSV2.parentOwner.toLowerCase() ||
        Number(parent.expiry) <= Date.now() / 1000 || child.toLowerCase() !== ENSV2.child.toLowerCase() ||
        implementation.toLowerCase() !== ENSV2.implementation.toLowerCase() ||
        canonicalParent[0].toLowerCase() !== ENSV2.eth.toLowerCase() || canonicalParent[1] !== 'sodera') {
        throw new Error('Canonical ENS namespace changed');
      }
      return { parentExpiry: parent.expiry, name: nameState, resolver, issuerRoles };
    },
    async resolver(claim: ClaimRecord) {
      const logic = await publicClient.readContract({ address: ENSV2.factory, abi: factoryAbi, functionName: 'proxyLogic' });
      return resolverDeployment({ account: claim.account, name: claim.name, issuer: issuer.address, proxyLogic: logic });
    },
    async resolverReady(claim: ClaimRecord, resolver: Address) {
      const code = await publicClient.getCode({ address: resolver });
      if (!code || code === '0x') return false;
      const [implementation, roles, counts, profile] = await Promise.all([
        publicClient.readContract({ address: ENSV2.factory, abi: factoryAbi, functionName: 'verifyContract', args: [resolver] }),
        publicClient.readContract({ address: resolver, abi: resolverAbi, functionName: 'roles', args: [0n, claim.account] }),
        publicClient.readContract({ address: resolver, abi: resolverAbi, functionName: 'roleCount', args: [0n] }),
        (async () => {
          const { name, profile } = resolverAddressCall(claim.name);
          return publicClient.readContract({ address: resolver, abi: resolverAbi, functionName: 'resolve', args: [name, profile] });
        })(),
      ]);
      const record = decodeFunctionResult({ abi: addressAbi, functionName: 'addr', data: profile });
      if (implementation.toLowerCase() !== ENSV2.resolverImplementation.toLowerCase() ||
        roles !== RESOLVER_OWNER_ROLES || counts !== RESOLVER_OWNER_ROLES ||
        record.toLowerCase() !== claim.account.toLowerCase()) {
        throw new Error('Deployed resolver authority or ETH record does not match its Kernel');
      }
      return true;
    },
    async pendingNonce() {
      const [latest, pending] = await Promise.all([
        publicClient.getTransactionCount({ address: issuer.address, blockTag: 'latest' }),
        publicClient.getTransactionCount({ address: issuer.address, blockTag: 'pending' }),
      ]);
      return pending > latest;
    },
    async receipt(hash: Hash) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        return receipt.status;
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return 'pending' as const;
        throw error;
      }
    },
    async deployResolver(data: Hex) {
      return wallet.sendTransaction({ to: ENSV2.factory, data, value: 0n });
    },
    async register(claim: ClaimRecord, resolver: Address, parentExpiry: bigint) {
      const expiry = BigInt(Math.floor(Date.now() / 1000)) + ONE_YEAR;
      if (expiry >= parentExpiry) throw new Error('Parent expiry is too soon for a one-year subname');
      const { to, data } = registrationCall({ label: claim.label, account: claim.account, resolver, expiry });
      return wallet.sendTransaction({ to, data, value: 0n });
    },
    async confirmed(claim: ClaimRecord, resolver: Address) {
      const name = await this.namespace(claim);
      if (name.name.status !== 2) return null;
      if (name.name.latestOwner.toLowerCase() !== claim.account.toLowerCase() ||
        name.resolver.toLowerCase() !== resolver.toLowerCase()) {
        throw new Error('Name was registered to a different owner or resolver');
      }
      const resolved = await publicClient.getEnsAddress({ name: claim.name });
      if (!resolved || resolved === zeroAddress || resolved.toLowerCase() !== claim.account.toLowerCase()) {
        throw new Error('Universal Resolver does not resolve this name to its Kernel');
      }
      return new Date(Number(name.name.expiry) * 1000);
    },
  };
}

export type IssuerChain = ReturnType<typeof createIssuerChain>;
