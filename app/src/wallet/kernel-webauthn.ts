import {
  b64ToBytes,
  base64FromUint8Array,
  findQuoteIndices,
  hexStringToUint8Array,
  isRIP7212SupportedNetwork,
  parseAndNormalizeSig,
  uint8ArrayToHexString,
} from '@zerodev/webauthn-key';
import { encodeAbiParameters, type Hash, type Hex } from 'viem';
import { type UserOperation, getUserOperationHash } from 'viem/account-abstraction';

export const SEPOLIA_CHAIN_ID = 11155111;
export const ENTRY_POINT_V0_7_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

export type NativePasskeyAssertion = {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
};

export function createPasskeyChallenge(userOperation: UserOperation<'0.7'>): {
  userOperationHash: Hash;
  challenge: string;
} {
  const userOperationHash = getUserOperationHash({
    userOperation: { ...userOperation, signature: '0x' },
    entryPointAddress: ENTRY_POINT_V0_7_ADDRESS,
    entryPointVersion: '0.7',
    chainId: SEPOLIA_CHAIN_ID,
  });

  return {
    userOperationHash,
    challenge: base64FromUint8Array(hexStringToUint8Array(userOperationHash), true),
  };
}

export function encodePasskeyAssertion(assertion: NativePasskeyAssertion): Hex {
  const authenticatorData = uint8ArrayToHexString(b64ToBytes(assertion.authenticatorData));
  const clientDataJSON = new TextDecoder().decode(b64ToBytes(assertion.clientDataJSON));
  const { beforeType: responseTypeLocation } = findQuoteIndices(clientDataJSON);

  if (responseTypeLocation < 0n) {
    throw new Error('clientDataJSON does not contain the WebAuthn response type');
  }

  const derSignature = uint8ArrayToHexString(b64ToBytes(assertion.signature));
  const { r, s } = parseAndNormalizeSig(derSignature);

  return encodeAbiParameters(
    [
      { name: 'authenticatorData', type: 'bytes' },
      { name: 'clientDataJSON', type: 'string' },
      { name: 'responseTypeLocation', type: 'uint256' },
      { name: 'r', type: 'uint256' },
      { name: 's', type: 'uint256' },
      { name: 'usePrecompiled', type: 'bool' },
    ],
    [
      authenticatorData,
      clientDataJSON,
      responseTypeLocation,
      r,
      s,
      isRIP7212SupportedNetwork(SEPOLIA_CHAIN_ID),
    ],
  );
}
