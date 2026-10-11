/**
 * The users the database tests work with. PROVISIONAL_USER is the one migration 004 creates; OTHER_USER is
 * added to each test schema, because a row of another user needs it to exist (foreign key).
 */

import type { PoolClient } from "pg";

export const PROVISIONAL_USER = "00000000-0000-0000-0000-000000000001";
export const OTHER_USER = "00000000-0000-0000-0000-0000000000a2";

export async function addOtherUser(client: PoolClient): Promise<void> {
  await client.query("INSERT INTO users (id, email, name) VALUES ($1, 'other@example.test', 'Other')", [OTHER_USER]);
}
