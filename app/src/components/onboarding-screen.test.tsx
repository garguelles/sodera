import { fireEvent, render, screen } from '@testing-library/react-native';
import { OnboardingScreen } from './onboarding-screen';
import type { OnboardingProfileStorage, UsernameClaimClient } from '@/onboarding/onboarding';
import type { EnsIdentityReader } from '@/ens/identity-client';
import type { DefaultHomeClient } from '@/launcher/default-home';
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
jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));

const account = '0x1111111111111111111111111111111111111111' as const;
const claimId = '11111111-1111-4111-8111-111111111111';
const credential: RegisteredPrimaryPasskey = {
  id: 'MDEyMzQ1Njc4OQ',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  authenticatorAttachment: 'platform',
};

describe('OnboardingScreen', () => {
  it('claims a verified name before completing onboarding', async () => {
    const ceremonyClient = createCeremonyClient();
    const identityStorage = createIdentityStorage();
    const profileStorage = createProfileStorage();
    const usernameClaimClient = createUsernameClaimClient();
    const onComplete = jest.fn();
    const homeClient = createHomeClient();
    const createExecution = jest.fn().mockResolvedValue(kernelExecutionClient());
    await render(
      <OnboardingScreen
        client={ceremonyClient}
        createExecutionClient={createExecution}
        identityStorage={identityStorage}
        profileStorage={profileStorage}
        usernameClaimClient={usernameClaimClient}
        identityReader={createIdentityReader()}
        homeClient={homeClient}
        onComplete={onComplete}
      />,
    );

    await press('Create wallet');
    await press('Create with passkey');

    expect(await screen.findByText('Claim your place.')).toBeOnTheScreen();
    expect(ceremonyClient.registerPrimaryPasskey).toHaveBeenCalledTimes(1);
    expect(createExecution).toHaveBeenCalledWith({
      ceremonyClient,
      credential,
    });

    fireEvent.changeText(screen.getByTestId('ens-username'), 'gargs');
    await press('Claim');
    expect(await screen.findByText('Make Sodera your Home.')).toBeOnTheScreen();
    expect(usernameClaimClient.submit).toHaveBeenCalledWith({
      account,
      credential,
      label: 'gargs',
    });

    await press('Set Sodera as Home');
    expect(homeClient.requestDefaultHome).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    jest.mocked(homeClient.isDefaultHome).mockResolvedValue(true);
    await press("I've selected Sodera");
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ account, username: 'gargs.sodera.eth', claimMode: 'ens', claimId }),
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
        identityReader={createIdentityReader()}
        homeClient={createHomeClient()}
        onComplete={jest.fn()}
      />,
    );

    expect(await screen.findByText('Finish your wallet.')).toBeOnTheScreen();
    await press('Continue wallet setup');

    expect(await screen.findByText('Claim your place.')).toBeOnTheScreen();
    expect(ceremonyClient.registerPrimaryPasskey).not.toHaveBeenCalled();
    expect(ceremonyClient.verifyPrimaryPasskey).toHaveBeenCalledWith(credential);
  });

  it('deploys an undeployed wallet and executes its zero-value operation in one activation', async () => {
    const execution = { ...kernelExecutionClient(), deployed: false,
      prepare: jest.fn().mockResolvedValue({ account, calls: [{ to: account, valueWei: '0' }],
        userOperationHash: `0x${'11'.repeat(32)}`, maximumNetworkFeeWei: '100', sponsored: true }),
      execute: jest.fn().mockResolvedValue({ account }),
    };
    await render(<OnboardingScreen client={createCeremonyClient()}
      createExecutionClient={jest.fn().mockResolvedValue(execution)}
      identityStorage={createIdentityStorage(readyIdentity())} profileStorage={createProfileStorage()}
      usernameClaimClient={createUsernameClaimClient()} identityReader={createIdentityReader()}
      homeClient={createHomeClient()} onComplete={jest.fn()} />);
    await press('Continue wallet setup');
    expect(await screen.findByText('Activate your wallet.')).toBeOnTheScreen();
    expect(screen.getByText('Deploy wallet + 0 ETH operation on Sepolia')).toBeOnTheScreen();
    expect(screen.queryByText(/UserOperation:/)).not.toBeOnTheScreen();
    expect(execution.prepare).toHaveBeenCalledTimes(1);
    await press('Activate wallet');
    expect(execution.execute).toHaveBeenCalledWith(`0x${'11'.repeat(32)}`);
    expect(await screen.findByText('Claim your place.')).toBeOnTheScreen();
  });

  it('recovers a saved pending claim after restart without submitting again', async () => {
    const usernameClaimClient = createUsernameClaimClient();
    const profileStorage = createProfileStorage(JSON.stringify({ schemaVersion: 2, phase: 'claimPending',
      account, username: 'gargs.sodera.eth', claimId }));
    await render(<OnboardingScreen client={createCeremonyClient()}
      identityStorage={createIdentityStorage(readyIdentity())} profileStorage={profileStorage}
      usernameClaimClient={usernameClaimClient} identityReader={createIdentityReader()}
      homeClient={createHomeClient()} onComplete={jest.fn()} />);
    expect(await screen.findByText('Make Sodera your Home.')).toBeOnTheScreen();
    expect(usernameClaimClient.submit).not.toHaveBeenCalled();
    expect(usernameClaimClient.status).toHaveBeenCalledWith({ id: claimId, account, label: 'gargs' });
  });

  it('shows only a loading mask while registration polls', async () => {
    const usernameClaimClient = createUsernameClaimClient();
    jest.mocked(usernameClaimClient.status).mockResolvedValue({ status: 'queued', name: 'gargs.sodera.eth' });
    await render(<OnboardingScreen client={createCeremonyClient()}
      identityStorage={createIdentityStorage(readyIdentity())}
      profileStorage={createProfileStorage(JSON.stringify({ schemaVersion: 2, phase: 'claimPending',
        account, username: 'gargs.sodera.eth', claimId }))}
      usernameClaimClient={usernameClaimClient} identityReader={createIdentityReader()}
      homeClient={createHomeClient()} onComplete={jest.fn()} />);

    expect(await screen.findByText('Making it official.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Registering Sodera name')).toBeOnTheScreen();
    expect(screen.queryByText('Waiting for Sepolia')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Check registration status' })).not.toBeOnTheScreen();
    expect(usernameClaimClient.status).toHaveBeenCalled();
  });

  it('recovers a previously confirmed diagnostic claim for a legacy wallet', async () => {
    const usernameClaimClient = createUsernameClaimClient();
    jest.mocked(usernameClaimClient.forAccount).mockResolvedValue({ id: claimId, status: 'confirmed', name: 'gargs.sodera.eth' });
    const identityReader = createIdentityReader();
    await render(<OnboardingScreen client={createCeremonyClient()}
      createExecutionClient={jest.fn().mockResolvedValue(kernelExecutionClient())}
      identityStorage={createIdentityStorage(readyIdentity())}
      profileStorage={createProfileStorage(JSON.stringify({ schemaVersion: 1, account,
        username: 'anon.sodera.eth', claimMode: 'mock', completedAt: '2026-09-13T00:00:00.000Z' }))}
      usernameClaimClient={usernameClaimClient} identityReader={identityReader}
      homeClient={createHomeClient()} onComplete={jest.fn()} />);

    await press('Continue wallet setup');
    expect(await screen.findByText('Make Sodera your Home.')).toBeOnTheScreen();
    expect(usernameClaimClient.submit).not.toHaveBeenCalled();
    expect(usernameClaimClient.forAccount).toHaveBeenCalledWith(account);
    expect(identityReader.verify).toHaveBeenCalledWith('gargs.sodera.eth', account);
  });

  it('resumes existing confirmed profiles at Home selection and keeps dismissal retryable', async () => {
    const profileStorage = createProfileStorage();
    await profileStorage.write(JSON.stringify({
      schemaVersion: 2,
      account,
      username: 'gargs.sodera.eth',
      claimMode: 'ens',
      claimId,
      completedAt: '2026-09-13T00:00:00.000Z',
    }));
    const homeClient = createHomeClient();
    const onComplete = jest.fn();
    await render(
      <OnboardingScreen
        client={createCeremonyClient()}
        identityStorage={createIdentityStorage(readyIdentity())}
        profileStorage={profileStorage}
        homeClient={homeClient}
        onComplete={onComplete}
      />,
    );

    expect(await screen.findByText('Make Sodera your Home.')).toBeOnTheScreen();
    await press('Set Sodera as Home');
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set Sodera as Home' })).toBeEnabled();
    await press("I've selected Sodera");
    expect(await screen.findByText('Select Sodera in the Android Home app prompt to finish setup.')).toBeOnTheScreen();
    expect(homeClient.requestDefaultHome).toHaveBeenCalledTimes(1);
    await press('Set Sodera as Home');
    expect(homeClient.requestDefaultHome).toHaveBeenCalledTimes(2);
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
        identityReader={createIdentityReader()}
        homeClient={createHomeClient()}
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
        homeClient={createHomeClient()}
        onComplete={jest.fn()}
      />,
    );

    await press('Recover wallet');

    expect(await screen.findByText('Recovery is coming later.')).toBeOnTheScreen();
    expect(ceremonyClient.registerPrimaryPasskey).not.toHaveBeenCalled();
  });

  it('keeps a failed claim retryable and ignores duplicate taps', async () => {
    let rejectClaim: ((error: Error) => void) | undefined;
    const submit = jest.fn(
      () =>
        new Promise<Awaited<ReturnType<UsernameClaimClient['submit']>>>((_, reject) => {
          rejectClaim = reject;
        }),
    );
    await render(
      <OnboardingScreen
        client={createCeremonyClient()}
        createExecutionClient={jest.fn().mockResolvedValue(kernelExecutionClient())}
        identityStorage={createIdentityStorage(readyIdentity())}
        profileStorage={createProfileStorage()}
        usernameClaimClient={{ submit, status: jest.fn(), forAccount: jest.fn().mockResolvedValue(null) }}
        identityReader={createIdentityReader()}
        homeClient={createHomeClient()}
        onComplete={jest.fn()}
      />,
    );

    await press('Continue wallet setup');
    fireEvent.changeText(screen.getByTestId('ens-username'), 'gargs');
    const button = await screen.findByRole('button', { name: 'Claim' });
    const firstPress = fireEvent.press(button);
    await flushMicrotasks();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeDisabled();
    const secondPress = fireEvent.press(screen.getByRole('button', { name: 'Claim' }));
    expect(submit).toHaveBeenCalledTimes(1);
    rejectClaim?.(new Error('Claim unavailable'));
    await Promise.all([firstPress, secondPress]);
    expect(await screen.findByText('Claim unavailable')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeEnabled();
  });

  it('checks availability before requesting passkey authorization', async () => {
    const usernameClaimClient = createUsernameClaimClient();
    const identityReader = createIdentityReader();
    jest.mocked(identityReader.availability).mockResolvedValue(false);
    await render(<OnboardingScreen client={createCeremonyClient()}
      createExecutionClient={jest.fn().mockResolvedValue(kernelExecutionClient())}
      identityStorage={createIdentityStorage(readyIdentity())} profileStorage={createProfileStorage()}
      usernameClaimClient={usernameClaimClient} identityReader={identityReader}
      homeClient={createHomeClient()} onComplete={jest.fn()} />);

    await press('Continue wallet setup');
    fireEvent.changeText(screen.getByTestId('ens-username'), 'gargs');
    await press('Claim');

    expect(identityReader.availability).toHaveBeenCalledWith('gargs');
    expect(usernameClaimClient.submit).not.toHaveBeenCalled();
    expect(await screen.findByText('This name is unavailable or the parent expires too soon')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeEnabled();
  });
});

function createHomeClient(): DefaultHomeClient {
  return {
    isDefaultHome: jest.fn().mockResolvedValue(false),
    requestDefaultHome: jest.fn().mockResolvedValue(undefined),
  };
}

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
    deployed: true,
    prepare: jest.fn(),
    execute: jest.fn(),
    submit: jest.fn(),
    waitForConfirmation: jest.fn(),
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
  return {
    submit: jest.fn().mockResolvedValue({ id: claimId, status: 'queued', name: 'gargs.sodera.eth' }),
    status: jest.fn().mockResolvedValue({ status: 'confirmed', name: 'gargs.sodera.eth' }),
    forAccount: jest.fn().mockResolvedValue(null),
  };
}

function createIdentityReader(): EnsIdentityReader {
  return { availability: jest.fn().mockResolvedValue(true), verify: jest.fn().mockResolvedValue(true) };
}
