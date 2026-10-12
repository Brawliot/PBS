/**
 * Migration 005 (sessions) on a real PostgreSQL. Runs only when TEST_DATABASE_URL is set. Each test works in
 * its own schema, dropped at the end.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MIGRATIONS_DIRECTORY, runMigrations } from "../../db/migrate.js";
import { readdir } from "node:fs/promises";
import { newSchema } from "./schema.js";

const url = process.env.TEST_DATABASE_URL;
const USER = "00000000-0000-0000-0000-0000000000b1";

describe("migration 005: sessions", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  test("applies on a clean database, and a second run changes nothing", async () => {
    const { pool, drop } = await newSchema(url!);
    try {
      const client = await pool.connect();
      try {
        const all = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => name.endsWith(".sql")).sort();
        assert.deepEqual(await runMigrations(client), all);
        assert.deepEqual(await runMigrations(client), []);
      } finally {
        client.release();
      }
      const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sessions' ORDER BY ordinal_position",
      );
      assert.deepEqual(columns.rows, [
        { column_name: "token_hash", data_type: "text", is_nullable: "NO" },
        { column_name: "user_id", data_type: "uuid", is_nullable: "NO" },
        { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
        { column_name: "expires_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      ]);
    } finally {
      await drop();
    }
  });

  test("a session of a user who does not exist is refused", async () => {
    const { pool, drop } = await newSchema(url!);
    try {
      const client = await pool.connect();
      try {
        await runMigrations(client);
      } finally {
        client.release();
      }
      await assert.rejects(
        pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h1', $1, now() + interval '1 day')", [USER]),
        { code: "23503" },
      );
    } finally {
      await drop();
    }
  });

  test("deleting a user deletes their sessions, and no one else's", async () => {
    const { pool, drop } = await newSchema(url!);
    try {
      const client = await pool.connect();
      try {
        await runMigrations(client);
      } finally {
        client.release();
      }
      const other = "00000000-0000-0000-0000-0000000000b2";
      await pool.query("INSERT INTO users (id, email, name) VALUES ($1, 'a@example.test', 'A'), ($2, 'b@example.test', 'B')", [USER, other]);
      await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h1', $1, now() + interval '1 day'), ('h2', $1, now() + interval '1 day'), ('h3', $2, now() + interval '1 day')",
        [USER, other],
      );
      await pool.query("DELETE FROM users WHERE id = $1", [USER]);
      const left = await pool.query<{ token_hash: string }>("SELECT token_hash FROM sessions ORDER BY token_hash");
      assert.deepEqual(left.rows, [{ token_hash: "h3" }]);
    } finally {
      await drop();
    }
  });
});
