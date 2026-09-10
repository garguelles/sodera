import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PasskeyProofScreen } from './passkey-proof-screen';
import type {
  KernelOperationEvidence,
  KernelOperationReview,
  KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/wallet/passkey-native-adapter', () => ({
  passkeyNativeAdapter: {
    createCredential: jest.fn(),
    getCredential: jest.fn(),
    cancel: jest.fn(),
  },
}));

const credential: RegisteredPrimaryPasskey = {
  id: 'MDEyMzQ1Njc4OQ',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:test',
  authenticatorAttachment: 'platform',
};
const operationHash = `0x${'33'.repeat(32)}` as const;
const account = '0x1111111111111111111111111111111111111111' as const;
const review: KernelOperationReview = {
  userOperationHash: operationHash,
  account,
  chain: 'Ethereum Sepolia',
  chainId: 11155111,
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  validator: '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69',
  deploymentRequired: true,
  calls: [{ to: '0x0000000000000000000000000000000000000000', valueWei: '0', data: '0x' }],
  sponsored: true,
  paymaster: '0x2222222222222222222222222222222222222222',
  maximumNetworkFeeWei: '1000',
  userOperation: { sender: account, nonce: '0' },
};

describe('PasskeyProofScreen', () => {
  it('requires review and confirmation before authentication and submission', async () => {
    const client = createCeremonyClient();
    const executionClient = createExecutionClient();
    const createExecution = jest.fn().mockResolvedValue(executionClient);
    await render(<PasskeyProofScreen client={client} createExecutionClient={createExecution} />);

    expect(screen.getByRole('button', { name: 'Authorize and submit' })).toBeDisabled();
    await press('Register Primary Passkey');
    await screen.findByText('Kernel account derived. Prepare the bounded Sepolia operation for review.');
    expect(createExecution).toHaveBeenCalledWith({ ceremonyClient: client, credential });

    await press('Prepare Sepolia operation');
    expect(await screen.findByText(operationHash)).toBeOnTheScreen();
    expect(executionClient.execute).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Authorize and submit' })).toBeDisabled();

    await press('Confirm exact operation');
    await screen.findByRole('button', { name: 'Exact operation confirmed' });
    await press('Authorize and submit');

    await waitFor(() => expect(executionClient.execute).toHaveBeenCalledWith(operationHash));
    expect(
      await screen.findByText(
        'Confirmed: the UserOperation and independent Sepolia state checks succeeded.',
      ),
    ).toBeOnTheScreen();
  });

  it('shows a failed state when authorization or submission is rejected', async () => {
    const client = createCeremonyClient();
    const executionClient = createExecutionClient({
      execute: jest.fn().mockRejectedValue(new Error('UserOperation submission rejected')),
    });
    await render(
      <PasskeyProofScreen
        client={client}
        createExecutionClient={jest.fn().mockResolvedValue(executionClient)}
      />,
    );

    await press('Register Primary Passkey');
    await screen.findByText('Kernel account derived. Prepare the bounded Sepolia operation for review.');
    await press('Prepare Sepolia operation');
    await screen.findByText(operationHash);
    await press('Confirm exact operation');
    await screen.findByRole('button', { name: 'Exact operation confirmed' });
    await press('Authorize and submit');

    expect(await screen.findByText('UserOperation submission rejected')).toBeOnTheScreen();
  });
});

async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name }));
  });
}

function createCeremonyClient(): PasskeyCeremonyClient {
  return {
    registerPrimaryPasskey: jest.fn().mockResolvedValue({ ok: true, credential }),
    authenticatePrimaryPasskey: jest.fn(),
    cancelPending: jest.fn(),
  };
}

function createExecutionClient(
  overrides: Partial<KernelPasskeyExecutionClient> = {},
): KernelPasskeyExecutionClient {
  return {
    prepare: jest.fn().mockResolvedValue(review),
    execute: jest.fn().mockResolvedValue(executionEvidence()),
    ...overrides,
  };
}

function executionEvidence(): KernelOperationEvidence {
  return {
    userOperationHash: operationHash,
    transactionHash: `0x${'44'.repeat(32)}`,
    account,
    challenge: 'challenge',
    credentialIdHash: `0x${'55'.repeat(32)}`,
    authenticatorData: 'authenticator-data',
    clientDataJSON: 'client-data',
    validatorEnvelope: '0x1234',
    integration: {
      chainId: 11155111,
      entryPointVersion: '0.7',
      kernelVersion: '0.3.3',
      passkeyValidatorVersion: '0.0.3',
      zeroDevSdkVersion: '5.5.10',
      zeroDevPasskeyValidatorPackageVersion: '5.6.0',
      zeroDevWebAuthnKeyPackageVersion: '5.5.0',
      viemVersion: '2.28.0',
    },
    receipt: { success: true, actualGasCostWei: '1', actualGasUsed: '1' },
    resultingState: {
      nonceBefore: '0',
      nonceAfter: '1',
      accountDeployed: true,
      outerTransactionStatus: 'success',
      rootValidator: '0x01',
      validatorInitialized: true,
      validatorModuleInstalled: true,
      storedPublicKeyX: credential.publicKeyX,
      storedPublicKeyY: credential.publicKeyY,
      kernelImplementation: '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28',
      outerReceiptLogCount: 1,
    },
  };
}
