import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { POOL_DEFAULTS, createPool, poolLimits } from "../../db/pool.js";

describe("the pool's limits", () => {
  test("the defaults: 10 connections, 5 s to connect, 30 s idle, 10 s per statement", () => {
    assert.deepEqual(POOL_DEFAULTS, { max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, statementTimeoutMillis: 10_000 });
    assert.deepEqual(poolLimits({}), POOL_DEFAULTS);
  });

  test("each limit is changed by its variable, and only that one", () => {
    assert.deepEqual(poolLimits({ DB_POOL_MAX: "4", DB_STATEMENT_TIMEOUT_MS: "250" }), {
      ...POOL_DEFAULTS,
      max: 4,
      statementTimeoutMillis: 250,
    });
    assert.deepEqual(poolLimits({ DB_CONNECT_TIMEOUT_MS: "1200", DB_IDLE_TIMEOUT_MS: "9000" }), {
      ...POOL_DEFAULTS,
      connectionTimeoutMillis: 1200,
      idleTimeoutMillis: 9000,
    });
  });

  test("an empty variable is the default; a value that is not a positive whole number refuses to start, and names the variable", () => {
    assert.deepEqual(poolLimits({ DB_POOL_MAX: "" }), POOL_DEFAULTS);
    for (const bad of ["0", "-3", "2.5", "ten", "1e3", " 4", "4 "]) {
      assert.throws(() => poolLimits({ DB_POOL_MAX: bad }), { message: "DB_POOL_MAX must be a positive whole number" }, bad);
    }
    assert.throws(() => poolLimits({ DB_STATEMENT_TIMEOUT_MS: "soon" }), { message: "DB_STATEMENT_TIMEOUT_MS must be a positive whole number" });
  });

  test("every limit reaches the pool: each variable changes its own setting", () => {
    const seen: Record<string, unknown>[] = [];
    class FakePool {
      constructor(config: Record<string, unknown>) {
        seen.push(config);
      }
      on() {
        return this;
      }
    }
    createPool("postgres://x", { DB_POOL_MAX: "7", DB_CONNECT_TIMEOUT_MS: "1100", DB_IDLE_TIMEOUT_MS: "2200", DB_STATEMENT_TIMEOUT_MS: "3300" }, FakePool as unknown as typeof Pool);
    assert.deepEqual(seen[0], { connectionString: "postgres://x", max: 7, connectionTimeoutMillis: 1100, idleTimeoutMillis: 2200, statement_timeout: 3300 });
  });

  test("the pool is built with these limits: the injected constructor sees them", () => {
    const seen: Record<string, unknown>[] = [];
    class FakePool {
      constructor(config: Record<string, unknown>) {
        seen.push(config);
      }
      on() {
        return this;
      }
    }
    createPool("postgres://user@db.example/app?sslmode=require", { DB_POOL_MAX: "3" }, FakePool as unknown as typeof Pool);
    assert.deepEqual(seen, [
      {
        connectionString: "postgres://user@db.example/app?sslmode=require",
        max: 3,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        statement_timeout: 10_000,
      },
    ]);
  });

  test("an invalid limit stops the pool from being built", () => {
    class NeverPool {
      constructor() {
        assert.fail("the pool must not be built with an invalid limit");
      }
    }
    assert.throws(() => createPool("postgres://x", { DB_POOL_MAX: "0" }, NeverPool as unknown as typeof Pool));
  });
});
