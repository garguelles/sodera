import {
  b64ToBytes,
  base64FromUint8Array,
  uint8ArrayToHexString,
  type WebAuthnKey,
} from '@zerodev/webauthn-key';
import { hexToBytes, isHex, keccak256, size, type Hex, type SignableMessage } from 'viem';

import { SEPOLIA_CHAIN_ID } from './kernel-webauthn';
import {
  PASSKEY_RP_ID,
  type PasskeyCeremonyClient,
  type RegisteredPrimaryPasskey,
} from './passkey-ceremony';

export type PrimaryPasskeyAssertionEvidence = {
  userOperationHash: Hex;
  challenge: string;
  authenticatorData: string;
  clientDataJSON: string;
  validatorEnvelope: Hex;
  origin: string;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
};

export function createPrimaryPasskeyWebAuthnKey({
  ceremonyClient,
  credential,
  onAssertion,
}: {
  ceremonyClient: PasskeyCeremonyClient;
  credential: RegisteredPrimaryPasskey;
  onAssertion?: (evidence: PrimaryPasskeyAssertionEvidence) => void;
}): WebAuthnKey {
  return {
    pubX: BigInt(credential.publicKeyX),
    pubY: BigInt(credential.publicKeyY),
    authenticatorId: credential.id,
    authenticatorIdHash: keccak256(uint8ArrayToHexString(b64ToBytes(credential.id))),
    rpID: PASSKEY_RP_ID,
    async signMessageCallback(message, rpId, chainId, allowCredentials) {
      assertSigningContext(message, credential, rpId, chainId, allowCredentials);
      const userOperationHash = rawMessageHex(message);
      const challenge = base64FromUint8Array(hexToBytes(userOperationHash), true);
      const result = await ceremonyClient.authenticatePrimaryPasskey({ challenge, credential });

      if (!result.ok) {
        throw new Error(
          ['Primary Passkey authorization failed', result.error.kind, result.error.message]
            .filter(Boolean)
            .join(': '),
        );
      }

      onAssertion?.({
        userOperationHash,
        challenge,
        authenticatorData: result.assertion.authenticatorData,
        clientDataJSON: result.assertion.clientDataJSON,
        validatorEnvelope: result.assertion.validatorEnvelope,
        origin: result.assertion.origin,
        userPresent: result.assertion.userPresent,
        userVerified: result.assertion.userVerified,
        signCount: result.assertion.signCount,
      });
      return result.assertion.validatorEnvelope;
    },
  };
}

function assertSigningContext(
  message: SignableMessage,
  credential: RegisteredPrimaryPasskey,
  rpId: string,
  chainId: number,
  allowCredentials?: readonly { id: string; type: string }[],
) {
  if (rpId !== PASSKEY_RP_ID) throw new Error(`Refusing unexpected passkey RP ID: ${rpId}`);
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`Refusing unexpected signing chain: ${chainId}`);
  }
  if (
    allowCredentials?.length !== 1 ||
    allowCredentials[0].type !== 'public-key' ||
    allowCredentials[0].id !== credential.id
  ) {
    throw new Error('Refusing a signing request not pinned to the Primary Passkey');
  }
  rawMessageHex(message);
}

function rawMessageHex(message: SignableMessage): Hex {
  const raw = typeof message === 'string' ? message : message.raw;
  const hex = raw instanceof Uint8Array ? uint8ArrayToHexString(raw) : raw;
  if (!isHex(hex) || size(hex) !== 32) {
    throw new Error('Primary Passkey can only authorize a 32-byte UserOperation hash');
  }
  return hex;
}
