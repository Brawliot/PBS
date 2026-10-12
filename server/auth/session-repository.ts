/**
 * Storage of sessions: what every repository promises. A session is found by the hash of its token, never by
 * the token itself, and the time is passed in (not read here), so the tests can choose it. A session that has
 * expired is never returned: the repository deletes it when it finds it.
 */

export interface NewSession {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface SessionRepository {
  create(session: NewSession, now: Date): Promise<void>;
  /** The user of the session, or undefined when there is no such session or it has expired at `now` */
  findUserId(tokenHash: string, now: Date): Promise<string | undefined>;
  /** Removes one session. Removing a session that is not there does nothing. */
  remove(tokenHash: string): Promise<void>;
  /** Removes every session that has expired at `now` */
  removeExpired(now: Date): Promise<void>;
}
