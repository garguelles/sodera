import type { Address } from 'viem';

import {
  CURRENT_WALLET_IDENTITY_PINS,
  createWalletIdentityClient,
  type WalletIdentityStorage,
} from './wallet-identity';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from './passkey-ceremony';

const credential: RegisteredPrimaryPasskey = {
  id: 'MDEyMzQ1Njc4OQ',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  authenticatorAttachment: 'platform',
};
const account = '0x1111111111111111111111111111111111111111' as Address;

describe('WalletIdentityClient', () => {
  it('persists creation progress before registration and the derived Wallet Identity afterward', async () => {
    const storage = createStorage();
    const ceremonyClient = createCeremonyClient();
    const deriveAccount = jest.fn().mockImplementation(async () => {
      expect(JSON.parse(storage.value!)).toMatchObject({ phase: 'credentialRegistered' });
      return { address: account, deployed: false };
    });
    const client = createWalletIdentityClient({ storage, ceremonyClient, deriveAccount });

    const result = await client.create();

    expect(result).toMatchObject({ status: 'ready', account, deployed: false, credential });
    expect(storage.writes.map((value) => JSON.parse(value).phase)).toEqual([
      'registering',
      'credentialRegistered',
      'accountDerived',
    ]);
    expect(JSON.parse(storage.value!)).toEqual({
      schemaVersion: 1,
      phase: 'accountDerived',
      pins: CURRENT_WALLET_IDENTITY_PINS,
      credential,
      account,
    });
    expect(ceremonyClient.acknowledgePrimaryPasskeyRegistration).toHaveBeenCalledTimes(1);
  });

  it('resumes a journaled registration without starting another Primary Passkey registration', async () => {
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        phase: 'registering',
        pins: CURRENT_WALLET_IDENTITY_PINS,
      }),
    );
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.resumePrimaryPasskeyRegistration.mockResolvedValue({ ok: true, credential });
    const client = createWalletIdentityClient({
      storage,
      ceremonyClient,
      deriveAccount: jest.fn().mockResolvedValue({ address: account, deployed: false }),
    });

    await expect(client.reopen()).resolves.toMatchObject({ status: 'ready', account });
    expect(ceremonyClient.registerPrimaryPasskey).not.toHaveBeenCalled();
    expect(ceremonyClient.resumePrimaryPasskeyRegistration).toHaveBeenCalledTimes(1);
  });

  it('resumes after interruption between native registration and credential metadata persistence', async () => {
    const storage = createStorage();
    const write = storage.write.bind(storage);
    let interrupt = true;
    storage.write = async (value) => {
      if (interrupt && JSON.parse(value).phase === 'credentialRegistered') {
        interrupt = false;
        throw new Error('process interrupted');
      }
      await write(value);
    };
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.resumePrimaryPasskeyRegistration.mockResolvedValue({ ok: true, credential });
    const client = createWalletIdentityClient({
      storage,
      ceremonyClient,
      deriveAccount: jest.fn().mockResolvedValue({ address: account, deployed: false }),
    });

    await expect(client.create()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'storageUnavailable',
    });
    expect(JSON.parse(storage.value!)).toMatchObject({ phase: 'registering' });

    await expect(client.reopen()).resolves.toMatchObject({ status: 'ready', account });
    expect(ceremonyClient.registerPrimaryPasskey).toHaveBeenCalledTimes(1);
    expect(ceremonyClient.resumePrimaryPasskeyRegistration).toHaveBeenCalledTimes(1);
  });

  it('clears a pre-registration marker when restart proves no native request started', async () => {
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        phase: 'registering',
        pins: CURRENT_WALLET_IDENTITY_PINS,
      }),
    );
    const client = createWalletIdentityClient({
      storage,
      ceremonyClient: createCeremonyClient(),
      deriveAccount: jest.fn(),
    });

    await expect(client.reopen()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'registrationInterrupted',
      message: expect.stringContaining('safe to retry'),
    });
    expect(storage.value).toBeNull();
  });

  it('reconstructs and verifies the same Smart Account on reopening', async () => {
    const storage = createStorage(manifest('accountDerived'));
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.verifyPrimaryPasskey.mockResolvedValue({ ok: true });
    const deriveAccount = jest.fn().mockResolvedValue({ address: account, deployed: true });
    const client = createWalletIdentityClient({ storage, ceremonyClient, deriveAccount });

    await expect(client.reopen()).resolves.toEqual({
      status: 'ready',
      credential,
      account,
      deployed: true,
    });
    expect(ceremonyClient.verifyPrimaryPasskey).toHaveBeenCalledWith(credential);
    expect(JSON.parse(storage.value!)).toMatchObject({ phase: 'accountDeployed', account });
  });

  it('reopens an already deployed account after restart without changing its pins or address', async () => {
    const storage = createStorage(manifest('accountDeployed'));
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.verifyPrimaryPasskey.mockResolvedValue({ ok: true });
    const client = createWalletIdentityClient({
      storage,
      ceremonyClient,
      deriveAccount: jest.fn().mockResolvedValue({ address: account, deployed: true }),
    });

    await expect(client.reopen()).resolves.toMatchObject({ status: 'ready', account, deployed: true });
    expect(JSON.parse(storage.value!)).toEqual({
      schemaVersion: 1,
      phase: 'accountDeployed',
      pins: CURRENT_WALLET_IDENTITY_PINS,
      credential,
      account,
    });
  });

  it('does not start creation when any Wallet Identity phase already exists', async () => {
    const ceremonyClient = createCeremonyClient();
    const client = createWalletIdentityClient({
      storage: createStorage(manifest('accountDerived')),
      ceremonyClient,
      deriveAccount: jest.fn(),
    });

    await expect(client.create()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'metadataMismatch',
    });
    expect(ceremonyClient.registerPrimaryPasskey).not.toHaveBeenCalled();
  });

  it('offers Recover Wallet when the persisted Primary Passkey is missing', async () => {
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.verifyPrimaryPasskey.mockResolvedValue({
      ok: false,
      error: { kind: 'noCredential' },
    });
    const deriveAccount = jest.fn();
    const client = createWalletIdentityClient({
      storage: createStorage(manifest('accountDerived')),
      ceremonyClient,
      deriveAccount,
    });

    await expect(client.reopen()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'missingCredential',
      recoverWallet: true,
    });
    expect(deriveAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['providerConfiguration', 'providerFailure'],
    ['unsupported', 'unsupportedPlatform'],
  ] as const)('reports %s distinctly during wallet creation', async (kind, reason) => {
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.registerPrimaryPasskey.mockResolvedValue({ ok: false, error: { kind } });
    const client = createWalletIdentityClient({
      storage: createStorage(),
      ceremonyClient,
      deriveAccount: jest.fn(),
    });

    await expect(client.create()).resolves.toMatchObject({ status: 'blocked', reason });
  });

  it('clears pre-registration progress when no native registration request was journaled', async () => {
    const storage = createStorage();
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.registerPrimaryPasskey.mockResolvedValue({
      ok: false,
      error: { kind: 'unknown', message: 'Secure randomness is unavailable' },
    });
    ceremonyClient.hasPendingPrimaryPasskeyRegistration.mockResolvedValue(false);
    const client = createWalletIdentityClient({
      storage,
      ceremonyClient,
      deriveAccount: jest.fn(),
    });

    await expect(client.create()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'credentialFailure',
    });
    expect(storage.value).toBeNull();
  });

  it('reports an RP or origin mismatch distinctly', async () => {
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.verifyPrimaryPasskey.mockResolvedValue({
      ok: false,
      error: { kind: 'domError', domError: 'androidx.credentials.TYPE_SECURITY_ERROR' },
    });
    const client = createWalletIdentityClient({
      storage: createStorage(manifest('accountDerived')),
      ceremonyClient,
      deriveAccount: jest.fn(),
    });

    await expect(client.reopen()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'rpOriginMismatch',
    });
  });

  it('reports unavailable account infrastructure without changing persisted metadata', async () => {
    const stored = manifest('accountDerived');
    const storage = createStorage(stored);
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.verifyPrimaryPasskey.mockResolvedValue({ ok: true });
    const client = createWalletIdentityClient({
      storage,
      ceremonyClient,
      deriveAccount: jest.fn().mockRejectedValue(new Error('Bundler unavailable')),
    });

    await expect(client.reopen()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'infrastructureUnavailable',
    });
    expect(storage.value).toBe(stored);
  });

  it('rejects an application update that changes pinned account metadata', async () => {
    const stored = JSON.parse(manifest('accountDerived'));
    stored.pins.kernelVersion = 'future-default';
    const ceremonyClient = createCeremonyClient();
    const deriveAccount = jest.fn();
    const client = createWalletIdentityClient({
      storage: createStorage(JSON.stringify(stored)),
      ceremonyClient,
      deriveAccount,
    });

    await expect(client.reopen()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'unsupportedPinnedVersions',
    });
    expect(ceremonyClient.verifyPrimaryPasskey).not.toHaveBeenCalled();
    expect(deriveAccount).not.toHaveBeenCalled();
  });

  it('rejects reconstructed account metadata that changes the Wallet Identity', async () => {
    const ceremonyClient = createCeremonyClient();
    ceremonyClient.verifyPrimaryPasskey.mockResolvedValue({ ok: true });
    const client = createWalletIdentityClient({
      storage: createStorage(manifest('accountDerived')),
      ceremonyClient,
      deriveAccount: jest.fn().mockResolvedValue({
        address: '0x2222222222222222222222222222222222222222',
        deployed: false,
      }),
    });

    await expect(client.reopen()).resolves.toMatchObject({
      status: 'blocked',
      reason: 'metadataMismatch',
    });
  });

  it('records deployment without changing the persisted Wallet Identity', async () => {
    const storage = createStorage(manifest('accountDerived'));
    const client = createWalletIdentityClient({
      storage,
      ceremonyClient: createCeremonyClient(),
      deriveAccount: jest.fn(),
    });

    await client.markDeployed(account);

    expect(JSON.parse(storage.value!)).toMatchObject({
      phase: 'accountDeployed',
      account,
      credential,
      pins: CURRENT_WALLET_IDENTITY_PINS,
    });
  });
});

function manifest(phase: 'accountDerived' | 'accountDeployed') {
  return JSON.stringify({
    schemaVersion: 1,
    phase,
    pins: CURRENT_WALLET_IDENTITY_PINS,
    credential,
    account,
  });
}

function createStorage(initialValue: string | null = null): WalletIdentityStorage & {
  value: string | null;
  writes: string[];
} {
  return {
    value: initialValue,
    writes: [],
    async read() {
      return this.value;
    },
    async write(value) {
      this.value = value;
      this.writes.push(value);
    },
    async clear() {
      this.value = null;
    },
  };
}

function createCeremonyClient(): jest.Mocked<PasskeyCeremonyClient> {
  return {
    registerPrimaryPasskey: jest.fn().mockImplementation(async () => ({ ok: true, credential })),
    resumePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(null),
    hasPendingPrimaryPasskeyRegistration: jest.fn().mockResolvedValue(true),
    acknowledgePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(undefined),
    authenticatePrimaryPasskey: jest.fn(),
    verifyPrimaryPasskey: jest.fn(),
    cancelPending: jest.fn(),
  };
}
