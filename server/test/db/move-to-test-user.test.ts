/**
 * The move of the provisional user's data to a new user (db/maintenance/move-to-test-user.ts). Runs only with
 * TEST_DATABASE_URL, in its own schema, dropped at the end.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { MIGRATIONS_DIRECTORY, runMigrations } from "../../db/migrate.js";
import { moveProvisionalData, PROVISIONAL_USER_ID } from "../../db/maintenance/move-to-test-user.js";
import { newSchema } from "./schema.js";

const url = process.env.TEST_DATABASE_URL;
const NEW_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";

async function withData(run: (pool: Awaited<ReturnType<typeof newSchema>>["pool"]) => Promise<void>) {
  const { pool, drop } = await newSchema(url!);
  try {
    const client = await pool.connect();
    try {
      const all = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => name.endsWith(".sql")).sort();
      assert.deepEqual(await runMigrations(client), all);
    } finally {
      client.release();
    }
    await pool.query(
      "INSERT INTO plans (id, user_id, title, version, schema_version, document) VALUES ($1, $2, 'P1', 1, 1, '{}'), ($3, $2, 'P2', 1, 1, '{}')",
      [randomUUID(), PROVISIONAL_USER_ID, randomUUID()],
    );
    await pool.query("INSERT INTO reports (id, user_id, report) VALUES ($1, $2, '{}')", [randomUUID(), PROVISIONAL_USER_ID]);
    await run(pool);
  } finally {
    await drop();
  }
}

describe("moving the provisional user's data to a test user", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  test("every plan and report moves to the new user, the provisional user is removed", () =>
    withData(async (pool) => {
      const client = await pool.connect();
      const id = randomUUID();
      try {
        const result = await moveProvisionalData(client, { id, email: "test@example.test", name: "Test", passwordHash: NEW_HASH });
        assert.deepEqual(result, { plans: 2, reports: 1 });
      } finally {
        client.release();
      }
      const plans = await pool.query<{ user_id: string }>("SELECT user_id FROM plans");
      assert.deepEqual(plans.rows.map((row) => row.user_id), [id, id]);
      const reports = await pool.query<{ user_id: string }>("SELECT user_id FROM reports");
      assert.deepEqual(reports.rows.map((row) => row.user_id), [id]);
      const users = await pool.query<{ id: string; email: string; password_hash: string }>("SELECT id, email, password_hash FROM users ORDER BY email");
      assert.deepEqual(users.rows, [{ id, email: "test@example.test", password_hash: NEW_HASH }]);
    }));

  test("if the email is already used, nothing changes: the provisional user keeps its data", () =>
    withData(async (pool) => {
      const client = await pool.connect();
      try {
        await pool.query("INSERT INTO users (id, email, name) VALUES ($1, 'taken@example.test', 'Taken')", [randomUUID()]);
        await assert.rejects(
          moveProvisionalData(client, { id: randomUUID(), email: "taken@example.test", name: "Test", passwordHash: NEW_HASH }),
          { code: "23505" },
        );
      } finally {
        client.release();
      }
      const plans = await pool.query<{ user_id: string }>("SELECT user_id FROM plans");
      assert.deepEqual(plans.rows.map((row) => row.user_id), [PROVISIONAL_USER_ID, PROVISIONAL_USER_ID]);
      const provisional = await pool.query("SELECT id FROM users WHERE id = $1", [PROVISIONAL_USER_ID]);
      assert.equal(provisional.rowCount, 1);
    }));
});
