/**
 * The contract of the session repositories: one set of tests, run against the memory repository always and
 * against PostgreSQL when TEST_DATABASE_URL is set (each run in its own schema, dropped at the end).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { InMemorySessionRepository } from "../../auth/session-repository-memory.js";
import { PgSessionRepository } from "../../auth/session-repository-pg.js";
import type { SessionRepository } from "../../auth/session-repository.js";
import { MIGRATIONS_DIRECTORY, runMigrations } from "../../db/migrate.js";
import { newSchema } from "../db/schema.js";
import { readdir } from "node:fs/promises";

const url = process.env.TEST_DATABASE_URL;
const USER = "00000000-0000-0000-0000-0000000000c1";
const NOW = new Date("2026-10-11T12:00:00Z");
const LATER = new Date("2026-10-12T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

interface Setup {
  repo: SessionRepository;
  close: () => Promise<void>;
}

const backends: { name: string; setup: () => Promise<Setup>; skip?: string }[] = [
  {
    name: "memory",
    setup: async () => ({ repo: new InMemorySessionRepository(), close: async () => {} }),
  },
  {
    name: "PostgreSQL",
    skip: url ? undefined : "TEST_DATABASE_URL is not set",
    setup: async () => {
      const { pool, drop } = await newSchema(url!);
      const client = await pool.connect();
      try {
        const all = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => name.endsWith(".sql")).sort();
        assert.deepEqual(await runMigrations(client), all);
      } finally {
        client.release();
      }
      await pool.query("INSERT INTO users (id, email, name) VALUES ($1, 'c@example.test', 'C')", [USER]);
      return { repo: new PgSessionRepository(pool as Pool), close: drop };
    },
  },
];

for (const backend of backends) {
  describe(`session repository: ${backend.name}`, { skip: backend.skip }, () => {
    const withRepo = async (run: (repo: SessionRepository) => Promise<void>) => {
      const { repo, close } = await backend.setup();
      try {
        await run(repo);
      } finally {
        await close();
      }
    };

    test("a session found before it expires gives its user", () =>
      withRepo(async (repo) => {
        await repo.create({ tokenHash: "h1", userId: USER, expiresAt: new Date(NOW.getTime() + DAY) }, NOW);
        assert.equal(await repo.findUserId("h1", NOW), USER);
      }));

    test("an unknown hash gives nothing", () =>
      withRepo(async (repo) => {
        assert.equal(await repo.findUserId("nope", NOW), undefined);
      }));

    test("an expired session gives nothing, and is removed when found", () =>
      withRepo(async (repo) => {
        await repo.create({ tokenHash: "h1", userId: USER, expiresAt: new Date(NOW.getTime() + DAY) }, NOW);
        assert.equal(await repo.findUserId("h1", LATER), undefined);
        // Removed: even a clock that goes back does not bring it back
        assert.equal(await repo.findUserId("h1", NOW), undefined);
      }));

    test("a session ends exactly at its expiry time: at that instant it is already expired", () =>
      withRepo(async (repo) => {
        const expiresAt = new Date(NOW.getTime() + DAY);
        await repo.create({ tokenHash: "h1", userId: USER, expiresAt }, NOW);
        assert.equal(await repo.findUserId("h1", new Date(expiresAt.getTime() - 1)), USER);
        assert.equal(await repo.findUserId("h1", expiresAt), undefined);
      }));

    test("remove ends one session and leaves the others", () =>
      withRepo(async (repo) => {
        const expiresAt = new Date(NOW.getTime() + DAY);
        await repo.create({ tokenHash: "h1", userId: USER, expiresAt }, NOW);
        await repo.create({ tokenHash: "h2", userId: USER, expiresAt }, NOW);
        await repo.remove("h1");
        await repo.remove("never-existed");
        assert.equal(await repo.findUserId("h1", NOW), undefined);
        assert.equal(await repo.findUserId("h2", NOW), USER);
      }));

    test("removeExpired takes out only the expired sessions", () =>
      withRepo(async (repo) => {
        await repo.create({ tokenHash: "old", userId: USER, expiresAt: new Date(NOW.getTime() + 1000) }, NOW);
        await repo.create({ tokenHash: "new", userId: USER, expiresAt: new Date(LATER.getTime() + DAY) }, NOW);
        await repo.removeExpired(LATER);
        assert.equal(await repo.findUserId("new", LATER), USER);
        assert.equal(await repo.findUserId("old", NOW), undefined);
      }));
  });
}
