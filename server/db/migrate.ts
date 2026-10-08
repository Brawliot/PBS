/**
 * Applies the pending migrations, in order, each in its own transaction together with its entry in
 * schema_migrations. An advisory lock keeps two runs from applying the same file at once; a run
 * with nothing pending changes nothing.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { ClientBase } from "pg";
import { orderMigrations } from "./migration-files.js";

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Returns the names applied by this run, in order */
export async function runMigrations(client: ClientBase, directory: string = MIGRATIONS_DIRECTORY): Promise<string[]> {
  await client.query("SELECT pg_advisory_lock(hashtext('pbs.migrations'))");
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const migrations = orderMigrations(await readdir(directory));
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.name));

    const ran: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      const sql = await readFile(join(directory, migration.name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.name} failed: ${(error as { code?: string }).code ?? "unknown error"}`);
      }
      ran.push(migration.name);
    }
    return ran;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('pbs.migrations'))");
  }
}
