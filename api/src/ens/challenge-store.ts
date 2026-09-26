import type { Address } from 'viem';

export type StoredChallenge = {
  id: string;
  account: Address;
  label: string;
  chainId: 11155111;
  registry: Address;
  challenge: string;
  ipHash: string;
  createdAt: Date;
  expiresAt: Date;
};

export class ChallengeLimitError extends Error {}

export type ChallengeStore = {
  issue(value: StoredChallenge): Promise<void>;
  consume(input: {
    id: string; account: Address; label: string; chainId: 11155111; registry: Address; now: Date;
  }): Promise<string | null>;
  markVerified(input: { id: string; tokenHash: string; expiresAt: Date }): Promise<void>;
};
