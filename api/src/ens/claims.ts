import { createHash, createHmac } from 'node:crypto';
import { keccak256, stringToHex, type Address } from 'viem';

import type { ClaimStore } from './claim-store.ts';
import { ENSV2 } from './contracts.ts';

export class IneligibleKernelError extends Error {}
export class IssuerUnavailableError extends Error {}

export function createClaims(store: ClaimStore, ipHashKey: string, isIssuerAuthorized: () => Promise<boolean>) {
  if (ipHashKey.length < 32) throw new Error('ENS_CHALLENGE_IP_KEY must be at least 32 characters');
  return {
    async submit({ account, label, name, claimToken, ip }: {
      account: Address; label: string; name: string; claimToken: string; ip: string;
    }) {
      if (account.toLowerCase() === ENSV2.publicTestKernel.toLowerCase()) {
        throw new IneligibleKernelError('Public synthetic test credentials cannot claim a name');
      }
      if (!(await isIssuerAuthorized())) throw new IssuerUnavailableError('ENS issuer is not authorized');
      return store.submit({
        account,
        label,
        name,
        labelhash: keccak256(stringToHex(label)),
        tokenHash: createHash('sha256').update(claimToken).digest('hex'),
        ipHash: createHmac('sha256', ipHashKey).update(ip).digest('hex'),
        now: new Date(),
      });
    },
    get: (id: string) => store.get(id),
  };
}

export type Claims = ReturnType<typeof createClaims>;
