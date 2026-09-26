import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import type { Address, Hash } from 'viem';
import type { PasskeyProof } from '../ens/webauthn-proof.ts';
import { deriveClaimChallenge } from '../ens/challenge-digest.ts';

import type { ClaimRecord, ClaimStatus } from '../ens/claim-store.ts';
import { fromRow, type ClaimRow } from '../ens/postgres-claim-store.ts';

export type LeasedClaim = { claim: ClaimRecord; leaseId: string };
export type ClaimCheckpoint = {
  status: ClaimStatus;
  resolver?: Address;
  resolverTx?: Hash;
  registrationTx?: Hash;
  expiresAt?: Date;
  errorCode?: string;
};
export type StoredClaimProof = { challenge: string; assertion: PasskeyProof };

export function createPostgresWorkQueue(pool: Pool) {
  return {
    async proof(claim: ClaimRecord): Promise<StoredClaimProof | null> {
      const result = await pool.query<{
        challenge: string; nonce: `0x${string}`; expires_at: Date;
        proof_authenticator_data: string;
        proof_client_data_json: string; proof_signature: string;
      }>(`
        SELECT c.challenge, c.nonce, c.expires_at,
          c.proof_authenticator_data, c.proof_client_data_json, c.proof_signature
        FROM ens_claim_challenges c JOIN ens_claims q ON q.id = c.claim_id
        WHERE q.id = $1 AND c.account = q.account AND c.label = q.label
          AND c.chain_id = q.chain_id AND c.registry = q.registry
          AND c.verified_at IS NOT NULL AND c.consumed_at IS NOT NULL
          AND c.nonce IS NOT NULL
          AND c.proof_authenticator_data IS NOT NULL AND c.proof_client_data_json IS NOT NULL
          AND c.proof_signature IS NOT NULL
        ORDER BY c.verified_at DESC LIMIT 1
      `, [claim.id]);
      const row = result.rows[0];
      if (row && deriveClaimChallenge({ chainId: claim.chainId, registry: claim.registry,
        account: claim.account, label: claim.label, expiresAt: row.expires_at,
        nonce: row.nonce }) !== row.challenge) {
        return null;
      }
      return row ? { challenge: row.challenge, assertion: {
        authenticatorData: row.proof_authenticator_data,
        clientDataJSON: row.proof_client_data_json,
        signature: row.proof_signature,
      } } : null;
    },
    async lease(): Promise<LeasedClaim | null> {
      const leaseId = randomUUID();
      const result = await pool.query<ClaimRow>(`
        UPDATE ens_claims
        SET lease_id = $1, lease_until = now() + interval '2 minutes', updated_at = now()
        WHERE id = (
          SELECT id FROM ens_claims
          WHERE status IN ('queued', 'resolver_submitted', 'resolver_ready', 'registration_submitted')
            AND (lease_until IS NULL OR lease_until < now())
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED LIMIT 1
        ) RETURNING *
      `, [leaseId]);
      return result.rows[0] ? { claim: fromRow(result.rows[0]), leaseId } : null;
    },
    async checkpoint({ claim, leaseId }: LeasedClaim, expected: ClaimStatus, next: ClaimCheckpoint) {
      const result = await pool.query<ClaimRow>(`
        UPDATE ens_claims SET status = $4, resolver = COALESCE($5, resolver),
          resolver_tx = COALESCE($6, resolver_tx), registration_tx = COALESCE($7, registration_tx),
          expires_at = COALESCE($8, expires_at), error_code = $9,
          lease_id = NULL, lease_until = NULL, updated_at = now()
        WHERE id = $1 AND lease_id = $2 AND status = $3
        RETURNING *
      `, [claim.id, leaseId, expected, next.status,
        next.resolver ?? null, next.resolverTx ?? null, next.registrationTx ?? null,
        next.expiresAt ?? null, next.errorCode ?? null]);
      if (!result.rows[0]) throw new Error('Claim lease or state changed during checkpoint');
      return fromRow(result.rows[0]);
    },
    async retry({ claim, leaseId }: LeasedClaim, errorCode: string) {
      const result = await pool.query(`
        UPDATE ens_claims SET lease_id = NULL,
          lease_until = now() + interval '30 seconds',
          error_code = $3, updated_at = now()
        WHERE id = $1 AND lease_id = $2
      `, [claim.id, leaseId, errorCode]);
      if (result.rowCount !== 1) throw new Error('Claim lease changed during retry');
    },
  };
}

export type WorkQueue = ReturnType<typeof createPostgresWorkQueue>;
