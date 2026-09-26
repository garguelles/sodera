import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';

const CLAIM_DOMAIN = keccak256(stringToHex('sodera.eth claim proof v1'));

export function deriveClaimChallenge({ chainId, registry, account, label, expiresAt, nonce }: {
  chainId: 11155111;
  registry: Address;
  account: Address;
  label: string;
  expiresAt: Date;
  nonce: Hex;
}) {
  const hash = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' },
      { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes32' }],
    [CLAIM_DOMAIN, BigInt(chainId), registry, account, keccak256(stringToHex(label)),
      BigInt(expiresAt.getTime()), nonce],
  ));
  return Buffer.from(hash.slice(2), 'hex').toString('base64url');
}
