import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  SendScreen,
  shortenHash,
} from './send-screen';
import type {
  KernelOperationEvidence,
  KernelOperationReview,
  KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import { parseSendTransfer } from '@/wallet/send-transfer';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';
import { CURRENT_WALLET_IDENTITY_PINS, type WalletIdentityStorage } from '@/wallet/wallet-identity';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn() } }));
jest.mock('@/onboarding/onboarding', () => ({ SODERA_FIXTURE_USERNAME: 'anon.sodera.eth' }));
jest.mock('@/wallet/passkey-native-adapter', () => ({
  passkeyNativeAdapter: {
    createCredential: jest.fn(),
    getCredential: jest.fn(),
    readRegistrationJournal: jest.fn(),
    clearRegistrationJournal: jest.fn(),
    cancel: jest.fn(),
  },
}));
jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));
jest.mock('@/wallet/wallet-identity-native-storage', () => ({
  walletIdentityNativeStorage: { read: jest.fn(), write: jest.fn(), clear: jest.fn() },
}));

const account = '0x1111111111111111111111111111111111111111' as const;
const recipient = '0x2222222222222222222222222222222222222222' as const;
const operationHash = `0x${'33'.repeat(32)}` as const;
const transactionHash = `0x${'44'.repeat(32)}` as const;
const credential: RegisteredPrimaryPasskey = {
  id: 'credential',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  authenticatorAttachment: 'platform',
};
const review: KernelOperationReview = {
  userOperationHash: operationHash,
  account,
  chain: 'Ethereum Sepolia',
  chainId: 11155111,
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  validator: '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69',
  deploymentRequired: false,
  calls: [{ to: recipient, valueWei: '100000000000000000', data: '0x' }],
  sponsored: true,
  paymaster: '0x5555555555555555555555555555555555555555',
  maximumNetworkFeeWei: '1000',
  userOperation: { sender: account, nonce: '1' },
};

describe('SendScreen', () => {
  it('resolves a Sepolia subdomain, prepares ETH and shows submission before confirmation', async () => {
    const executionClient = createExecutionClient();
    const recordSend = jest.fn().mockResolvedValue(undefined);
    const onOpenHistory = jest.fn();
    const resolveRecipient = jest.fn().mockResolvedValue({ address: recipient, name: 'gargs.sodera.eth' });
    await render(
      <SendScreen
        ceremonyClient={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(executionClient)}
        onOpenHistory={onOpenHistory}
        recordSend={recordSend}
        resolveRecipient={resolveRecipient}
        readBalances={jest.fn().mockResolvedValue({ ETH: 10n ** 18n, USDC: 2_000_000n })}
        storage={createStorage()}
      />,
    );
    await screen.findByText('Who are you sending to?');
    await act(async () => fireEvent.changeText(screen.getByLabelText('Recipient ENS name or address'), 'gargs.sodera.eth'));
    await press('Continue');
    expect(resolveRecipient).toHaveBeenCalledWith('gargs.sodera.eth');
    await press('Select ETH');
    await act(async () => fireEvent.changeText(screen.getByLabelText('ETH amount'), '0.1'));
    await press('Review transfer');
    expect(await screen.findByText('Does this look right?')).toBeOnTheScreen();
    expect(screen.getByText('0.1 ETH')).toBeOnTheScreen();
    expect(screen.getByText('gargs.sodera.eth')).toBeOnTheScreen();
    expect(screen.getByText('Sponsored')).toBeOnTheScreen();
    expect(screen.queryByText(operationHash)).not.toBeOnTheScreen();
    expect(executionClient.prepare).toHaveBeenCalledWith([
      { to: recipient, value: 100_000_000_000_000_000n, data: '0x' },
    ]);
    expect(executionClient.submit).not.toHaveBeenCalled();

    await press('More details');
    expect(screen.getByText(operationHash)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeOnTheScreen();

    await press('Confirm with passkey');
    await waitFor(() => expect(executionClient.submit).toHaveBeenCalledWith(operationHash));
    expect(await screen.findByText('Transaction submitted')).toBeOnTheScreen();
    expect(screen.getByText(shortenHash(operationHash))).toBeOnTheScreen();
    expect(recordSend).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted', asset: 'ETH', recipient }));
    await press('View transaction history');
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('supports editing the transfer after review', async () => {
    await render(
      <SendScreen
        ceremonyClient={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(createExecutionClient())}
        resolveRecipient={jest.fn().mockResolvedValue({ address: recipient, name: null })}
        readBalances={jest.fn().mockResolvedValue({ ETH: 10n ** 18n, USDC: 2_000_000n })}
        storage={createStorage()}
      />,
    );
    await enterTransfer(recipient, '0.1');
    await press('Review transfer');
    await screen.findByText('Does this look right?');

    await press('Back');

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('ETH amount'), '0.2');
    });

    expect(screen.queryByText('Does this look right?')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Review transfer' })).toBeOnTheScreen();
  });

  it('reviews the exact USDC contract call and resolved root ENS address', async () => {
    const executionClient = createExecutionClient();
    const call = parseSendTransfer({ recipient, asset: 'USDC', amount: '1.25', balance: 2_000_000n }).call;
    executionClient.prepare = jest.fn().mockResolvedValue({
      ...review,
      calls: [{ to: call.to, valueWei: '0', data: call.data }],
    });
    await render(<SendScreen
      ceremonyClient={createCeremonyClient()}
      createExecutionClient={jest.fn().mockResolvedValue(executionClient)}
      readBalances={jest.fn().mockResolvedValue({ ETH: 10n ** 18n, USDC: 2_000_000n })}
      resolveRecipient={jest.fn().mockResolvedValue({ address: recipient, name: 'gargs.eth' })}
      storage={createStorage()}
    />);
    await screen.findByText('Who are you sending to?');
    await act(async () => fireEvent.changeText(screen.getByLabelText('Recipient ENS name or address'), 'gargs.eth'));
    await press('Continue');
    await press('Select USDC');
    await act(async () => fireEvent.changeText(screen.getByLabelText('USDC amount'), '1.25'));
    await press('Review transfer');
    expect(await screen.findByText('Does this look right?')).toBeOnTheScreen();
    expect(screen.getByText('1.25 USDC')).toBeOnTheScreen();
    expect(screen.getByText('gargs.eth')).toBeOnTheScreen();
    expect(screen.getByText(recipient)).toBeOnTheScreen();
    expect(executionClient.prepare).toHaveBeenCalledWith([call]);
  });

  it('ignores duplicate confirmation taps while submission is in flight', async () => {
    let resolveSubmission!: (hash: typeof operationHash) => void;
    const executionClient = createExecutionClient();
    executionClient.submit = jest.fn().mockReturnValue(new Promise((resolve) => {
      resolveSubmission = resolve;
    }));
    await render(
      <SendScreen
        ceremonyClient={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(executionClient)}
        resolveRecipient={jest.fn().mockResolvedValue({ address: recipient, name: null })}
        readBalances={jest.fn().mockResolvedValue({ ETH: 10n ** 18n, USDC: 2_000_000n })}
        recordSend={jest.fn().mockResolvedValue(undefined)}
        storage={createStorage()}
      />,
    );
    await enterTransfer(recipient, '0.1');
    await press('Review transfer');
    const confirm = await screen.findByRole('button', { name: 'Confirm with passkey' });
    const onClick = confirm.props.onClick as (() => void) | undefined;
    expect(onClick).toEqual(expect.any(Function));

    await act(async () => {
      onClick?.();
      onClick?.();
    });

    expect(executionClient.submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSubmission(operationHash);
    });

    expect(await screen.findByText('Transaction submitted')).toBeOnTheScreen();
  });
});

async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name }));
  });
}

async function enterTransfer(to: string, amount: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Recipient ENS name or address'), to);
  });
  await press('Continue');
  await press('Select ETH');
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('ETH amount'), amount);
  });
}

function createStorage(): WalletIdentityStorage {
  let value = JSON.stringify({
    schemaVersion: 1,
    phase: 'accountDeployed',
    pins: CURRENT_WALLET_IDENTITY_PINS,
    credential,
    account,
  });
  return {
    async read() {
      return value;
    },
    async write(nextValue) {
      value = nextValue;
    },
    async clear() {
      value = '';
    },
  };
}

function createCeremonyClient(): PasskeyCeremonyClient {
  return {
    registerPrimaryPasskey: jest.fn(),
    resumePrimaryPasskeyRegistration: jest.fn(),
    hasPendingPrimaryPasskeyRegistration: jest.fn(),
    acknowledgePrimaryPasskeyRegistration: jest.fn(),
    authenticatePrimaryPasskey: jest.fn(),
    verifyPrimaryPasskey: jest.fn(),
    cancelPending: jest.fn(),
  };
}

function createExecutionClient(): KernelPasskeyExecutionClient {
  return {
    account,
    deployed: true,
    prepare: jest.fn().mockResolvedValue(review),
    execute: jest.fn().mockResolvedValue(executionEvidence()),
    submit: jest.fn().mockResolvedValue(operationHash),
    waitForConfirmation: jest.fn().mockReturnValue(new Promise(() => undefined)),
  };
}

function executionEvidence(): KernelOperationEvidence {
  return {
    userOperationHash: operationHash,
    transactionHash,
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
      nonceBefore: '1',
      nonceAfter: '2',
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
