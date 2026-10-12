/**
 * SessionRepository on PostgreSQL. The table keeps only the hash of each token; see migration 005.
 */

import type { Pool } from "pg";
import type { NewSession, SessionRepository } from "./session-repository.js";

export class PgSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(session: NewSession, _now: Date): Promise<void> {
    await this.pool.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [session.tokenHash, session.userId, session.expiresAt],
    );
  }

  async findUserId(tokenHash: string, now: Date): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ user_id: string; expired: boolean }>(
      "SELECT user_id, expires_at <= $2 AS expired FROM sessions WHERE token_hash = $1",
      [tokenHash, now],
    );
    const row = rows[0];
    if (!row) return undefined;
    if (row.expired) {
      await this.remove(tokenHash);
      return undefined;
    }
    return row.user_id;
  }

  async remove(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async removeExpired(now: Date): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
  }
}
