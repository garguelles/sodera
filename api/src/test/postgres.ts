import { randomBytes } from 'node:crypto';

import { Pool } from 'pg';

export async function createIsolatedTestDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const admin = new Pool({ connectionString });
  const schema = `ens_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
