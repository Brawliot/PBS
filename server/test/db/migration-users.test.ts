/**
 * Migration 004 (users) on a real PostgreSQL. Runs only when TEST_DATABASE_URL is set. Each test works in
 * its own schema, created here and dropped at the end: no table of the database is touched.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { MIGRATIONS_DIRECTORY, runMigrations } from "../../db/migrate.js";
import { PROVISIONAL_USER } from "./users.js";

const url = process.env.TEST_DATABASE_URL;
const OLD_MIGRATIONS = ["001_plans.sql", "002_reports.sql", "003_plan_log.sql"];

/** A pool that works in a new schema, and the function that drops the schema */
async function newSchema(): Promise<{ pool: Pool; drop: () => Promise<void> }> {
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

describe("migration 004: users", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  test("applies on a clean database, and a second run changes nothing", async () => {
    const { pool, drop } = await newSchema();
    try {
      const client = await pool.connect();
      try {
        const all = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => name.endsWith(".sql")).sort();
        assert.deepEqual(await runMigrations(client), all);
        assert.deepEqual(await runMigrations(client), []);
      } finally {
        client.release();
      }
    } finally {
      await drop();
    }
  });

  test("the owners of plans and reports are uuids that point to users, and the provisional user exists", async () => {
    const { pool, drop } = await newSchema();
    try {
      const client = await pool.connect();
      try {
        await runMigrations(client);
      } finally {
        client.release();
      }

      const columns = await pool.query<{ table_name: string; data_type: string }>(
        "SELECT table_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'user_id' ORDER BY table_name",
      );
      assert.deepEqual(columns.rows, [
        { table_name: "plans", data_type: "uuid" },
        { table_name: "reports", data_type: "uuid" },
      ]);

      const users = await pool.query("SELECT id::text AS id, email, password_hash FROM users");
      assert.deepEqual(users.rows, [{ id: PROVISIONAL_USER, email: "provisional@local.invalid", password_hash: null }]);

      // A plan of a user that does not exist is refused by the database itself
      await assert.rejects(
        pool.query(
          "INSERT INTO plans (id, user_id, title, version, schema_version, document) VALUES ($1, $2, 'x', 1, 1, '{}')",
          [randomUUID(), randomUUID()],
        ),
        { code: "23503" },
      );
    } finally {
      await drop();
    }
  });

  test("old owners such as 'local' stop the migration with a clear message, and nothing is changed", async () => {
    const { pool, drop } = await newSchema();
    const oldDirectory = await mkdtemp(join(tmpdir(), "pbs-migrations-"));
    try {
      for (const name of OLD_MIGRATIONS) await copyFile(join(MIGRATIONS_DIRECTORY, name), join(oldDirectory, name));
      const client = await pool.connect();
      try {
        await runMigrations(client, oldDirectory);
        await client.query(
          "INSERT INTO plans (id, user_id, title, version, schema_version, document) VALUES ($1, 'local', 'Old', 1, 1, '{}')",
          [randomUUID()],
        );

        await assert.rejects(runMigrations(client), (error: Error) => {
          assert.match(error.message, /^Migration 004_users\.sql failed: plans and reports have 1 rows whose user_id is not a uuid/);
          assert.match(error.message, /server\/db\/maintenance\/clear-plan-data\.sql/);
          // The value of the row never reaches the message
          assert.doesNotMatch(error.message, /\blocal\b/);
          return true;
        });

        const applied = await client.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
        assert.deepEqual(
          applied.rows.map((row) => row.name),
          OLD_MIGRATIONS,
        );
        const kept = await client.query("SELECT user_id FROM plans");
        assert.deepEqual(kept.rows, [{ user_id: "local" }]);
      } finally {
        client.release();
      }
    } finally {
      await rm(oldDirectory, { recursive: true, force: true });
      await drop();
    }
  });
});
