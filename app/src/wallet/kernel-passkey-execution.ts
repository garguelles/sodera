import { createKernelAccount } from '@zerodev/sdk/accounts';
import { createZeroDevPaymasterClient } from '@zerodev/sdk/clients';
import {
  KERNEL_IMPLEMENTATION_SLOT,
  KERNEL_V3_3,
  KernelVersionToAddressesMap,
  getEntryPoint,
} from '@zerodev/sdk/constants';
import {
  PasskeyValidatorContractVersion,
  toPasskeyValidator,
} from '@zerodev/passkey-validator';
import {
  concatHex,
  createPublicClient,
  http,
  sha256,
  toBytes,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { createBundlerClient, type UserOperation } from 'viem/account-abstraction';

import {
  createPasskeyChallenge,
  ENTRY_POINT_V0_7_ADDRESS,
  SEPOLIA_CHAIN_ID,
} from './kernel-webauthn';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from './passkey-ceremony';
import {
  createPrimaryPasskeyWebAuthnKey,
  type PrimaryPasskeyAssertionEvidence,
} from './primary-passkey-webauthn-key';

const VALIDATOR_ADDRESS = '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69';
const PROOF_CALL = Object.freeze({ to: zeroAddress, value: 0n, data: '0x' as Hex });
const kernelAccountAbi = [
  {
    type: 'function',
    name: 'rootValidator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes21' }],
  },
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [
      { name: 'moduleType', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'additionalContext', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const validatorAbi = [
  {
    type: 'function',
    name: 'isInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'smartAccount', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'webAuthnValidatorStorage',
    stateMutability: 'view',
    inputs: [{ name: 'kernel', type: 'address' }],
    outputs: [
      { name: 'pubKeyX', type: 'uint256' },
      { name: 'pubKeyY', type: 'uint256' },
    ],
  },
] as const;

export type KernelExecutionConfig = {
  executionRpcUrl: string;
  bundlerRpcUrl: string;
};

export type KernelOperationReview = {
  userOperationHash: Hash;
  account: Address;
  chain: 'Ethereum Sepolia';
  chainId: typeof SEPOLIA_CHAIN_ID;
  entryPoint: Address;
  validator: Address;
  deploymentRequired: boolean;
  calls: readonly [{ to: Address; valueWei: '0'; data: Hex }];
  sponsored: boolean;
  paymaster: Address | null;
  maximumNetworkFeeWei: string;
  userOperation: Record<string, string | null>;
};

export type KernelOperationEvidence = {
  userOperationHash: Hash;
  transactionHash: Hash;
  account: Address;
  challenge: string;
  credentialIdHash: Hash;
  authenticatorData: string;
  clientDataJSON: string;
  validatorEnvelope: Hex;
  integration: {
    chainId: typeof SEPOLIA_CHAIN_ID;
    entryPointVersion: '0.7';
    kernelVersion: '0.3.3';
    passkeyValidatorVersion: '0.0.3';
    zeroDevSdkVersion: '5.5.10';
    zeroDevPasskeyValidatorPackageVersion: '5.6.0';
    zeroDevWebAuthnKeyPackageVersion: '5.5.0';
    viemVersion: '2.28.0';
  };
  receipt: {
    success: true;
    actualGasCostWei: string;
    actualGasUsed: string;
  };
  resultingState: {
    nonceBefore: string;
    nonceAfter: string;
    accountDeployed: true;
    outerTransactionStatus: 'success';
    rootValidator: Hex;
    validatorInitialized: true;
    validatorModuleInstalled: true;
    storedPublicKeyX: Hex;
    storedPublicKeyY: Hex;
    kernelImplementation: Address;
    outerReceiptLogCount: number;
  };
};

export type KernelPasskeyExecutionClient = {
  prepare(): Promise<KernelOperationReview>;
  execute(confirmedUserOperationHash: Hash): Promise<KernelOperationEvidence>;
};

export function readKernelExecutionConfig(): KernelExecutionConfig {
  const executionRpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  const bundlerRpcUrl = process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC;
  if (!executionRpcUrl || !bundlerRpcUrl) {
    throw new Error(
      'EXPO_PUBLIC_SEPOLIA_RPC_URL and EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC are required',
    );
  }
  assertKernelExecutionConfig({ executionRpcUrl, bundlerRpcUrl });
  return { executionRpcUrl, bundlerRpcUrl };
}

function assertKernelExecutionConfig({ executionRpcUrl, bundlerRpcUrl }: KernelExecutionConfig) {
  if (executionRpcUrl === bundlerRpcUrl) {
    throw new Error('Execution and ZeroDev Bundler RPC URLs must be configured separately');
  }
  const executionUrl = new URL(executionRpcUrl);
  const bundlerUrl = new URL(bundlerRpcUrl);
  if (executionUrl.protocol !== 'https:' || bundlerUrl.protocol !== 'https:') {
    throw new Error('Kernel execution RPC URLs must use HTTPS');
  }
  if (bundlerUrl.hostname !== 'rpc.zerodev.app') {
    throw new Error('The Bundler must use the verified ZeroDev-hosted endpoint');
  }
}

export async function createKernelPasskeyExecutionClient({
  ceremonyClient,
  credential,
  config = readKernelExecutionConfig(),
}: {
  ceremonyClient: PasskeyCeremonyClient;
  credential: RegisteredPrimaryPasskey;
  config?: KernelExecutionConfig;
}): Promise<KernelPasskeyExecutionClient> {
  assertKernelExecutionConfig(config);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(config.executionRpcUrl),
  });
  const [executionChainId, bundlerChainId, supportedEntryPoints] = await Promise.all([
    publicClient.getChainId(),
    readRpcChainId(config.bundlerRpcUrl),
    readSupportedEntryPoints(config.bundlerRpcUrl),
  ]);
  if (executionChainId !== SEPOLIA_CHAIN_ID || bundlerChainId !== SEPOLIA_CHAIN_ID) {
    throw new Error('Both configured RPC services must identify as Ethereum Sepolia');
  }
  if (!supportedEntryPoints.some((address) => address.toLowerCase() === ENTRY_POINT_V0_7_ADDRESS.toLowerCase())) {
    throw new Error('The ZeroDev Bundler does not advertise the pinned EntryPoint v0.7');
  }

  let assertionEvidence: PrimaryPasskeyAssertionEvidence | undefined;
  const webAuthnKey = createPrimaryPasskeyWebAuthnKey({
    ceremonyClient,
    credential,
    onAssertion: (evidence) => {
      assertionEvidence = evidence;
    },
  });
  const entryPoint = getEntryPoint('0.7');
  if (entryPoint.address !== ENTRY_POINT_V0_7_ADDRESS) {
    throw new Error('The EntryPoint v0.7 address does not match the Sepolia pin');
  }
  const validator = await toPasskeyValidator(publicClient, {
    webAuthnKey,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED,
  });
  if (validator.address !== VALIDATOR_ADDRESS) {
    throw new Error('The released ZeroDev WebAuthn validator address does not match the pin');
  }
  const account = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    factoryAddress: KernelVersionToAddressesMap[KERNEL_V3_3].factoryAddress,
    accountImplementationAddress:
      KernelVersionToAddressesMap[KERNEL_V3_3].accountImplementationAddress,
    plugins: { sudo: validator },
    useMetaFactory: false,
    index: 0n,
  });
  const paymasterClient = createZeroDevPaymasterClient({
    chain: sepolia,
    transport: http(config.bundlerRpcUrl),
  });
  const bundlerClient = createBundlerClient({
    account,
    chain: sepolia,
    client: publicClient,
    paymaster: {
      getPaymasterStubData: (userOperation) =>
        paymasterClient.sponsorUserOperation({ userOperation, shouldConsume: false }),
      getPaymasterData: (userOperation) =>
        paymasterClient.sponsorUserOperation({ userOperation, shouldConsume: true }),
    },
    transport: http(config.bundlerRpcUrl),
    userOperation: {
      estimateFeesPerGas: () => readBundlerGasPrices(config.bundlerRpcUrl),
    },
  });

  let prepared: UserOperation<'0.7'> | undefined;
  let review: KernelOperationReview | undefined;

  return {
    async prepare() {
      const draft = await bundlerClient.prepareUserOperation({ calls: [PROOF_CALL] });
      const operation: UserOperation<'0.7'> = Object.freeze({ ...draft, signature: '0x' });
      prepared = operation;
      const challenge = createPasskeyChallenge(operation);
      const deploymentRequired = !(await account.isDeployed());
      const maximumGas =
        operation.callGasLimit +
        operation.verificationGasLimit +
        operation.preVerificationGas +
        (operation.paymasterVerificationGasLimit ?? 0n) +
        (operation.paymasterPostOpGasLimit ?? 0n);
      const nextReview: KernelOperationReview = Object.freeze({
        userOperationHash: challenge.userOperationHash,
        account: account.address,
        chain: 'Ethereum Sepolia' as const,
        chainId: SEPOLIA_CHAIN_ID,
        entryPoint: entryPoint.address,
        validator: validator.address,
        deploymentRequired,
        calls: [{ to: PROOF_CALL.to, valueWei: '0' as const, data: PROOF_CALL.data }] as const,
        sponsored: Boolean(operation.paymaster),
        paymaster: operation.paymaster ?? null,
        maximumNetworkFeeWei: (maximumGas * operation.maxFeePerGas).toString(),
        userOperation: publicUserOperation(operation),
      });
      review = nextReview;
      return nextReview;
    },
    async execute(confirmedUserOperationHash) {
      if (!prepared || !review) throw new Error('Prepare and review an operation before execution');
      if (review.userOperationHash !== confirmedUserOperationHash) {
        throw new Error('The confirmed operation no longer matches the prepared UserOperation');
      }
      if (createPasskeyChallenge(prepared).userOperationHash !== confirmedUserOperationHash) {
        throw new Error('The prepared UserOperation changed after review');
      }

      const operation = prepared;
      const nonceBefore = operation.nonce;
      prepared = undefined;
      review = undefined;
      assertionEvidence = undefined;
      const signature = await account.signUserOperation(operation);
      const signedAssertion = assertionEvidence as PrimaryPasskeyAssertionEvidence | undefined;
      if (!signedAssertion || signedAssertion.userOperationHash !== confirmedUserOperationHash) {
        throw new Error('Primary Passkey signed a different UserOperation hash');
      }
      const signed = { ...operation, signature };
      const userOperationHash = await bundlerClient.sendUserOperation(signed);
      if (userOperationHash !== confirmedUserOperationHash) {
        throw new Error('ZeroDev returned a different UserOperation hash');
      }
      const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOperationHash });
      if (!receipt.success) {
        throw new Error(receipt.reason ?? 'The UserOperation failed validation or execution');
      }

      const outerReceipt = await publicClient.getTransactionReceipt({
        hash: receipt.receipt.transactionHash,
      });
      if (outerReceipt.status !== 'success') {
        throw new Error('The independently fetched outer transaction failed');
      }
      const nonceAfter = await account.getNonce();
      if (nonceAfter <= nonceBefore) throw new Error('The account nonce did not advance');

      const [code, rootValidator, moduleInstalled, validatorInitialized, storedPublicKey, implementation] =
        await Promise.all([
          publicClient.getCode({ address: account.address }),
          publicClient.readContract({
            address: account.address,
            abi: kernelAccountAbi,
            functionName: 'rootValidator',
          }),
          publicClient.readContract({
            address: account.address,
            abi: kernelAccountAbi,
            functionName: 'isModuleInstalled',
            args: [1n, validator.address, '0x'],
          }),
          publicClient.readContract({
            address: validator.address,
            abi: validatorAbi,
            functionName: 'isInitialized',
            args: [account.address],
          }),
          publicClient.readContract({
            address: validator.address,
            abi: validatorAbi,
            functionName: 'webAuthnValidatorStorage',
            args: [account.address],
          }),
          publicClient.getStorageAt({
            address: account.address,
            slot: KERNEL_IMPLEMENTATION_SLOT,
          }),
        ]);
      if (!code || code === '0x') throw new Error('The counterfactual Kernel account was not deployed');
      const expectedRoot = concatHex(['0x01', validator.address]);
      if (rootValidator.toLowerCase() !== expectedRoot.toLowerCase()) {
        throw new Error('The deployed Kernel root validator does not match the Primary Passkey');
      }
      if (!moduleInstalled || !validatorInitialized) {
        throw new Error('The released WebAuthn validator is not initialized as the account root');
      }
      if (
        storedPublicKey[0] !== BigInt(credential.publicKeyX) ||
        storedPublicKey[1] !== BigInt(credential.publicKeyY)
      ) {
        throw new Error('The deployed validator public key does not match the Primary Passkey');
      }
      if (!implementation) throw new Error('The deployed Kernel implementation slot is empty');
      const implementationAddress = `0x${implementation.slice(-40)}` as Address;
      const expectedImplementation =
        KernelVersionToAddressesMap[KERNEL_V3_3].accountImplementationAddress;
      if (implementationAddress.toLowerCase() !== expectedImplementation.toLowerCase()) {
        throw new Error('The deployed Kernel implementation does not match the pin');
      }

      return {
        userOperationHash,
        transactionHash: outerReceipt.transactionHash,
        account: account.address,
        challenge: signedAssertion.challenge,
        credentialIdHash: sha256(toBytes(credential.id)),
        authenticatorData: signedAssertion.authenticatorData,
        clientDataJSON: signedAssertion.clientDataJSON,
        validatorEnvelope: signedAssertion.validatorEnvelope,
        integration: {
          chainId: SEPOLIA_CHAIN_ID,
          entryPointVersion: '0.7',
          kernelVersion: '0.3.3',
          passkeyValidatorVersion: '0.0.3',
          zeroDevSdkVersion: '5.5.10',
          zeroDevPasskeyValidatorPackageVersion: '5.6.0',
          zeroDevWebAuthnKeyPackageVersion: '5.5.0',
          viemVersion: '2.28.0',
        },
        receipt: {
          success: true,
          actualGasCostWei: receipt.actualGasCost.toString(),
          actualGasUsed: receipt.actualGasUsed.toString(),
        },
        resultingState: {
          nonceBefore: nonceBefore.toString(),
          nonceAfter: nonceAfter.toString(),
          accountDeployed: true,
          outerTransactionStatus: 'success',
          rootValidator,
          validatorInitialized: true,
          validatorModuleInstalled: true,
          storedPublicKeyX: `0x${storedPublicKey[0].toString(16).padStart(64, '0')}`,
          storedPublicKeyY: `0x${storedPublicKey[1].toString(16).padStart(64, '0')}`,
          kernelImplementation: implementationAddress,
          outerReceiptLogCount: outerReceipt.logs.length,
        },
      };
    },
  };
}

function publicUserOperation(operation: UserOperation<'0.7'>) {
  return {
    sender: operation.sender,
    nonce: operation.nonce.toString(),
    factory: operation.factory ?? null,
    factoryData: operation.factoryData ?? null,
    callData: operation.callData,
    callGasLimit: operation.callGasLimit.toString(),
    verificationGasLimit: operation.verificationGasLimit.toString(),
    preVerificationGas: operation.preVerificationGas.toString(),
    maxFeePerGas: operation.maxFeePerGas.toString(),
    maxPriorityFeePerGas: operation.maxPriorityFeePerGas.toString(),
    paymaster: operation.paymaster ?? null,
    paymasterVerificationGasLimit: operation.paymasterVerificationGasLimit?.toString() ?? null,
    paymasterPostOpGasLimit: operation.paymasterPostOpGasLimit?.toString() ?? null,
    paymasterData: operation.paymasterData ?? null,
  };
}

async function readRpcChainId(rpcUrl: string) {
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
  } catch {
    throw new Error('ZeroDev Bundler chain check could not reach the configured service');
  }
  const payload = (await response.json()) as { result?: Hex; error?: unknown };
  if (!response.ok || payload.error || !payload.result) {
    throw new Error(`ZeroDev Bundler chain check failed with HTTP ${response.status}`);
  }
  return Number(BigInt(payload.result));
}

async function readSupportedEntryPoints(rpcUrl: string) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_supportedEntryPoints',
      params: [],
    }),
  });
  const payload = (await response.json()) as { result?: Address[]; error?: unknown };
  if (!response.ok || payload.error || !payload.result) {
    throw new Error(`ZeroDev EntryPoint check failed with HTTP ${response.status}`);
  }
  return payload.result;
}

async function readBundlerGasPrices(rpcUrl: string) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'pimlico_getUserOperationGasPrice',
      params: [],
    }),
  });
  const payload = (await response.json()) as {
    result?: { fast?: { maxFeePerGas?: Hex; maxPriorityFeePerGas?: Hex } };
    error?: unknown;
  };
  const fast = payload.result?.fast;
  if (!response.ok || payload.error || !fast?.maxFeePerGas || !fast.maxPriorityFeePerGas) {
    throw new Error(`ZeroDev gas price request failed with HTTP ${response.status}`);
  }
  return {
    maxFeePerGas: BigInt(fast.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(fast.maxPriorityFeePerGas),
  };
}
