import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  SendScreen,
  parseEthTransfer,
  shortenHash,
} from './send-screen';
import { sepoliaTransactionUrl } from '@/wallet/sepolia';
import type {
  KernelOperationEvidence,
  KernelOperationReview,
  KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';
import { CURRENT_WALLET_IDENTITY_PINS, type WalletIdentityStorage } from '@/wallet/wallet-identity';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
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
  it('validates address, exact units, and available balance', () => {
    expect(() => parseEthTransfer({ recipient: 'nope', amount: '1', balance: 2n })).toThrow(
      'Enter a valid Ethereum address',
    );
    expect(() => parseEthTransfer({ recipient, amount: '0', balance: 2n })).toThrow(
      'Amount must be greater than zero',
    );
    expect(() => parseEthTransfer({ recipient, amount: '1', balance: 1n })).toThrow(
      'Amount exceeds the available ETH balance',
    );
    expect(parseEthTransfer({ recipient, amount: '0.1', balance: 10n ** 18n })).toEqual({
      recipient,
      value: 100_000_000_000_000_000n,
    });
  });

  it('prepares the entered transfer and submits only after review', async () => {
    const executionClient = createExecutionClient();
    const onDone = jest.fn();
    const copyTransactionHash = jest.fn().mockResolvedValue(undefined);
    const openTransaction = jest.fn().mockResolvedValue(undefined);
    await render(
      <SendScreen
        ceremonyClient={createCeremonyClient()}
        copyTransactionHash={copyTransactionHash}
        createExecutionClient={jest.fn().mockResolvedValue(executionClient)}
        onDone={onDone}
        openTransaction={openTransaction}
        readBalance={jest.fn().mockResolvedValue(10n ** 18n)}
        storage={createStorage()}
      />,
    );
    await screen.findByText('1 ETH');

    await enterTransfer(recipient, '0.1');
    await press('Continue');

    expect(await screen.findByText('Does this look right?')).toBeOnTheScreen();
    expect(screen.getByText('0.1 ETH')).toBeOnTheScreen();
    expect(screen.getByText(recipient)).toBeOnTheScreen();
    expect(screen.getByText('Sponsored')).toBeOnTheScreen();
    expect(screen.queryByText(operationHash)).not.toBeOnTheScreen();
    expect(executionClient.prepare).toHaveBeenCalledWith([
      { to: recipient, value: 100_000_000_000_000_000n, data: '0x' },
    ]);
    expect(executionClient.execute).not.toHaveBeenCalled();

    await press('More details');
    expect(screen.getByText(operationHash)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeOnTheScreen();

    await press('Confirm with passkey');

    await waitFor(() => expect(executionClient.execute).toHaveBeenCalledWith(operationHash));
    expect(await screen.findByText('ETH sent successfully')).toBeOnTheScreen();
    expect(screen.getByText(shortenHash(transactionHash))).toBeOnTheScreen();
    expect(screen.queryByText(transactionHash)).not.toBeOnTheScreen();

    await press('Copy transaction hash');
    expect(copyTransactionHash).toHaveBeenCalledWith(transactionHash);
    expect(await screen.findByText('Copied')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByRole('link', { name: 'View on explorer' }));
    });
    expect(openTransaction).toHaveBeenCalledWith(sepoliaTransactionUrl(transactionHash));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('requires a fresh preparation after returning to edit the transfer', async () => {
    await render(
      <SendScreen
        ceremonyClient={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(createExecutionClient())}
        readBalance={jest.fn().mockResolvedValue(10n ** 18n)}
        storage={createStorage()}
      />,
    );
    await screen.findByText('1 ETH');
    await enterTransfer(recipient, '0.1');
    await press('Continue');
    await screen.findByText('Does this look right?');

    await press('Back');

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('ETH amount'), '0.2');
    });

    expect(screen.queryByText('Does this look right?')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeOnTheScreen();
  });

  it('ignores duplicate confirmation taps while execution is in flight', async () => {
    let resolveExecution!: (evidence: KernelOperationEvidence) => void;
    const executionClient = createExecutionClient();
    executionClient.execute = jest.fn().mockReturnValue(new Promise((resolve) => {
      resolveExecution = resolve;
    }));
    await render(
      <SendScreen
        ceremonyClient={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(executionClient)}
        readBalance={jest.fn().mockResolvedValue(10n ** 18n)}
        storage={createStorage()}
      />,
    );
    await screen.findByText('1 ETH');
    await enterTransfer(recipient, '0.1');
    await press('Continue');
    const confirm = await screen.findByRole('button', { name: 'Confirm with passkey' });
    const onClick = confirm.props.onClick as (() => void) | undefined;
    expect(onClick).toEqual(expect.any(Function));

    await act(async () => {
      onClick?.();
      onClick?.();
    });

    expect(executionClient.execute).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveExecution(executionEvidence());
    });

    expect(await screen.findByText('ETH sent successfully')).toBeOnTheScreen();
  });
});

async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name }));
  });
}

async function enterTransfer(to: string, amount: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Recipient address'), to);
  });
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
      viemVersion: '2.28.0',
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
