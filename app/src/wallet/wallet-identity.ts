import { KernelVersionToAddressesMap, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { isAddress, isHex, size, type Address } from 'viem';

import { ENTRY_POINT_V0_7_ADDRESS, SEPOLIA_CHAIN_ID } from './kernel-webauthn';
import {
  PASSKEY_VALIDATOR_ADDRESS,
  type KernelPasskeyExecutionClient,
} from './kernel-passkey-execution';
import {
  isAllowedPrimaryPasskeyOrigin,
  PASSKEY_RP_ID,
  type PasskeyCeremonyClient,
  type RegisteredPrimaryPasskey,
} from './passkey-ceremony';

export const CURRENT_WALLET_IDENTITY_PINS = Object.freeze({
  chainId: SEPOLIA_CHAIN_ID,
  entryPointVersion: '0.7',
  entryPointAddress: ENTRY_POINT_V0_7_ADDRESS,
  kernelVersion: '0.3.3',
  kernelFactoryAddress: KernelVersionToAddressesMap[KERNEL_V3_3].factoryAddress,
  kernelImplementationAddress: KernelVersionToAddressesMap[KERNEL_V3_3].accountImplementationAddress,
  validatorVersion: '0.0.3',
  validatorAddress: PASSKEY_VALIDATOR_ADDRESS,
  accountIndex: '0',
  rpId: PASSKEY_RP_ID,
  zeroDevSdkVersion: '5.5.10',
  zeroDevPasskeyValidatorPackageVersion: '5.6.0',
  zeroDevWebAuthnKeyPackageVersion: '5.5.0',
  viemVersion: '2.28.0',
} as const);

type WalletIdentityPins = typeof CURRENT_WALLET_IDENTITY_PINS;
type WalletIdentityPhase = 'registering' | 'credentialRegistered' | 'accountDerived' | 'accountDeployed';

export type WalletIdentityManifest = {
  schemaVersion: 1;
  phase: WalletIdentityPhase;
  pins: WalletIdentityPins;
  credential?: RegisteredPrimaryPasskey;
  account?: Address;
};

export type WalletIdentityStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
};

export type WalletIdentityResult =
  | {
      status: 'ready';
      credential: RegisteredPrimaryPasskey;
      account: Address;
      deployed: boolean;
      executionClient?: KernelPasskeyExecutionClient;
    }
  | {
      status: 'blocked';
      reason:
        | 'registrationInterrupted'
        | 'credentialFailure'
        | 'missingCredential'
        | 'providerFailure'
        | 'unsupportedPlatform'
        | 'metadataMismatch'
        | 'unsupportedPinnedVersions'
        | 'rpOriginMismatch'
        | 'infrastructureUnavailable'
        | 'storageUnavailable';
      message: string;
      recoverWallet: boolean;
    };

type AccountDerivation = (credential: RegisteredPrimaryPasskey) => Promise<{
  address: Address;
  deployed: boolean;
  executionClient?: KernelPasskeyExecutionClient;
}>;

export function createWalletIdentityClient({
  storage,
  ceremonyClient,
  deriveAccount,
}: {
  storage: WalletIdentityStorage;
  ceremonyClient: PasskeyCeremonyClient;
  deriveAccount: AccountDerivation;
}) {
  const persist = (manifest: WalletIdentityManifest) => storage.write(JSON.stringify(manifest));
  const storageFailure = (error: unknown) =>
    blocked(
      'storageUnavailable',
      error instanceof Error ? error.message : 'Wallet Identity metadata storage is unavailable',
    );

  const derive = async (
    registered: WalletIdentityManifest & { credential: RegisteredPrimaryPasskey },
  ): Promise<WalletIdentityResult> => {
    let derived: Awaited<ReturnType<AccountDerivation>>;
    try {
      derived = await deriveAccount(registered.credential);
    } catch (error) {
      return blocked(
        'infrastructureUnavailable',
        error instanceof Error ? error.message : 'Smart Account infrastructure is unavailable',
      );
    }
    if (registered.account && registered.account.toLowerCase() !== derived.address.toLowerCase()) {
      return blocked(
        'metadataMismatch',
        'The reconstructed Smart Account does not match the persisted Wallet Identity',
      );
    }
    if (registered.phase === 'accountDeployed' && !derived.deployed) {
      return blocked(
        'metadataMismatch',
        'The persisted deployed Smart Account is unavailable at its pinned address',
      );
    }
    try {
      await persist({
        ...registered,
        phase: derived.deployed ? 'accountDeployed' : 'accountDerived',
        account: derived.address,
      });
    } catch (error) {
      return storageFailure(error);
    }
    return {
      status: 'ready',
      credential: registered.credential,
      account: derived.address,
      deployed: derived.deployed,
      executionClient: derived.executionClient,
    };
  };

  const acceptRegistration = async (
    registering: WalletIdentityManifest,
    credential: RegisteredPrimaryPasskey,
  ) => {
    const registered = {
      ...registering,
      phase: 'credentialRegistered' as const,
      credential,
    };
    try {
      await persist(registered);
      await ceremonyClient.acknowledgePrimaryPasskeyRegistration();
    } catch (error) {
      return storageFailure(error);
    }
    return derive(registered);
  };

  return {
    async create(): Promise<WalletIdentityResult> {
      let existing: string | null;
      try {
        existing = await storage.read();
      } catch (error) {
        return storageFailure(error);
      }
      if (existing) {
        return blocked(
          'metadataMismatch',
          'Wallet creation cannot replace existing or partially initialized Wallet Identity metadata',
        );
      }

      const registering: WalletIdentityManifest = {
        schemaVersion: 1,
        phase: 'registering',
        pins: CURRENT_WALLET_IDENTITY_PINS,
      };
      try {
        await persist(registering);
      } catch (error) {
        return storageFailure(error);
      }

      const registration = await ceremonyClient.registerPrimaryPasskey({
        userName: 'sodera-wallet',
        userDisplayName: 'Sodera Wallet',
      });
      if (!registration.ok) {
        try {
          if (!(await ceremonyClient.hasPendingPrimaryPasskeyRegistration())) {
            await storage.clear();
          }
        } catch (error) {
          return storageFailure(error);
        }
        return ceremonyFailure(registration.error);
      }

      return acceptRegistration(registering, registration.credential);
    },
    async reopen(): Promise<WalletIdentityResult> {
      let loaded: ReturnType<typeof parseManifest>;
      try {
        loaded = parseManifest(await storage.read());
      } catch (error) {
        return storageFailure(error);
      }
      if (!loaded.ok) return loaded.result;
      const manifest = loaded.manifest;

      if (manifest.phase === 'registering') {
        const registration = await ceremonyClient.resumePrimaryPasskeyRegistration();
        if (!registration) {
          try {
            await storage.clear();
          } catch (error) {
            return storageFailure(error);
          }
          return blocked(
            'registrationInterrupted',
            'Primary Passkey registration did not start. It is safe to retry Create Wallet.',
          );
        }
        if (!registration.ok) return ceremonyFailure(registration.error);
        return acceptRegistration(manifest, registration.credential);
      }

      try {
        await ceremonyClient.acknowledgePrimaryPasskeyRegistration();
      } catch (error) {
        return storageFailure(error);
      }
      const verification = await ceremonyClient.verifyPrimaryPasskey(manifest.credential);
      if (!verification.ok) return ceremonyFailure(verification.error);
      return derive(manifest);
    },
    async markDeployed(account: Address): Promise<void> {
      const loaded = parseManifest(await storage.read());
      if (!loaded.ok || loaded.manifest.phase === 'registering' || !loaded.manifest.account) {
        throw new Error('Cannot record deployment without a derived Wallet Identity');
      }
      if (loaded.manifest.account.toLowerCase() !== account.toLowerCase()) {
        throw new Error('Cannot record deployment for a different Smart Account');
      }
      await persist({ ...loaded.manifest, phase: 'accountDeployed' });
    },
  };
}

function parseManifest(
  value: string | null,
):
  | { ok: true; manifest: WalletIdentityManifest & { credential: RegisteredPrimaryPasskey } }
  | { ok: true; manifest: WalletIdentityManifest & { phase: 'registering' } }
  | { ok: false; result: WalletIdentityResult } {
  if (!value) {
    return { ok: false, result: blocked('metadataMismatch', 'No Wallet Identity metadata exists') };
  }

  let candidate: Partial<WalletIdentityManifest>;
  try {
    candidate = JSON.parse(value) as Partial<WalletIdentityManifest>;
  } catch {
    return { ok: false, result: blocked('metadataMismatch', 'Wallet Identity metadata is corrupt') };
  }
  if (candidate.schemaVersion !== 1) {
    return {
      ok: false,
      result: blocked('unsupportedPinnedVersions', 'Wallet Identity metadata uses an unsupported schema'),
    };
  }
  if (JSON.stringify(candidate.pins) !== JSON.stringify(CURRENT_WALLET_IDENTITY_PINS)) {
    return {
      ok: false,
      result: blocked(
        'unsupportedPinnedVersions',
        'Persisted account implementation or validator pins do not match this application version',
      ),
    };
  }
  if (candidate.phase === 'registering') {
    return { ok: true, manifest: candidate as WalletIdentityManifest & { phase: 'registering' } };
  }
  if (
    candidate.phase !== 'credentialRegistered' &&
    candidate.phase !== 'accountDerived' &&
    candidate.phase !== 'accountDeployed'
  ) {
    return { ok: false, result: blocked('metadataMismatch', 'Wallet Identity phase is invalid') };
  }
  if (!isValidCredential(candidate.credential)) {
    return { ok: false, result: blocked('metadataMismatch', 'Primary Passkey metadata is invalid') };
  }
  if (!isAllowedPrimaryPasskeyOrigin(candidate.credential.origin)) {
    return {
      ok: false,
      result: blocked('rpOriginMismatch', 'Primary Passkey origin is not approved for Sodera'),
    };
  }
  if (
    candidate.phase !== 'credentialRegistered' &&
    (!candidate.account || !isAddress(candidate.account))
  ) {
    return { ok: false, result: blocked('metadataMismatch', 'Smart Account address is invalid') };
  }
  return {
    ok: true,
    manifest: candidate as WalletIdentityManifest & { credential: RegisteredPrimaryPasskey },
  };
}

function isValidCredential(value: unknown): value is RegisteredPrimaryPasskey {
  if (!value || typeof value !== 'object') return false;
  const credential = value as Partial<RegisteredPrimaryPasskey>;
  return (
    typeof credential.id === 'string' &&
    credential.id.length > 0 &&
    typeof credential.publicKeyX === 'string' &&
    isHex(credential.publicKeyX) &&
    size(credential.publicKeyX) === 32 &&
    typeof credential.publicKeyY === 'string' &&
    isHex(credential.publicKeyY) &&
    size(credential.publicKeyY) === 32 &&
    typeof credential.aaguid === 'string' &&
    isHex(credential.aaguid) &&
    size(credential.aaguid) === 16 &&
    typeof credential.origin === 'string' &&
    (typeof credential.authenticatorAttachment === 'string' ||
      credential.authenticatorAttachment === null)
  );
}

function ceremonyFailure(error: {
  kind: string;
  type?: string;
  domError?: string;
  message?: string;
}): WalletIdentityResult {
  if (
    (error.kind === 'invalidResponse' && /origin|RP ID/i.test(error.message ?? '')) ||
    (error.kind === 'domError' && /(SecurityError|TYPE_SECURITY_ERROR)$/.test(error.domError ?? ''))
  ) {
    return blocked(
      'rpOriginMismatch',
      error.message ?? 'The Primary Passkey RP or origin does not match Sodera',
    );
  }
  if (error.kind === 'noCredential') {
    return blocked('missingCredential', error.message ?? 'The Primary Passkey is unavailable', true);
  }
  if (error.kind === 'unsupported') {
    return blocked('unsupportedPlatform', error.message ?? 'This platform cannot use the Primary Passkey');
  }
  if (error.kind === 'providerConfiguration' || error.kind === 'noCreateOption') {
    return blocked('providerFailure', error.message ?? 'The credential provider is unavailable');
  }
  if (error.kind === 'domError' || error.kind === 'invalidResponse' || error.kind === 'unknown') {
    return blocked(
      'credentialFailure',
      error.message ??
        ['The Primary Passkey could not be validated', error.domError, error.type]
          .filter(Boolean)
          .join(': '),
    );
  }
  return blocked(
    'registrationInterrupted',
    error.message ?? 'Primary Passkey registration did not complete',
  );
}

function blocked(
  reason: Extract<WalletIdentityResult, { status: 'blocked' }>['reason'],
  message: string,
  recoverWallet = false,
): WalletIdentityResult {
  return { status: 'blocked', reason, message, recoverWallet };
}
