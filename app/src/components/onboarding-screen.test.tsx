import { fireEvent, render, screen } from '@testing-library/react-native';

import { OnboardingScreen } from './onboarding-screen';
import type { OnboardingProfileStorage, UsernameClaimClient } from '@/onboarding/onboarding';
import type { KernelPasskeyExecutionClient } from '@/wallet/kernel-passkey-execution';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';
import {
  CURRENT_WALLET_IDENTITY_PINS,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';

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
jest.mock('@/onboarding/onboarding-native-storage', () => ({
  onboardingNativeStorage: { read: jest.fn(), write: jest.fn() },
}));

const account = '0x1111111111111111111111111111111111111111' as const;
const credential: RegisteredPrimaryPasskey = {
  id: 'MDEyMzQ1Njc4OQ',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  authenticatorAttachment: 'platform',
};

describe('OnboardingScreen', () => {
  it('creates the real Wallet Identity before completing the mock username claim', async () => {
    const ceremonyClient = createCeremonyClient();
    const identityStorage = createIdentityStorage();
    const profileStorage = createProfileStorage();
    const usernameClaimClient = createUsernameClaimClient();
    const onComplete = jest.fn();
    const createExecution = jest.fn().mockResolvedValue(kernelExecutionClient());
    await render(
      <OnboardingScreen
        client={ceremonyClient}
        createExecutionClient={createExecution}
        identityStorage={identityStorage}
        profileStorage={profileStorage}
        usernameClaimClient={usernameClaimClient}
        onComplete={onComplete}
      />,
    );

    await press('Create wallet');
    await press('Create with passkey');

    expect(await screen.findByText('anon.sodera.eth')).toBeOnTheScreen();
    expect(ceremonyClient.registerPrimaryPasskey).toHaveBeenCalledTimes(1);
    expect(createExecution).toHaveBeenCalledWith({
      ceremonyClient,
      credential,
    });

    await press('Claim anon.sodera.eth');
    expect(await screen.findByText("You're ready.")).toBeOnTheScreen();
    expect(usernameClaimClient.claim).toHaveBeenCalledWith({
      account,
      username: 'anon.sodera.eth',
    });

    await press('Open Sodera');
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ account, username: 'anon.sodera.eth', claimMode: 'mock' }),
    );
  });

  it('reopens an existing account before resuming username claim', async () => {
    const ceremonyClient = createCeremonyClient();
    await render(
      <OnboardingScreen
        client={ceremonyClient}
        createExecutionClient={jest.fn().mockResolvedValue(kernelExecutionClient())}
        identityStorage={createIdentityStorage(readyIdentity())}
        profileStorage={createProfileStorage()}
        usernameClaimClient={createUsernameClaimClient()}
        onComplete={jest.fn()}
      />,
    );

    expect(await screen.findByText('Finish your wallet.')).toBeOnTheScreen();
    await press('Continue wallet setup');

    expect(await screen.findByText('Claim your place.')).toBeOnTheScreen();
    expect(ceremonyClient.registerPrimaryPasskey).not.toHaveBeenCalled();
    expect(ceremonyClient.verifyPrimaryPasskey).toHaveBeenCalledWith(credential);
  });

  it('continues partial wallet registration without creating another credential', async () => {
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.resumePrimaryPasskeyRegistration = jest
      .fn()
      .mockResolvedValue({ ok: true, credential });
    const identityStorage = createIdentityStorage(
      JSON.stringify({
        schemaVersion: 1,
        phase: 'registering',
        pins: CURRENT_WALLET_IDENTITY_PINS,
      }),
    );
    await render(
      <OnboardingScreen
        client={ceremonyClient}
        createExecutionClient={jest.fn().mockResolvedValue(kernelExecutionClient())}
        identityStorage={identityStorage}
        profileStorage={createProfileStorage()}
        usernameClaimClient={createUsernameClaimClient()}
        onComplete={jest.fn()}
      />,
    );

    await press('Continue wallet setup');

    expect(await screen.findByText('Claim your place.')).toBeOnTheScreen();
    expect(ceremonyClient.resumePrimaryPasskeyRegistration).toHaveBeenCalledTimes(1);
    expect(ceremonyClient.registerPrimaryPasskey).not.toHaveBeenCalled();
  });

  it('shows recovery as unavailable without starting wallet creation', async () => {
    const ceremonyClient = createCeremonyClient();
    await render(
      <OnboardingScreen
        client={ceremonyClient}
        createExecutionClient={jest.fn()}
        identityStorage={createIdentityStorage()}
        profileStorage={createProfileStorage()}
        usernameClaimClient={createUsernameClaimClient()}
        onComplete={jest.fn()}
      />,
    );

    await press('Recover wallet');

    expect(await screen.findByText('Recovery is coming later.')).toBeOnTheScreen();
    expect(ceremonyClient.registerPrimaryPasskey).not.toHaveBeenCalled();
  });

  it('keeps a failed mock claim retryable and ignores duplicate taps', async () => {
    let rejectClaim: ((error: Error) => void) | undefined;
    const claim = jest.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectClaim = reject;
        }),
    );
    await render(
      <OnboardingScreen
        client={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(kernelExecutionClient())}
        identityStorage={createIdentityStorage(readyIdentity())}
        profileStorage={createProfileStorage()}
        usernameClaimClient={{ claim }}
        onComplete={jest.fn()}
      />,
    );

    await press('Continue wallet setup');
    const button = await screen.findByRole('button', { name: 'Claim anon.sodera.eth' });
    const firstPress = fireEvent.press(button);
    await flushMicrotasks();
    expect(screen.getByRole('button')).toBeDisabled();
    const secondPress = fireEvent.press(screen.getByRole('button'));
    expect(claim).toHaveBeenCalledTimes(1);
    rejectClaim?.(new Error('Mock claim unavailable'));
    await Promise.all([firstPress, secondPress]);
    expect(await screen.findByText('Mock claim unavailable')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Claim anon.sodera.eth' })).toBeEnabled();
  });
});

async function press(name: string) {
  await screen.findByRole('button', { name });
  await fireEvent.press(screen.getByRole('button', { name }));
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function createCeremonyClient(): PasskeyCeremonyClient {
  return {
    registerPrimaryPasskey: jest.fn().mockResolvedValue({ ok: true, credential }),
    resumePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(null),
    hasPendingPrimaryPasskeyRegistration: jest.fn().mockResolvedValue(true),
    acknowledgePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(undefined),
    authenticatePrimaryPasskey: jest.fn(),
    verifyPrimaryPasskey: jest.fn().mockResolvedValue({ ok: true }),
    cancelPending: jest.fn(),
  };
}

function kernelExecutionClient(): KernelPasskeyExecutionClient {
  return {
    account,
    deployed: false,
    prepare: jest.fn(),
    execute: jest.fn(),
  };
}

function readyIdentity() {
  return JSON.stringify({
    schemaVersion: 1,
    phase: 'accountDerived',
    pins: CURRENT_WALLET_IDENTITY_PINS,
    credential,
    account,
  });
}

function createIdentityStorage(initialValue: string | null = null): WalletIdentityStorage {
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

function createProfileStorage(initialValue: string | null = null): OnboardingProfileStorage {
  let value = initialValue;
  return {
    async read() {
      return value;
    },
    async write(nextValue) {
      value = nextValue;
    },
  };
}

function createUsernameClaimClient(): UsernameClaimClient {
  return { claim: jest.fn().mockResolvedValue(undefined) };
}
