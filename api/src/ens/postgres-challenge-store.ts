import { Pool } from 'pg';

import { ChallengeLimitError, type ChallengeStore, type StoredChallenge } from './challenge-store.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ens_claim_challenges (
  id uuid PRIMARY KEY,
  account text NOT NULL,
  label text NOT NULL,
  chain_id integer NOT NULL,
  registry text NOT NULL,
  challenge text NOT NULL,
  nonce text,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  verified_at timestamptz,
  claim_token_hash text UNIQUE,
  claim_token_expires_at timestamptz,
  proof_authenticator_data text,
  proof_client_data_json text,
  proof_signature text
);
CREATE INDEX IF NOT EXISTS ens_claim_challenges_created_idx ON ens_claim_challenges (created_at);
ALTER TABLE ens_claim_challenges ADD COLUMN IF NOT EXISTS nonce text;
ALTER TABLE ens_claim_challenges ADD COLUMN IF NOT EXISTS proof_authenticator_data text;
ALTER TABLE ens_claim_challenges ADD COLUMN IF NOT EXISTS proof_client_data_json text;
ALTER TABLE ens_claim_challenges ADD COLUMN IF NOT EXISTS proof_signature text;
`;

export async function createPostgresChallengeStore(pool: Pool): Promise<ChallengeStore> {
  await pool.query(SCHEMA);

  return {
    async issue(value: StoredChallenge) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query("SELECT pg_advisory_xact_lock(hashtext('sodera_ens_challenges'))");
        await connection.query('DELETE FROM ens_claim_challenges WHERE created_at < $1::timestamptz - interval \'2 days\'', [value.createdAt]);
        const limits = await connection.query<{
          account_count: string; ip_count: string; global_count: string;
        }>(`
          SELECT count(*) FILTER (WHERE account = $1) AS account_count,
                 count(*) FILTER (WHERE ip_hash = $2) AS ip_count,
                 count(*) AS global_count
          FROM ens_claim_challenges
          WHERE created_at >= $3::timestamptz - interval '1 hour'
        `, [value.account.toLowerCase(), value.ipHash, value.createdAt]);
        const count = limits.rows[0];
        if (!count || Number(count.account_count) >= 5 || Number(count.ip_count) >= 30 ||
          Number(count.global_count) >= 500) {
          throw new ChallengeLimitError('ENS challenge limit reached');
        }
        await connection.query(`
          INSERT INTO ens_claim_challenges (id, account, label, chain_id, registry, challenge, nonce, ip_hash, created_at, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [value.id, value.account.toLowerCase(), value.label, value.chainId, value.registry.toLowerCase(), value.challenge, value.nonce, value.ipHash, value.createdAt, value.expiresAt]);
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
    async consume({ id, account, label, chainId, registry, now }) {
      const result = await pool.query<{ challenge: string }>(`
        UPDATE ens_claim_challenges SET consumed_at = $6
        WHERE id = $1 AND account = $2 AND label = $3 AND chain_id = $4 AND registry = $5
          AND consumed_at IS NULL AND expires_at > $6
        RETURNING challenge
      `, [id, account.toLowerCase(), label, chainId, registry.toLowerCase(), now]);
      return result.rows[0]?.challenge ?? null;
    },
    async markVerified({ id, tokenHash, expiresAt, proof }) {
      const result = await pool.query(`
        UPDATE ens_claim_challenges
        SET verified_at = now(), claim_token_hash = $2, claim_token_expires_at = $3,
          proof_authenticator_data = $4, proof_client_data_json = $5, proof_signature = $6
        WHERE id = $1 AND consumed_at IS NOT NULL AND verified_at IS NULL
      `, [id, tokenHash, expiresAt, proof.authenticatorData, proof.clientDataJSON, proof.signature]);
      if (result.rowCount !== 1) throw new Error('Challenge verification was not recorded');
    },
  };
}
