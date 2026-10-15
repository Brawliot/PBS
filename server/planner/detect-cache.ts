/**
 * The Jev result of a detection, kept in memory for the first planner request. It is bound to the user and to the
 * idea it was made from, and it expires after 15 minutes. Nothing is written to a table.
 */

import { randomUUID } from "node:crypto";
import type { JevResponse } from "./planner-handler.js";

const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 500;

interface Entry {
  owner: string;
  idea: string;
  jev: JevResponse;
  expires: number;
}

export class DetectCache {
  private entries = new Map<string, Entry>();

  constructor(private now: () => number = Date.now) {}

  /** Keeps a result and returns the token that names it */
  put(owner: string, idea: string, jev: JevResponse): string {
    this.prune();
    // Over the limit, the oldest result goes first (Map keeps insertion order)
    while (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
    const token = randomUUID();
    this.entries.set(token, { owner, idea, jev, expires: this.now() + TTL_MS });
    return token;
  }

  /** The result of the token, when it is this user's, for this idea, and not expired. Undefined otherwise. */
  take(owner: string, token: string, idea: string): JevResponse | undefined {
    this.prune();
    const entry = this.entries.get(token);
    if (!entry || entry.owner !== owner || entry.idea !== idea) return undefined;
    return entry.jev;
  }

  private prune() {
    const now = this.now();
    for (const [token, entry] of this.entries) if (entry.expires <= now) this.entries.delete(token);
  }
}

export const detectCache = new DetectCache();
