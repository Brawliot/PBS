/**
 * The users table on a real PostgreSQL: the shared contract, and the provisional user of migration 004.
 * Runs only when TEST_DATABASE_URL is set; each run works in its own schema, dropped at the end.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { PgUserRepository } from "../../db/pg-user-repository.js";
import { userRepositoryContract } from "../user/user-contract.js";
import { PROVISIONAL_USER } from "./users.js";

const url = process.env.TEST_DATABASE_URL;

if (url) {
  userRepositoryContract("PgUserRepository on PostgreSQL", async () => {
    const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();

    const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    const client = await pool.connect();
    try {
      await runMigrations(client);
    } finally {
      client.release();
    }
    return {
      repo: new PgUserRepository(pool),
      teardown: async () => {
        await pool.end();
        const cleanup = new Client({ connectionString: url });
        await cleanup.connect();
        await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await cleanup.end();
      },
    };
  });
}

describe("PgUserRepository: the provisional user", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  test("the provisional user of migration 004 is found by its id", async () => {
    const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    try {
      const client = await pool.connect();
      try {
        await runMigrations(client);
      } finally {
        client.release();
      }
      const found = await new PgUserRepository(pool).findById(PROVISIONAL_USER);
      assert.equal(found?.email, "provisional@local.invalid");
      assert.equal(found?.passwordHash, null);
    } finally {
      await pool.end();
      const cleanup = new Client({ connectionString: url });
      await cleanup.connect();
      await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await cleanup.end();
    }
  });
});
