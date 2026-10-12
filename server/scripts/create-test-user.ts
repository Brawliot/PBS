/**
 * `npm run create-test-user`: creates the test user and gives it the plans and reports of the provisional
 * user, which is then removed. Asks for the email, a name and the password here in the terminal. Do not run
 * it before sign-in exists (point 4, step 6): the server would then have no owner for its requests.
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createPool } from "../db/pool.js";
import { moveProvisionalData } from "../db/maintenance/move-to-test-user.js";
import { hashPassword, PasswordError } from "../auth/passwords.js";
import { prepareUser, UserStoreError } from "../user/user-repository.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see server/.env.example)");
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
try {
  const email = await rl.question("Email of the test user: ");
  const name = await rl.question("Name (2 to 100 characters): ");
  const password = await rl.question("Password (8 to 64 characters): ");
  const prepared = prepareUser(email, name);
  if (prepared.name.length < 2) throw new UserStoreError("invalid_name");
  const passwordHash = await hashPassword(password);
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      const result = await moveProvisionalData(client, { id: randomUUID(), ...prepared, passwordHash });
      console.log(`Done: ${result.plans} plans and ${result.reports} reports now belong to the test user. The provisional user is removed.`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
} catch (error) {
  if (error instanceof UserStoreError) console.error(`Not created: ${error.code}`);
  else if (error instanceof PasswordError) console.error("Not created: the password must be 8 to 64 characters, with no control characters");
  else if ((error as { code?: string }).code === "23505") console.error("Not created: that email already has a user");
  else console.error("Not created: database error. Nothing was changed.");
  process.exitCode = 1;
} finally {
  rl.close();
}
