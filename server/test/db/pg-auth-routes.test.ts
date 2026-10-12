/**
 * The auth routes on a real PostgreSQL: sign-up, sign-in, the session, sign-out, and what is stored. Runs only
 * when TEST_DATABASE_URL is set, in its own schema, dropped at the end.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { handleAuthRequest, type AuthDeps } from "../../auth/auth-routes.js";
import { LoginLimiter } from "../../auth/login-limit.js";
import { hashToken, SESSION_COOKIE } from "../../auth/session-cookie.js";
import { PgSessionRepository } from "../../auth/session-repository-pg.js";
import { MIGRATIONS_DIRECTORY, runMigrations } from "../../db/migrate.js";
import { PgUserRepository } from "../../db/pg-user-repository.js";
import { newSchema } from "./schema.js";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-11T12:00:00Z");
const PASSWORD = "correct horse battery";

describe("the auth routes on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  test("sign-up, the session, sign-out and sign-in again; the password and the token are never stored as they are", async () => {
    const { pool, drop } = await newSchema(url!);
    try {
      const client = await pool.connect();
      try {
        const all = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => name.endsWith(".sql")).sort();
        assert.deepEqual(await runMigrations(client), all);
      } finally {
        client.release();
      }
      const deps: AuthDeps = {
        limiter: new LoginLimiter(),
        stores: { users: new PgUserRepository(pool), sessions: new PgSessionRepository(pool) },
      };
      const run = (method: string, path: string, body?: unknown, cookie?: string) =>
        handleAuthRequest({ method, path, body: body === undefined ? "" : JSON.stringify(body), cookieHeader: cookie, now: NOW, secure: false }, deps);

      const registered = await run("POST", "/api/auth/register", { name: "Ana", email: "Ana@Example.test", password: PASSWORD });
      assert.equal(registered?.status, 201);
      const cookie = registered!.setCookie!.split(";")[0];
      assert.deepEqual((await run("GET", "/api/auth/session", undefined, cookie))?.body, { user: { name: "Ana" } });

      const stored = await pool.query<{ email: string; password_hash: string }>("SELECT email, password_hash FROM users WHERE email = 'ana@example.test'");
      assert.equal(stored.rows[0].email, "ana@example.test");
      assert.match(stored.rows[0].password_hash, /^scrypt\$16384\$8\$1\$/);
      assert.equal(stored.rows[0].password_hash.includes(PASSWORD), false);

      const token = cookie.slice(SESSION_COOKIE.length + 1);
      const sessions = await pool.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
      assert.deepEqual(sessions.rows.map((row) => row.token_hash), [hashToken(token)]);
      assert.equal(sessions.rows[0].token_hash.includes(token), false);

      assert.equal((await run("POST", "/api/auth/logout", undefined, cookie))?.status, 204);
      assert.deepEqual((await run("GET", "/api/auth/session", undefined, cookie))?.body, { user: null });

      const again = await run("POST", "/api/auth/login", { email: "ANA@example.test", password: PASSWORD });
      assert.equal(again?.status, 200);
      assert.equal((await run("POST", "/api/auth/login", { email: "ana@example.test", password: "wrong password" }))?.status, 401);
      const duplicate = await run("POST", "/api/auth/register", { name: "Ana", email: "ana@example.test", password: PASSWORD });
      assert.equal(duplicate?.status, 409);
    } finally {
      await drop();
    }
  });
});
