/**
 * A PostgreSQL schema of its own for one test: the pool works inside it, and drop() removes it at the end,
 * so no table of the database is touched. Needs TEST_DATABASE_URL.
 */

import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";

export async function newSchema(url: string): Promise<{ pool: Pool; drop: () => Promise<void> }> {
  const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  const drop = async () => {
    await pool.end();
    const cleanup = new Client({ connectionString: url });
    await cleanup.connect();
    await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanup.end();
  };
  return { pool, drop };
}
