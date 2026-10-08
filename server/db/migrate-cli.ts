/** `npm run migrate`: applies the pending migrations to the database in DATABASE_URL */

import { Client } from "pg";
import { runMigrations } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see server/.env.example)");
  process.exit(1);
}

const client = new Client({ connectionString: url });
try {
  await client.connect();
  const ran = await runMigrations(client);
  console.log(ran.length > 0 ? `Applied: ${ran.join(", ")}` : "No pending migrations");
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
