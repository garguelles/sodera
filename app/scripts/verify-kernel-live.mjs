import assert from 'node:assert/strict';

import {
  KernelV3_3AccountAbi,
  createKernelAccount,
  createZeroDevPaymasterClient,
} from '@zerodev/sdk';
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
import { concatHex, createPublicClient, encodeFunctionData, http, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { createBundlerClient } from 'viem/account-abstraction';

import {
  SYNTHETIC_CREDENTIAL_LABEL,
  SYNTHETIC_PUBLIC_KEY,
  createSyntheticAssertion,
  rawHashFromMessage,
  syntheticWebAuthnKey,
} from './lib/synthetic-webauthn-test-credential.mjs';

if (!process.env.SEPOLIA_RPC_URL || !process.env.ZERODEV_SEPOLIA_BUNDLER_RPC) {
  throw new Error('SEPOLIA_RPC_URL and ZERODEV_SEPOLIA_BUNDLER_RPC are required');
}

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});
const chainId = await publicClient.getChainId();
assert.equal(chainId, sepolia.id);
const bundlerChainResponse = await fetch(process.env.ZERODEV_SEPOLIA_BUNDLER_RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
});
const bundlerChainPayload = await bundlerChainResponse.json();
if (!bundlerChainResponse.ok || bundlerChainPayload.error) {
  throw new Error(`ZeroDev chain check failed with HTTP ${bundlerChainResponse.status}`);
}
assert.equal(BigInt(bundlerChainPayload.result), BigInt(sepolia.id));
const entryPoint = getEntryPoint('0.7');
let assertion;
let signedUserOperationHash;
const evidenceWebAuthnKey = {
  ...syntheticWebAuthnKey,
  async signMessageCallback(message, rpId, chainId) {
    signedUserOperationHash = rawHashFromMessage(message);
    assertion = createSyntheticAssertion(signedUserOperationHash, { rpId, chainId });
    return assertion.signature;
  },
};
const validator = await toPasskeyValidator(publicClient, {
  webAuthnKey: evidenceWebAuthnKey,
  entryPoint,
  kernelVersion: KERNEL_V3_3,
  validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED,
});
const account = await createKernelAccount(publicClient, {
  entryPoint,
  kernelVersion: KERNEL_V3_3,
  plugins: { sudo: validator },
  useMetaFactory: false,
  index: 0n,
});
const accountAddress = account.address;
const [{ factory, factoryData }, balance, deployed] = await Promise.all([
  account.getFactoryArgs(),
  publicClient.getBalance({ address: accountAddress }),
  account.isDeployed(),
]);
const initCode = factory && factoryData ? concatHex([factory, factoryData]) : '0x';

if (!deployed) {
  assert.equal(factory, KernelVersionToAddressesMap[KERNEL_V3_3].factoryAddress);
}
assert.equal(validator.address, '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69');

const accountState = {
  credentialLabel: SYNTHETIC_CREDENTIAL_LABEL,
  chainId,
  accountAddress,
  deployed,
  balanceWei: balance.toString(),
  factory,
  factoryData,
  initCode,
  validatorAddress: validator.address,
  publicKey: {
    x: `0x${SYNTHETIC_PUBLIC_KEY.x.toString(16)}`,
    y: `0x${SYNTHETIC_PUBLIC_KEY.y.toString(16)}`,
  },
};
const stringify = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), 2);

function isContractRevert(error) {
  let current = error;
  while (current) {
    const message = [current.name, current.shortMessage, current.message].filter(Boolean).join(' ');
    if (/revert/i.test(message)) return true;
    current = current.cause;
  }
  return false;
}

async function assertContractRevert(action) {
  try {
    await action();
  } catch (error) {
    assert.equal(isContractRevert(error), true);
    return true;
  }
  assert.fail('Expected contract call to revert');
}

const paymasterClient = createZeroDevPaymasterClient({
  chain: sepolia,
  transport: http(process.env.ZERODEV_SEPOLIA_BUNDLER_RPC),
});
const bundlerClient = createBundlerClient({
  account,
  chain: sepolia,
  client: publicClient,
  paymaster: {
    getPaymasterStubData: (userOperation) =>
      paymasterClient.sponsorUserOperation({ userOperation, shouldConsume: false }),
    getPaymasterData: (userOperation) =>
      paymasterClient.sponsorUserOperation({
        userOperation,
        shouldConsume: process.env.SUBMIT_SYNTHETIC_USER_OPERATION === '1',
      }),
  },
  transport: http(process.env.ZERODEV_SEPOLIA_BUNDLER_RPC),
  userOperation: {
    async estimateFeesPerGas() {
      const prices = await bundlerClient.request({
        method: 'pimlico_getUserOperationGasPrice',
        params: [],
      });
      return {
        maxFeePerGas: BigInt(prices.fast.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(prices.fast.maxPriorityFeePerGas),
      };
    },
  },
});

let draft;
let gas;
try {
  draft = await bundlerClient.prepareUserOperation({
    calls: [{ to: zeroAddress, value: 0n, data: '0x' }],
  });
  gas = {
    callGasLimit: draft.callGasLimit,
    preVerificationGas: draft.preVerificationGas,
    verificationGasLimit: draft.verificationGasLimit,
    paymasterPostOpGasLimit: draft.paymasterPostOpGasLimit,
    paymasterVerificationGasLimit: draft.paymasterVerificationGasLimit,
  };
} catch (error) {
  console.log(
    stringify(
      {
        ...accountState,
        estimation: {
          passed: false,
          errorName: error?.name ?? 'Error',
          error: error?.shortMessage ?? 'Bundler estimation failed',
        },
        nextAction: 'Verify the ZeroDev Sepolia sponsorship policy and rerun',
      },
    ),
  );
  process.exitCode = 2;
}

if (draft && gas) {
  const unsigned = { ...draft, ...gas, signature: '0x' };
  const signature = await account.signUserOperation(unsigned);
  const signed = { ...unsigned, signature };
  const estimatedPrefund =
    (gas.callGasLimit + gas.verificationGasLimit + gas.preVerificationGas) *
    unsigned.maxFeePerGas;

  if (process.env.SUBMIT_SYNTHETIC_USER_OPERATION !== '1') {
    console.log(
      stringify(
        {
          ...accountState,
          estimation: {
            passed: true,
            sponsored: Boolean(draft.paymaster),
            gas: Object.fromEntries(
              Object.entries(gas).map(([name, value]) => [name, value?.toString()]),
            ),
            estimatedPrefundWei: estimatedPrefund.toString(),
          },
          signatureBytes: (signature.length - 2) / 2,
          nextAction: 'Set SUBMIT_SYNTHETIC_USER_OPERATION=1 to submit this test operation',
        },
      ),
    );
  } else {
    let userOperationHash;
    let receipt;
    try {
      userOperationHash = await bundlerClient.sendUserOperation(signed);
      receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOperationHash });
    } catch (error) {
      console.log(
        stringify(
          {
            ...accountState,
            submission: {
              passed: false,
              errorName: error?.name ?? 'Error',
              error: error?.shortMessage ?? 'UserOperation submission failed',
            },
          },
        ),
      );
      process.exitCode = 3;
      process.exit();
    }
    assert.equal(receipt.success, true);
    assert(assertion);
    assert(signedUserOperationHash);
    assert.equal(userOperationHash, signedUserOperationHash);
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
    ];
    const [rootValidator, moduleInstalled, validatorInitialized, storedPublicKey, implementation] =
      await Promise.all([
        publicClient.readContract({
          address: accountAddress,
          abi: KernelV3_3AccountAbi,
          functionName: 'rootValidator',
        }),
        publicClient.readContract({
          address: accountAddress,
          abi: KernelV3_3AccountAbi,
          functionName: 'isModuleInstalled',
          args: [1n, validator.address, '0x'],
        }),
        publicClient.readContract({
          address: validator.address,
          abi: validatorAbi,
          functionName: 'isInitialized',
          args: [accountAddress],
        }),
        publicClient.readContract({
          address: validator.address,
          abi: validatorAbi,
          functionName: 'webAuthnValidatorStorage',
          args: [accountAddress],
        }),
        publicClient.getStorageAt({
          address: accountAddress,
          slot: KERNEL_IMPLEMENTATION_SLOT,
        }),
      ]);
    const expectedRoot = concatHex(['0x01', validator.address]);
    assert.equal(rootValidator.toLowerCase(), expectedRoot.toLowerCase());
    assert.equal(moduleInstalled, true);
    assert.equal(validatorInitialized, true);
    assert.deepEqual(storedPublicKey, [SYNTHETIC_PUBLIC_KEY.x, SYNTHETIC_PUBLIC_KEY.y]);
    assert.equal(
      `0x${implementation.slice(-40)}`.toLowerCase(),
      KernelVersionToAddressesMap[KERNEL_V3_3].accountImplementationAddress.toLowerCase(),
    );

    let replayRejected = false;
    let replayReason;
    try {
      await bundlerClient.sendUserOperation(signed);
    } catch (error) {
      const message = [error?.shortMessage, error?.details, error?.message]
        .filter(Boolean)
        .join(' ');
      replayRejected = message.includes('AA25 invalid account nonce');
      replayReason = replayRejected ? 'AA25 invalid account nonce' : 'Unexpected replay rejection';
    }
    assert.equal(replayRejected, true);

    const unauthorizedRootChangeRejected = await assertContractRevert(() =>
      publicClient.call({
        account: '0x0000000000000000000000000000000000001841',
        to: accountAddress,
        data: encodeFunctionData({
          abi: KernelV3_3AccountAbi,
          functionName: 'changeRootValidator',
          args: [expectedRoot, zeroAddress, '0x', '0x'],
        }),
      }),
    );

    const unauthorizedInstallRejected = await assertContractRevert(() =>
      publicClient.call({
        account: '0x0000000000000000000000000000000000001841',
        to: accountAddress,
        data: encodeFunctionData({
          abi: KernelV3_3AccountAbi,
          functionName: 'installModule',
          args: [1n, '0x0000000000000000000000000000000000001842', '0x'],
        }),
      }),
    );

    const unauthorizedUninstallRejected = await assertContractRevert(() =>
      publicClient.call({
        account: '0x0000000000000000000000000000000000001841',
        to: accountAddress,
        data: encodeFunctionData({
          abi: KernelV3_3AccountAbi,
          functionName: 'uninstallModule',
          args: [1n, validator.address, '0x'],
        }),
      }),
    );

    console.log(
      stringify(
        {
          ...accountState,
          evidence: {
            unsignedUserOperation: unsigned,
            expectedUserOperationHash: signedUserOperationHash,
            challenge: assertion.challenge,
            authenticatorIdHash: syntheticWebAuthnKey.authenticatorIdHash,
            authenticatorData: `0x${Buffer.from(assertion.authenticatorData).toString('hex')}`,
            clientDataJSON: assertion.clientDataJSON,
            responseTypeLocation: assertion.responseTypeLocation,
            derSignature: assertion.der,
            normalizedSignature: {
              r: `0x${assertion.r.toString(16)}`,
              s: `0x${assertion.s.toString(16)}`,
            },
            assertionDigest: assertion.digest,
            finalAssertionAbi: assertion.signature,
            finalAccountSignature: signature,
            estimation: gas,
            userOperationHash,
            receipt,
          },
          accountChecks: {
            rootValidator,
            moduleInstalled,
            validatorInitialized,
            storedPublicKey: storedPublicKey.map((value) => `0x${value.toString(16)}`),
            implementation,
          },
          negativeChecks: {
            replayRejected,
            replayReason,
            unauthorizedRootChangeRejected,
            unauthorizedInstallRejected,
            unauthorizedUninstallRejected,
          },
        },
      ),
    );
  }
}
