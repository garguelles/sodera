import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { getAddress, type Address, type Hash } from 'viem';

import { ENSV2 } from './contracts.ts';
import { ClaimConflictError, InvalidClaimTokenError, type ClaimRecord, type ClaimStatus, type ClaimStore } from './claim-store.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ens_claims (
  id uuid PRIMARY KEY,
  chain_id integer NOT NULL,
  registry text NOT NULL,
  label text NOT NULL,
  name text NOT NULL,
  labelhash text NOT NULL,
  account text NOT NULL,
  ip_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'resolver_submitted', 'resolver_ready', 'registration_submitted', 'confirmed', 'needs_attention', 'detached')),
  resolver text,
  resolver_tx text,
  registration_tx text,
  expires_at timestamptz,
  error_code text,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ens_claims_name_active_idx ON ens_claims (chain_id, registry, labelhash) WHERE status <> 'detached';
CREATE UNIQUE INDEX IF NOT EXISTS ens_claims_account_active_idx ON ens_claims (chain_id, registry, account) WHERE status <> 'detached';
CREATE INDEX IF NOT EXISTS ens_claims_created_idx ON ens_claims (created_at);
ALTER TABLE ens_claim_challenges ADD COLUMN IF NOT EXISTS claim_id uuid;
`;

export type ClaimRow = {
  id: string; chain_id: number; registry: string; label: string; name: string; labelhash: string;
  account: string; status: ClaimStatus; resolver: string | null; resolver_tx: string | null;
  registration_tx: string | null; expires_at: Date | null; error_code: string | null;
};

export function fromRow(row: ClaimRow): ClaimRecord {
  if (row.chain_id !== 11155111) throw new Error('Unexpected claim chain');
  return {
    id: row.id,
    chainId: 11155111,
    registry: getAddress(row.registry),
    label: row.label,
    name: row.name,
    labelhash: row.labelhash as Hash,
    account: getAddress(row.account),
    status: row.status,
    resolver: row.resolver ? getAddress(row.resolver) : null,
    resolverTx: row.resolver_tx as Hash | null,
    registrationTx: row.registration_tx as Hash | null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    errorCode: row.error_code,
  };
}

async function readClaim(connection: PoolClient, id: string) {
  const result = await connection.query<ClaimRow>('SELECT * FROM ens_claims WHERE id = $1', [id]);
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function createPostgresClaimStore(pool: Pool): Promise<ClaimStore> {
  await pool.query(SCHEMA);
  return {
    async submit({ account, label, name, labelhash, tokenHash, ipHash, now }) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query("SELECT pg_advisory_xact_lock(hashtext('sodera_ens_claims'))");
        const challenge = await connection.query<{
          claim_id: string | null; account: string; label: string; chain_id: number; registry: string;
          verified_at: Date | null; claim_token_expires_at: Date | null;
        }>(`SELECT claim_id, account, label, chain_id, registry, verified_at, claim_token_expires_at
          FROM ens_claim_challenges WHERE claim_token_hash = $1 FOR UPDATE`, [tokenHash]);
        const proof = challenge.rows[0];
        if (!proof || proof.account !== account.toLowerCase() || proof.label !== label ||
          proof.chain_id !== 11155111 || proof.registry !== ENSV2.child.toLowerCase() || !proof.verified_at) {
          throw new InvalidClaimTokenError('Claim proof is not valid for this wallet and label');
        }
        if (proof.claim_id) {
          const existing = await readClaim(connection, proof.claim_id);
          if (!existing) throw new Error('Redeemed claim is missing');
          await connection.query('COMMIT');
          return existing;
        }
        if (!proof.claim_token_expires_at || proof.claim_token_expires_at <= now) {
          throw new InvalidClaimTokenError('Claim proof expired');
        }
        const active = await connection.query<ClaimRow>(`
          SELECT * FROM ens_claims
          WHERE chain_id = 11155111 AND registry = $1 AND status <> 'detached'
            AND (account = $2 OR labelhash = $3)
          FOR UPDATE
        `, [ENSV2.child.toLowerCase(), account.toLowerCase(), labelhash.toLowerCase()]);
        if (active.rows.length > 0) {
          const existing = active.rows[0]!;
          if (active.rows.length !== 1 || existing.account !== account.toLowerCase() ||
            existing.labelhash !== labelhash.toLowerCase()) {
            throw new ClaimConflictError('A different active claim already uses this wallet or label');
          }
          await connection.query('UPDATE ens_claim_challenges SET claim_id = $2 WHERE claim_token_hash = $1',
            [tokenHash, existing.id]);
          await connection.query('COMMIT');
          return fromRow(existing);
        }
        const id = randomUUID();
        try {
          await connection.query(`
            INSERT INTO ens_claims
              (id, chain_id, registry, label, name, labelhash, account, ip_hash, status, created_at, updated_at)
            VALUES ($1, 11155111, $2, $3, $4, $5, $6, $7, 'queued', $8, $8)
          `, [id, ENSV2.child.toLowerCase(), label, name, labelhash.toLowerCase(), account.toLowerCase(), ipHash, now]);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === '23505') {
            throw new ClaimConflictError('A different active claim already uses this wallet or label');
          }
          throw error;
        }
        await connection.query('UPDATE ens_claim_challenges SET claim_id = $2 WHERE claim_token_hash = $1', [tokenHash, id]);
        const claim = await readClaim(connection, id);
        if (!claim) throw new Error('New claim is missing');
        await connection.query('COMMIT');
        return claim;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
    async get(id) {
      const result = await pool.query<ClaimRow>('SELECT * FROM ens_claims WHERE id = $1', [id]);
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    },
    async getForAccount(account) {
      const result = await pool.query<ClaimRow>(`
        SELECT * FROM ens_claims
        WHERE chain_id = 11155111 AND registry = $1 AND account = $2 AND status <> 'detached'
      `, [ENSV2.child.toLowerCase(), account.toLowerCase()]);
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    },
  };
}
