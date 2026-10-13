/**
 * Runs the server tests. `npm test` runs them all and says plainly when the database tests were left out.
 * `npm run test:db` runs them against TEST_DATABASE_URL (the environment, or server/.env.test). It refuses to
 * run without that variable, and when it points at the application's database (DATABASE_URL in server/.env),
 * because these tests insert, change and delete rows.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dbMode = process.argv[2] === "db";
if (dbMode && existsSync(".env.test")) process.loadEnvFile(".env.test");

/** The DATABASE_URL written in server/.env, read as text: that file is not loaded into this process */
function applicationUrl(): string | undefined {
  if (!existsSync(".env")) return process.env.DATABASE_URL;
  const line = readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m);
  return line?.[1].trim().replace(/^["']|["']$/g, "") || process.env.DATABASE_URL;
}

/** Host and database name only: the same database under two URLs (other user, other options) is still the same */
function sameDatabase(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

const testUrl = process.env.TEST_DATABASE_URL;
if (dbMode) {
  if (!testUrl) {
    console.error("npm run test:db needs TEST_DATABASE_URL (in the environment, or in server/.env.test). Nothing was run.");
    process.exit(1);
  }
  const appUrl = applicationUrl();
  if (appUrl && sameDatabase(testUrl, appUrl)) {
    console.error("TEST_DATABASE_URL points at the application's database (DATABASE_URL). These tests delete rows: use a separate test database. Nothing was run.");
    process.exit(1);
  }
}

// The pattern is quoted for the shell, so that ** reaches the test runner and finds every folder
const result = spawnSync("tsx", ["--test", '"test/**/*.test.ts"'], { stdio: "inherit", shell: true });

if (!dbMode && !testUrl) {
  console.log("\nAVISO: las pruebas de base de datos NO se han ejecutado (falta TEST_DATABASE_URL).");
  console.log("Para ejecutarlas: npm run test:db");
}
process.exit(result.status ?? 1);
