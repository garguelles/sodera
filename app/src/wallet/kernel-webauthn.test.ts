import {
  PasskeyValidatorContractVersion,
  getValidatorAddress,
} from '@zerodev/passkey-validator';
import { getEntryPoint, KERNEL_V3_3, KernelVersionToAddressesMap } from '@zerodev/sdk/constants';
import { base64FromUint8Array } from '@zerodev/webauthn-key';
import { decodeAbiParameters, hexToBytes } from 'viem';
import type { UserOperation } from 'viem/account-abstraction';

import { createPasskeyChallenge, encodePasskeyAssertion } from './kernel-webauthn';

const userOperation: UserOperation<'0.7'> = {
  sender: '0x1111111111111111111111111111111111111111',
  nonce: 7n,
  factory: '0x2222222222222222222222222222222222222222',
  factoryData: '0x1234',
  callData: '0xabcdef',
  callGasLimit: 100_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  paymaster: '0x3333333333333333333333333333333333333333',
  paymasterVerificationGasLimit: 30_000n,
  paymasterPostOpGasLimit: 20_000n,
  paymasterData: '0x5678',
  signature: '0xdeadbeef',
};

describe('Kernel WebAuthn compatibility', () => {
  it('derives the raw EntryPoint 0.7 UserOperation hash challenge', () => {
    expect(createPasskeyChallenge(userOperation)).toEqual({
      userOperationHash: '0xbab293cced41f18673c7b5becfdaef2e71eec57d73af9388e3a241d5fb007509',
      challenge: 'urKTzO1B8YZzx7W-z9rvLnHuxX1zr5OI46JB1fsAdQk',
    });
  });

  it.each([
    ['nonce', { nonce: 8n }],
    ['sender', { sender: '0x1111111111111111111111111111111111111112' }],
    ['factory', { factory: '0x2222222222222222222222222222222222222223' }],
    ['factory data', { factoryData: '0x1235' }],
    ['call data', { callData: '0xabcdee' }],
    ['call gas', { callGasLimit: 100_001n }],
    ['verification gas', { verificationGasLimit: 200_001n }],
    ['pre-verification gas', { preVerificationGas: 50_001n }],
    ['max fee', { maxFeePerGas: 2_000_000_001n }],
    ['priority fee', { maxPriorityFeePerGas: 1_000_000_001n }],
    ['paymaster', { paymaster: '0x3333333333333333333333333333333333333334' }],
    ['paymaster verification gas', { paymasterVerificationGasLimit: 30_001n }],
    ['paymaster post-op gas', { paymasterPostOpGasLimit: 20_001n }],
    ['paymaster data', { paymasterData: '0x5679' }],
  ] as const)('binds the challenge to %s', (_name, mutation) => {
    const original = createPasskeyChallenge(userOperation).userOperationHash;
    const mutated = createPasskeyChallenge({ ...userOperation, ...mutation }).userOperationHash;

    expect(mutated).not.toBe(original);
  });

  it('excludes the placeholder signature from the challenge', () => {
    const original = createPasskeyChallenge(userOperation).userOperationHash;
    const mutated = createPasskeyChallenge({ ...userOperation, signature: '0x1234' }).userOperationHash;

    expect(mutated).toBe(original);
  });

  it('pins the patched validator and Kernel 0.3.3 deployment set', () => {
    const entryPoint = getEntryPoint('0.7');

    expect(entryPoint.address).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
    expect(KernelVersionToAddressesMap[KERNEL_V3_3]).toMatchObject({
      accountImplementationAddress: '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28',
      factoryAddress: '0x2577507b78c2008Ff367261CB6285d44ba5eF2E9',
    });
    expect(
      getValidatorAddress(
        entryPoint,
        KERNEL_V3_3,
        PasskeyValidatorContractVersion.V0_0_3_PATCHED,
      ),
    ).toBe('0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69');
  });

  it('encodes the native assertion with low-s normalization for Sepolia', () => {
    const clientDataJSON =
      '{"type":"webauthn.get","challenge":"urKTzO1B8YZzx7W-z9rvLnHuxX1zr5OI46JB1fsAdQk","origin":"https://wallet.sodera.eth","crossOrigin":false}';
    const authenticatorBytes = Uint8Array.from([
      ...new Array(32).fill(0x11),
      0x05,
      0x00,
      0x00,
      0x00,
      0x01,
    ]);
    const highSSignature = hexToBytes(
      '0x3026020101022100ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550',
    );

    const encoded = encodePasskeyAssertion({
      authenticatorData: base64FromUint8Array(authenticatorBytes, true),
      clientDataJSON: base64FromUint8Array(new TextEncoder().encode(clientDataJSON), true),
      signature: base64FromUint8Array(highSSignature, true),
    });
    const decoded = decodeAbiParameters(
      [
        { name: 'authenticatorData', type: 'bytes' },
        { name: 'clientDataJSON', type: 'string' },
        { name: 'responseTypeLocation', type: 'uint256' },
        { name: 'r', type: 'uint256' },
        { name: 's', type: 'uint256' },
        { name: 'usePrecompiled', type: 'bool' },
      ],
      encoded,
    );

    expect(decoded).toEqual([
      `0x${'11'.repeat(32)}0500000001`,
      clientDataJSON,
      1n,
      1n,
      1n,
      true,
    ]);
  });

  it('rejects client data without the WebAuthn response type', () => {
    expect(() =>
      encodePasskeyAssertion({
        authenticatorData: 'AA',
        clientDataJSON: base64FromUint8Array(
          new TextEncoder().encode('{"challenge":"wrong-shape"}'),
          true,
        ),
        signature: 'MAYCAQECAQI',
      }),
    ).toThrow('clientDataJSON does not contain the WebAuthn response type');
  });

  it('rejects a malformed DER signature before ABI encoding', () => {
    const clientDataJSON =
      '{"type":"webauthn.get","challenge":"urKTzO1B8YZzx7W-z9rvLnHuxX1zr5OI46JB1fsAdQk"}';

    expect(() =>
      encodePasskeyAssertion({
        authenticatorData: 'AA',
        clientDataJSON: base64FromUint8Array(new TextEncoder().encode(clientDataJSON), true),
        signature: 'AA',
      }),
    ).toThrow();
  });
});
