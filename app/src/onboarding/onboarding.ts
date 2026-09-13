import { isAddress, type Address } from 'viem';

import {
  inspectPersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';

export const SODERA_FIXTURE_USERNAME = 'anon.sodera.eth';

export type OnboardingProfile = {
  schemaVersion: 1;
  account: Address;
  username: typeof SODERA_FIXTURE_USERNAME;
  claimMode: 'mock';
  completedAt: string;
};

export type OnboardingProfileStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

export type UsernameClaimClient = {
  claim(parameters: {
    account: Address;
    username: typeof SODERA_FIXTURE_USERNAME;
  }): Promise<void>;
};

export type OnboardingAccess =
  | { status: 'incomplete' }
  | { status: 'complete'; profile: OnboardingProfile }
  | { status: 'blocked'; message: string };

export async function resolveOnboardingAccess({
  identityStorage,
  profileStorage,
}: {
  identityStorage: WalletIdentityStorage;
  profileStorage: OnboardingProfileStorage;
}): Promise<OnboardingAccess> {
  const [identityState, profile] = await Promise.all([
    inspectPersistedWalletIdentity(identityStorage),
    readOnboardingProfile(profileStorage),
  ]);
  if (identityState.status === 'missing' || identityState.status === 'incomplete') {
    if (profile) {
      return {
        status: 'blocked',
        message: 'An onboarding profile exists without its complete Wallet Identity',
      };
    }
    return { status: 'incomplete' };
  }
  if (identityState.status === 'blocked') return identityState;

  if (!profile) return { status: 'incomplete' };
  if (profile.account.toLowerCase() !== identityState.identity.account.toLowerCase()) {
    return {
      status: 'blocked',
      message: 'The onboarding profile belongs to a different Smart Account',
    };
  }
  return { status: 'complete', profile };
}

export async function persistCompletedOnboarding({
  storage,
  account,
  now = () => new Date(),
}: {
  storage: OnboardingProfileStorage;
  account: Address;
  now?: () => Date;
}): Promise<OnboardingProfile> {
  const profile: OnboardingProfile = {
    schemaVersion: 1,
    account,
    username: SODERA_FIXTURE_USERNAME,
    claimMode: 'mock',
    completedAt: now().toISOString(),
  };
  await storage.write(JSON.stringify(profile));
  return profile;
}

export async function readOnboardingProfile(
  storage: OnboardingProfileStorage,
): Promise<OnboardingProfile | null> {
  const value = await storage.read();
  if (!value) return null;

  let candidate: Partial<OnboardingProfile>;
  try {
    candidate = JSON.parse(value) as Partial<OnboardingProfile>;
  } catch {
    throw new Error('Onboarding profile is corrupt');
  }
  if (
    candidate.schemaVersion !== 1 ||
    !candidate.account ||
    !isAddress(candidate.account) ||
    candidate.username !== SODERA_FIXTURE_USERNAME ||
    candidate.claimMode !== 'mock' ||
    typeof candidate.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.completedAt))
  ) {
    throw new Error('Onboarding profile is invalid');
  }
  return candidate as OnboardingProfile;
}

export const mockUsernameClaimClient: UsernameClaimClient = {
  async claim() {
    await new Promise((resolve) => setTimeout(resolve, 500));
  },
};
