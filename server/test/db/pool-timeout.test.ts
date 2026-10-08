/**
 * The statement timeout on a real PostgreSQL: a statement that runs longer than the limit is cancelled by
 * the server (error code 57014). Runs only with TEST_DATABASE_URL.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createPool } from "../../db/pool.js";

const url = process.env.TEST_DATABASE_URL;

describe("the statement timeout on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  test("a statement longer than DB_STATEMENT_TIMEOUT_MS is cancelled with code 57014", async () => {
    const pool = createPool(url!, { DB_STATEMENT_TIMEOUT_MS: "200" });
    try {
      await assert.rejects(pool.query("SELECT pg_sleep(3)"), { code: "57014" });
      // A statement under the limit still works on the same pool
      assert.equal((await pool.query("SELECT 1 AS one")).rows[0].one, 1);
    } finally {
      await pool.end();
    }
  });
});
