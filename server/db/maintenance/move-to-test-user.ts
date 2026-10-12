/**
 * Moves every plan and report of the provisional user to a new user, and removes the provisional user. Run by
 * the owner, by hand, with `npm run create-test-user` (scripts/create-test-user.ts). It is not a migration: it
 * never runs by itself. All of it is one transaction: if anything fails, nothing changes.
 */

import type { PoolClient } from "pg";

export const PROVISIONAL_USER_ID = "00000000-0000-0000-0000-000000000001";

export interface NewOwner {
  id: string;
  email: string;
  name: string;
  /** A hash from hashPassword(): the password itself never reaches the database */
  passwordHash: string;
}

export interface MoveResult {
  plans: number;
  reports: number;
}

export async function moveProvisionalData(client: PoolClient, owner: NewOwner): Promise<MoveResult> {
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)",
      [owner.id, owner.email, owner.name, owner.passwordHash],
    );
    const plans = await client.query("UPDATE plans SET user_id = $1 WHERE user_id = $2", [owner.id, PROVISIONAL_USER_ID]);
    const reports = await client.query("UPDATE reports SET user_id = $1 WHERE user_id = $2", [owner.id, PROVISIONAL_USER_ID]);
    await client.query("DELETE FROM users WHERE id = $1", [PROVISIONAL_USER_ID]);
    await client.query("COMMIT");
    return { plans: plans.rowCount ?? 0, reports: reports.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
