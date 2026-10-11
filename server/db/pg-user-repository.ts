/**
 * UserRepository on PostgreSQL. The email is unique in the table, so two sign-ups with the same address
 * cannot both be stored: the second one gets the code email_taken.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { isUserId, prepareUser, UserStoreError, type StoredUser, type UserRepository } from "../user/user-repository.js";

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  created_at: Date;
}

const storedFrom = (row: UserRow): StoredUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  passwordHash: row.password_hash,
  createdAt: row.created_at.toISOString(),
});

const COLUMNS = "id, email, name, password_hash, created_at";
/** PostgreSQL's code for a unique value that is already there */
const UNIQUE_VIOLATION = "23505";

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(email: string, name: string): Promise<StoredUser> {
    const prepared = prepareUser(email, name);
    try {
      const { rows } = await this.pool.query<UserRow>(
        `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [randomUUID(), prepared.email, prepared.name],
      );
      return storedFrom(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new UserStoreError("email_taken");
      throw error;
    }
  }

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const { rows } = await this.pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
    return rows[0] && storedFrom(rows[0]);
  }

  async findById(id: string): Promise<StoredUser | undefined> {
    if (!isUserId(id)) return undefined;
    const { rows } = await this.pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] && storedFrom(rows[0]);
  }
}
