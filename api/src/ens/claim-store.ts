import type { Address, Hash } from 'viem';

export type ClaimStatus =
  | 'queued'
  | 'resolver_submitted'
  | 'resolver_ready'
  | 'registration_submitted'
  | 'confirmed'
  | 'needs_attention'
  | 'detached';

export type ClaimRecord = {
  id: string;
  chainId: 11155111;
  registry: Address;
  label: string;
  name: string;
  labelhash: Hash;
  account: Address;
  status: ClaimStatus;
  resolver: Address | null;
  resolverTx: Hash | null;
  registrationTx: Hash | null;
  expiresAt: string | null;
  errorCode: string | null;
};

export class InvalidClaimTokenError extends Error {}
export class ClaimConflictError extends Error {}

export type ClaimStore = {
  submit(input: {
    account: Address; label: string; name: string; labelhash: Hash;
    tokenHash: string; ipHash: string; now: Date;
  }): Promise<ClaimRecord>;
  get(id: string): Promise<ClaimRecord | null>;
};
