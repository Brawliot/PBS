/**
 * Limits the failed sign-in attempts for one email: after MAX_FAILURES wrong passwords in WINDOW_MS, the email
 * is refused for the rest of the window, even with the right password. The count is kept in memory, so it
 * starts again when the server restarts, and it is not shared between servers (see PRODUCTION.md).
 * The key is the email, never the password. A refused attempt does not count again.
 */

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;
/** A bound on the memory: old entries are dropped when there are too many */
const MAX_KEYS = 10_000;

interface AttemptRecord {
  failures: number;
  windowStart: number;
}

export class LoginLimiter {
  private readonly records = new Map<string, AttemptRecord>();

  constructor(
    private readonly maxFailures = MAX_FAILURES,
    private readonly windowMs = WINDOW_MS,
  ) {}

  /** True while this email has used up its failures in the current window */
  blocked(key: string, now: Date): boolean {
    const record = this.live(key, now);
    return record !== undefined && record.failures >= this.maxFailures;
  }

  fail(key: string, now: Date): void {
    if (!this.records.has(key) && this.records.size >= MAX_KEYS) this.dropOldest();
    const record = this.live(key, now);
    if (record) record.failures += 1;
    else this.records.set(key, { failures: 1, windowStart: now.getTime() });
  }

  /** A right password clears the count of this email */
  clear(key: string): void {
    this.records.delete(key);
  }

  private live(key: string, now: Date): AttemptRecord | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (now.getTime() - record.windowStart >= this.windowMs) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }

  private dropOldest(): void {
    const oldest = this.records.keys().next();
    if (!oldest.done) this.records.delete(oldest.value);
  }
}
