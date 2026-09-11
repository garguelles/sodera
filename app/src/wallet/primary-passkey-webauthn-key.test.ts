import type { SignableMessage } from 'viem';

import { createPrimaryPasskeyWebAuthnKey } from './primary-passkey-webauthn-key';
import type { PasskeyCeremonyClient, RegisteredPrimaryPasskey } from './passkey-ceremony';

const credential: RegisteredPrimaryPasskey = {
  id: 'MDEyMzQ1Njc4OQ',
  publicKeyX: '0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296',
  publicKeyY: '0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:test',
  authenticatorAttachment: 'platform',
};
const hash = `0x${'11'.repeat(32)}` as const;
const validatorEnvelope = `0x${'22'.repeat(32)}` as const;

describe('Primary Passkey WebAuthn key', () => {
  it('authorizes the exact SDK hash through the pinned native credential', async () => {
    const ceremonyClient = createCeremonyClient();
    const onAssertion = jest.fn();
    const key = createPrimaryPasskeyWebAuthnKey({ ceremonyClient, credential, onAssertion });

    await expect(
      key.signMessageCallback?.(
        { raw: hash },
        'sodera.xyz',
        11155111,
        [{ id: credential.id, type: 'public-key' }],
      ),
    ).resolves.toBe(validatorEnvelope);
    expect(ceremonyClient.authenticatePrimaryPasskey).toHaveBeenCalledWith({
      challenge: 'ERERERERERERERERERERERERERERERERERERERERERE',
      credential,
    });
    expect(onAssertion).toHaveBeenCalledWith(
      expect.objectContaining({ userOperationHash: hash, validatorEnvelope }),
    );
  });

  it.each([
    ['another RP', { message: { raw: hash }, rpId: 'evil.example', chainId: 11155111 }],
    ['another chain', { message: { raw: hash }, rpId: 'sodera.xyz', chainId: 1 }],
    ['a non-hash message', { message: { raw: '0x1234' }, rpId: 'sodera.xyz', chainId: 11155111 }],
  ])('rejects %s before opening Credential Manager', async (_name, context) => {
    const ceremonyClient = createCeremonyClient();
    const key = createPrimaryPasskeyWebAuthnKey({ ceremonyClient, credential });

    await expect(
      key.signMessageCallback?.(
        context.message as SignableMessage,
        context.rpId,
        context.chainId,
        [{ id: credential.id, type: 'public-key' }],
      ),
    ).rejects.toThrow();
    expect(ceremonyClient.authenticatePrimaryPasskey).not.toHaveBeenCalled();
  });

  it('rejects an SDK request for another credential', async () => {
    const ceremonyClient = createCeremonyClient();
    const key = createPrimaryPasskeyWebAuthnKey({ ceremonyClient, credential });

    await expect(
      key.signMessageCallback?.(
        { raw: hash },
        'sodera.xyz',
        11155111,
        [{ id: 'another-credential', type: 'public-key' }],
      ),
    ).rejects.toThrow('not pinned to the Primary Passkey');
    expect(ceremonyClient.authenticatePrimaryPasskey).not.toHaveBeenCalled();
  });
});

function createCeremonyClient(): PasskeyCeremonyClient {
  return {
    registerPrimaryPasskey: jest.fn(),
    resumePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(null),
    hasPendingPrimaryPasskeyRegistration: jest.fn().mockResolvedValue(true),
    acknowledgePrimaryPasskeyRegistration: jest.fn().mockResolvedValue(undefined),
    authenticatePrimaryPasskey: jest.fn().mockResolvedValue({
      ok: true,
      assertion: {
        credentialId: credential.id,
        authenticatorData: 'authenticator-data',
        clientDataJSON: 'client-data',
        signature: 'der-signature',
        validatorEnvelope,
        origin: credential.origin,
        userPresent: true,
        userVerified: true,
        signCount: 1,
      },
    }),
    verifyPrimaryPasskey: jest.fn(),
    cancelPending: jest.fn(),
  };
}
