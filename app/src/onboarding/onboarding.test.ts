import {
  persistCompletedOnboarding,
  readOnboardingProfile,
  resolveOnboardingAccess,
  SODERA_FIXTURE_USERNAME,
  type OnboardingProfileStorage,
} from './onboarding';
import {
  CURRENT_WALLET_IDENTITY_PINS,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import type { RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';
import type { DefaultHomeClient } from '@/launcher/default-home';

jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));

const homeClient: DefaultHomeClient = {
  isDefaultHome: jest.fn().mockResolvedValue(true),
  requestDefaultHome: jest.fn(),
};

const account = '0x1111111111111111111111111111111111111111' as const;
const otherAccount = '0x2222222222222222222222222222222222222222' as const;
const credential: RegisteredPrimaryPasskey = {
  id: 'MDEyMzQ1Njc4OQ',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  authenticatorAttachment: 'platform',
};

describe('onboarding state', () => {
  it('keeps a fresh installation in onboarding', async () => {
    await expect(
      resolveOnboardingAccess({
        identityStorage: createStorage(null),
        profileStorage: createStorage(null),
        homeClient,
      }),
    ).resolves.toEqual({ status: 'incomplete', wallet: 'missing' });
  });

  it('blocks profile data whose wallet identity is missing', async () => {
    const profileStorage = createStorage(null);
    await persistCompletedOnboarding({ storage: profileStorage, account });

    await expect(
      resolveOnboardingAccess({
        identityStorage: createStorage(null),
        profileStorage,
        homeClient,
      }),
    ).resolves.toEqual({
      status: 'blocked',
      message: 'An onboarding profile exists without its Wallet Identity',
    });
  });

  it('completes only when the profile belongs to the persisted account', async () => {
    const profileStorage = createStorage(null);
    const profile = await persistCompletedOnboarding({
      storage: profileStorage,
      account,
      now: () => new Date('2026-09-13T00:00:00.000Z'),
    });

    await expect(
      resolveOnboardingAccess({
        identityStorage: createStorage(readyIdentity(account)),
        profileStorage,
        homeClient,
      }),
    ).resolves.toEqual({ status: 'complete', profile });
  });

  it('blocks a profile copied from a different account', async () => {
    const profileStorage = createStorage(null);
    await persistCompletedOnboarding({ storage: profileStorage, account: otherAccount });

    await expect(
      resolveOnboardingAccess({
        identityStorage: createStorage(readyIdentity(account)),
        profileStorage,
        homeClient,
      }),
    ).resolves.toEqual({
      status: 'blocked',
      message: 'The onboarding profile belongs to a different Smart Account',
    });
  });

  it('rejects malformed completion data', async () => {
    const profileStorage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        account,
        username: 'someone-else.sodera.eth',
        claimMode: 'mock',
        completedAt: new Date().toISOString(),
      }),
    );

    await expect(readOnboardingProfile(profileStorage)).rejects.toThrow(
      'Onboarding profile is invalid',
    );
  });

  it('returns existing profiles to Home setup until Sodera is selected', async () => {
    const profileStorage = createStorage(null);
    const profile = await persistCompletedOnboarding({ storage: profileStorage, account });
    await expect(resolveOnboardingAccess({
      identityStorage: createStorage(readyIdentity(account)),
      profileStorage,
      homeClient: { ...homeClient, isDefaultHome: async () => false },
    })).resolves.toEqual({ status: 'home', profile });
  });

  it('persists an explicitly mocked fixed-name claim', async () => {
    const storage = createStorage(null);
    const profile = await persistCompletedOnboarding({
      storage,
      account,
      now: () => new Date('2026-09-13T00:00:00.000Z'),
    });

    expect(profile).toEqual({
      schemaVersion: 1,
      account,
      username: SODERA_FIXTURE_USERNAME,
      claimMode: 'mock',
      completedAt: '2026-09-13T00:00:00.000Z',
    });
    await expect(readOnboardingProfile(storage)).resolves.toEqual(profile);
  });
});

function readyIdentity(address: string) {
  return JSON.stringify({
    schemaVersion: 1,
    phase: 'accountDerived',
    pins: CURRENT_WALLET_IDENTITY_PINS,
    credential,
    account: address,
  });
}

function createStorage(initialValue: string | null): WalletIdentityStorage & OnboardingProfileStorage {
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
