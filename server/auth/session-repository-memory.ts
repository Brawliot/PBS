import type { NewSession, SessionRepository } from "./session-repository.js";

interface Stored {
  userId: string;
  expiresAt: Date;
}

/** Sessions kept in memory: they are lost when the server stops. Used when there is no database. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, Stored>();

  async create(session: NewSession, _now: Date): Promise<void> {
    this.sessions.set(session.tokenHash, { userId: session.userId, expiresAt: new Date(session.expiresAt) });
  }

  async findUserId(tokenHash: string, now: Date): Promise<string | undefined> {
    const stored = this.sessions.get(tokenHash);
    if (!stored) return undefined;
    if (stored.expiresAt <= now) {
      this.sessions.delete(tokenHash);
      return undefined;
    }
    return stored.userId;
  }

  async remove(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async removeExpired(now: Date): Promise<void> {
    for (const [tokenHash, stored] of this.sessions) {
      if (stored.expiresAt <= now) this.sessions.delete(tokenHash);
    }
  }
}
