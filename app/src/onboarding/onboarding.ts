import { isAddress, type Address } from 'viem';

import {
  inspectPersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { defaultHomeClient, type DefaultHomeClient } from '@/launcher/default-home';
import { parseSoderaUsername } from '@/ens/username';
import type { RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';

export const SODERA_FIXTURE_USERNAME = 'anon.sodera.eth';

export type MockOnboardingProfile = {
  schemaVersion: 1;
  account: Address;
  username: typeof SODERA_FIXTURE_USERNAME;
  claimMode: 'mock';
  completedAt: string;
};

export type EnsOnboardingProfile = {
  schemaVersion: 2;
  account: Address;
  username: string;
  claimMode: 'ens';
  claimId: string;
  completedAt: string;
};

export type OnboardingProfile = MockOnboardingProfile | EnsOnboardingProfile;

export type PendingEnsClaim = {
  schemaVersion: 2;
  phase: 'claimPending';
  account: Address;
  username: string;
  claimId: string;
};

export type OnboardingRecord = OnboardingProfile | PendingEnsClaim;

export type OnboardingProfileStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

export type UsernameClaimClient = {
  submit(parameters: { account: Address; credential: RegisteredPrimaryPasskey; label: string }): Promise<{ id: string; status: string; name: string }>;
  status(parameters: { id: string; account: Address; label: string }): Promise<{ status: string; name: string }>;
};

export type OnboardingAccess =
  | { status: 'incomplete'; wallet: 'missing' | 'resumable'; pending?: PendingEnsClaim }
  | { status: 'complete'; profile: OnboardingProfile }
  | { status: 'home'; profile: OnboardingProfile }
  | { status: 'blocked'; message: string };

export async function resolveOnboardingAccess({
  identityStorage,
  profileStorage,
  homeClient = defaultHomeClient,
}: {
  identityStorage: WalletIdentityStorage;
  profileStorage: OnboardingProfileStorage;
  homeClient?: DefaultHomeClient;
}): Promise<OnboardingAccess> {
  const [identityState, record] = await Promise.all([
    inspectPersistedWalletIdentity(identityStorage),
    readOnboardingRecord(profileStorage),
  ]);
  if (identityState.status === 'missing' || identityState.status === 'incomplete') {
    if (record) {
      return {
        status: 'blocked',
        message: identityState.status === 'missing'
          ? 'An onboarding profile exists without its Wallet Identity'
          : 'An onboarding profile exists without its complete Wallet Identity',
      };
    }
    return {
      status: 'incomplete',
      wallet: identityState.status === 'missing' ? 'missing' : 'resumable',
    };
  }
  if (identityState.status === 'blocked') return identityState;

  if (!record) return { status: 'incomplete', wallet: 'resumable' };
  if (record.account.toLowerCase() !== identityState.identity.account.toLowerCase()) {
    return {
      status: 'blocked',
      message: 'The onboarding profile belongs to a different Smart Account',
    };
  }
  if ('phase' in record) return { status: 'incomplete', wallet: 'resumable', pending: record };
  if (record.claimMode === 'mock') return { status: 'incomplete', wallet: 'resumable' };
  return (await homeClient.isDefaultHome())
    ? { status: 'complete', profile: record }
    : { status: 'home', profile: record };
}

export async function persistCompletedOnboarding({
  storage,
  account,
  name,
  claimId,
  now = () => new Date(),
}: {
  storage: OnboardingProfileStorage;
  account: Address;
  name: string;
  claimId: string;
  now?: () => Date;
}): Promise<OnboardingProfile> {
  const username = parseSoderaUsername(name.replace(/\.sodera\.eth$/, ''));
  if (username.name !== name || !CLAIM_ID_PATTERN.test(claimId)) throw new Error('Invalid confirmed ENS claim');
  const profile: EnsOnboardingProfile = {
    schemaVersion: 2,
    account,
    username: name,
    claimMode: 'ens',
    claimId,
    completedAt: now().toISOString(),
  };
  await storage.write(JSON.stringify(profile));
  return profile;
}

const CLAIM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function persistPendingEnsClaim(storage: OnboardingProfileStorage, claim: Omit<PendingEnsClaim, 'schemaVersion' | 'phase'>) {
  const username = parseSoderaUsername(claim.username.replace(/\.sodera\.eth$/, ''));
  if (username.name !== claim.username || !isAddress(claim.account) || !CLAIM_ID_PATTERN.test(claim.claimId)) {
    throw new Error('Invalid pending ENS claim');
  }
  const pending: PendingEnsClaim = { schemaVersion: 2, phase: 'claimPending', ...claim };
  await storage.write(JSON.stringify(pending));
  return pending;
}

export async function readOnboardingProfile(
  storage: Pick<OnboardingProfileStorage, 'read'>,
): Promise<OnboardingProfile | null> {
  const record = await readOnboardingRecord(storage);
  return record && !('phase' in record) ? record : null;
}

export async function readOnboardingRecord(storage: Pick<OnboardingProfileStorage, 'read'>): Promise<OnboardingRecord | null> {
  const value = await storage.read();
  if (!value) return null;

  let candidate: Partial<OnboardingRecord>;
  try {
    candidate = JSON.parse(value) as Partial<OnboardingRecord>;
  } catch {
    throw new Error('Onboarding profile is corrupt');
  }
  if (!candidate || typeof candidate !== 'object' || !candidate.account ||
    !isAddress(candidate.account) ||
    typeof candidate.username !== 'string') throw new Error('Onboarding profile is invalid');
  if (candidate.schemaVersion === 1 && candidate.username === SODERA_FIXTURE_USERNAME &&
    candidate.claimMode === 'mock' && typeof candidate.completedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.completedAt))) return candidate as MockOnboardingProfile;
  if (candidate.schemaVersion === 2) {
    try {
      if (parseSoderaUsername(candidate.username.replace(/\.sodera\.eth$/, '')).name === candidate.username &&
        typeof candidate.claimId === 'string' && CLAIM_ID_PATTERN.test(candidate.claimId)) {
        if ('phase' in candidate && candidate.phase === 'claimPending') return candidate as PendingEnsClaim;
        if ('claimMode' in candidate && candidate.claimMode === 'ens' &&
          typeof candidate.completedAt === 'string' && Number.isFinite(Date.parse(candidate.completedAt))) {
          return candidate as EnsOnboardingProfile;
        }
      }
    } catch {
      throw new Error('Onboarding profile is invalid');
    }
  }
  throw new Error('Onboarding profile is invalid');
}
