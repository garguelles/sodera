import {
  PasskeyValidatorContractVersion,
  getValidatorAddress,
} from '@zerodev/passkey-validator';
import { getEntryPoint, KERNEL_V3_3, KernelVersionToAddressesMap } from '@zerodev/sdk/constants';
import { createPublicClient, http, keccak256 } from 'viem';
import { sepolia } from 'viem/chains';

const entryPoint = getEntryPoint('0.7');
const kernel = KernelVersionToAddressesMap[KERNEL_V3_3];
const validator = getValidatorAddress(
  entryPoint,
  KERNEL_V3_3,
  PasskeyValidatorContractVersion.V0_0_3_PATCHED,
);
if (!process.env.SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL is required');
}
const deployments = [
  {
    name: 'EntryPoint 0.7',
    address: entryPoint.address,
    expectedCodeHash: '0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58',
  },
  {
    name: 'KernelFactory 0.3.3',
    address: kernel.factoryAddress,
    expectedCodeHash: '0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a',
  },
  {
    name: 'Kernel implementation 0.3.3',
    address: kernel.accountImplementationAddress,
    expectedCodeHash: '0x1cacd781072bcb657a6306afd074049f35d0a9d7f50eccda9b12bdd00c636995',
  },
  {
    name: 'WebAuthn validator 0.0.3',
    address: validator,
    expectedCodeHash: '0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea',
  },
];

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const chainId = await publicClient.getChainId();
if (chainId !== sepolia.id) {
  throw new Error(`Expected Sepolia chain ID ${sepolia.id}, received ${chainId}`);
}

const deploymentResults = await Promise.all(
  deployments.map(async ({ name, address, expectedCodeHash }) => {
    const bytecode = await publicClient.getCode({ address });
    if (!bytecode || bytecode === '0x') {
      throw new Error(`${name} has no deployed bytecode at ${address}`);
    }

    const codeHash = keccak256(bytecode);
    if (codeHash !== expectedCodeHash) {
      throw new Error(`${name} code hash mismatch: expected ${expectedCodeHash}, received ${codeHash}`);
    }

    return { name, address, codeHash };
  }),
);

let bundler = { checked: false, supportsEntryPointV07: null };
if (process.env.ZERODEV_SEPOLIA_BUNDLER_RPC) {
  const request = async (method) => {
    const response = await fetch(process.env.ZERODEV_SEPOLIA_BUNDLER_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(`ZeroDev ${method} failed: ${payload.error?.message || response.status}`);
    }
    return payload.result;
  };
  const [bundlerChainId, supportedEntryPoints] = await Promise.all([
    request('eth_chainId'),
    request('eth_supportedEntryPoints'),
  ]);

  if (BigInt(bundlerChainId) !== BigInt(sepolia.id)) {
    throw new Error(`Expected ZeroDev Sepolia chain ID ${sepolia.id}, received ${bundlerChainId}`);
  }
  if (!Array.isArray(supportedEntryPoints)) throw new Error('Invalid ZeroDev EntryPoint response');

  const supportsEntryPointV07 = supportedEntryPoints.some(
    (address) => address.toLowerCase() === entryPoint.address.toLowerCase(),
  );
  if (!supportsEntryPointV07) {
    throw new Error(`ZeroDev bundler does not advertise EntryPoint 0.7 at ${entryPoint.address}`);
  }

  bundler = { checked: true, chainId: Number(BigInt(bundlerChainId)), supportsEntryPointV07 };
}

console.log(
  JSON.stringify(
    {
      chainId,
      deployments: deploymentResults,
      bundler,
    },
    null,
    2,
  ),
);
