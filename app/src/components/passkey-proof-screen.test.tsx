import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PasskeyProofScreen } from './passkey-proof-screen';
import { createEnsClaimAuthClient } from '@/ens/claim-auth-client';
import { createEnsClaimClient } from '@/ens/claim-client';
import type {
  KernelOperationEvidence,
  KernelOperationReview,
  KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';
import {
  CURRENT_WALLET_IDENTITY_PINS,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@expo/ui', () => {
  const { View, TextInput } = jest.requireActual('react-native');
  return { Host: View, TextInput };
});
jest.mock('@/wallet/passkey-native-adapter', () => ({
  passkeyNativeAdapter: {
    createCredential: jest.fn(),
    getCredential: jest.fn(),
    readRegistrationJournal: jest.fn(),
    clearRegistrationJournal: jest.fn(),
    cancel: jest.fn(),
  },
}));
jest.mock('@/wallet/wallet-identity-native-storage', () => ({
  walletIdentityNativeStorage: { read: jest.fn(), write: jest.fn(), clear: jest.fn() },
}));
jest.mock('@/ens/claim-auth-client', () => ({ createEnsClaimAuthClient: jest.fn() }));
jest.mock('@/ens/claim-client', () => ({ createEnsClaimClient: jest.fn() }));

const credential: RegisteredPrimaryPasskey = {
  id: 'MDEyMzQ1Njc4OQ',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
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
    await render(
      <PasskeyProofScreen
        client={client}
        createExecutionClient={createExecution}
        storage={createStorage()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Authorize and submit' })).toBeDisabled();
    await press('Create Wallet');
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
        storage={createStorage()}
      />,
    );

    await press('Create Wallet');
    await screen.findByText('Kernel account derived. Prepare the bounded Sepolia operation for review.');
    await press('Prepare Sepolia operation');
    await screen.findByText(operationHash);
    await press('Confirm exact operation');
    await screen.findByRole('button', { name: 'Exact operation confirmed' });
    await press('Authorize and submit');

    expect(await screen.findByText('UserOperation submission rejected')).toBeOnTheScreen();
  });

  it('does not report a confirmed operation as failed when only local deployment persistence fails', async () => {
    const storage = createStorage();
    const write = storage.write;
    storage.write = async (value) => {
      if (JSON.parse(value).phase === 'accountDeployed') {
        throw new Error('storage unavailable');
      }
      await write(value);
    };
    await render(
      <PasskeyProofScreen
        client={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(createExecutionClient())}
        storage={storage}
      />,
    );

    await press('Create Wallet');
    await screen.findByText('Kernel account derived. Prepare the bounded Sepolia operation for review.');
    await press('Prepare Sepolia operation');
    await screen.findByText(operationHash);
    await press('Confirm exact operation');
    await screen.findByRole('button', { name: 'Exact operation confirmed' });
    await press('Authorize and submit');

    expect(
      await screen.findByText(
        'Confirmed on Sepolia, but the local deployment marker could not be persisted. Reopen the existing wallet before another operation.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Authorize and submit' })).toBeDisabled();
  });

  it('offers Recover Wallet instead of registering a replacement when reopening has no credential', async () => {
    const client = createCeremonyClient();
    client.verifyPrimaryPasskey = jest.fn().mockResolvedValue({
      ok: false,
      error: { kind: 'noCredential' },
    });
    await render(
      <PasskeyProofScreen
        client={client}
        createExecutionClient={jest.fn()}
        storage={createStorage(
          JSON.stringify({
            schemaVersion: 1,
            phase: 'accountDerived',
            pins: CURRENT_WALLET_IDENTITY_PINS,
            credential,
            account,
          }),
        )}
      />,
    );

    await press('Reopen existing wallet');

    expect(await screen.findByText('The Primary Passkey is unavailable')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Recover Wallet' })).toBeOnTheScreen();
    expect(client.registerPrimaryPasskey).not.toHaveBeenCalled();
  });

  it('verifies a chosen name with the deployed Kernel without displaying a claim token', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://ens.example';
    const prove = jest.fn().mockResolvedValue({ name: 'gargs.sodera.eth', claimToken: 'secret-token' });
    jest.mocked(createEnsClaimAuthClient).mockReturnValue({ prove } as never);
    const client = createCeremonyClient();
    client.verifyPrimaryPasskey = jest.fn().mockResolvedValue({ ok: true });
    try {
      await render(
        <PasskeyProofScreen
          client={client}
          createExecutionClient={jest.fn().mockResolvedValue(createExecutionClient({ deployed: true }))}
          storage={createStorage(JSON.stringify({
            schemaVersion: 1, phase: 'accountDeployed', pins: CURRENT_WALLET_IDENTITY_PINS,
            credential, account,
          }))}
        />,
      );
      await press('Reopen existing wallet');
      await act(async () => fireEvent.changeText(screen.getByPlaceholderText('Choose a test username'), 'gargs'));
      await press('Verify passkey with ENS service');
      expect(prove).toHaveBeenCalledWith({ account, credential, label: 'gargs' });
      expect(await screen.findByText('Primary Passkey verified for gargs.sodera.eth. No ENS name was issued.')).toBeOnTheScreen();
      expect(screen.queryByText('secret-token')).not.toBeOnTheScreen();
    } finally {
      delete process.env.EXPO_PUBLIC_API_URL;
    }
  });

  it('keeps controlled issuance behind an explicit flag and never shows the proof token', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.sodera.xyz';
    process.env.EXPO_PUBLIC_ENS_CLAIMS_ENABLED = '1';
    const submit = jest.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111',
      name: 'gargs.sodera.eth', status: 'queued' });
    const status = jest.fn().mockResolvedValue({ name: 'gargs.sodera.eth', status: 'confirmed' });
    jest.mocked(createEnsClaimClient).mockReturnValue({ submit, status } as never);
    const client = createCeremonyClient();
    client.verifyPrimaryPasskey = jest.fn().mockResolvedValue({ ok: true });
    try {
      await render(<PasskeyProofScreen client={client}
        createExecutionClient={jest.fn().mockResolvedValue(createExecutionClient({ deployed: true }))}
        storage={createStorage(JSON.stringify({ schemaVersion: 1, phase: 'accountDeployed',
          pins: CURRENT_WALLET_IDENTITY_PINS, credential, account }))} />);
      await press('Reopen existing wallet');
      await act(async () => fireEvent.changeText(screen.getByPlaceholderText('Choose a test username'), 'gargs'));
      await press('Request ENS name');
      expect(submit).toHaveBeenCalledWith({ account, credential, label: 'gargs' });
      expect(await screen.findByText(/Claim for gargs.sodera.eth: queued/)).toBeOnTheScreen();
      await press('Refresh ENS claim status');
      expect(status).toHaveBeenCalledWith({
        id: '11111111-1111-4111-8111-111111111111', account, label: 'gargs',
      });
      expect(await screen.findByText('Claim for gargs.sodera.eth: confirmed.')).toBeOnTheScreen();
      expect(screen.queryByText('secret-token')).not.toBeOnTheScreen();
    } finally {
      delete process.env.EXPO_PUBLIC_API_URL;
      delete process.env.EXPO_PUBLIC_ENS_CLAIMS_ENABLED;
    }
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
    resumePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(null),
    hasPendingPrimaryPasskeyRegistration: jest.fn().mockResolvedValue(true),
    acknowledgePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(undefined),
    authenticatePrimaryPasskey: jest.fn(),
    verifyPrimaryPasskey: jest.fn(),
    cancelPending: jest.fn(),
  };
}

function createStorage(initialValue: string | null = null): WalletIdentityStorage {
  let value = initialValue;
  return {
    async read() {
      return value;
    },
    async write(nextValue) {
      value = nextValue;
    },
    async clear() {
      value = null;
    },
  };
}

function createExecutionClient(
  overrides: Partial<KernelPasskeyExecutionClient> = {},
): KernelPasskeyExecutionClient {
  return {
    account,
    deployed: false,
    prepare: jest.fn().mockResolvedValue(review),
    execute: jest.fn().mockResolvedValue(executionEvidence()),
    submit: jest.fn(),
    waitForConfirmation: jest.fn(),
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
      viemVersion: '2.35.0',
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
