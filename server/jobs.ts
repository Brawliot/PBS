import { randomUUID } from "node:crypto";
import { HttpError } from "./request.js";
import { logFailure } from "./log.js";

/** In-memory jobs: the planner runs in the background and the client polls for the result */

export type JobState =
  | { status: "pending"; createdAt: number }
  | { status: "done"; result: unknown; finishedAt: number }
  | { status: "error"; message: string; finishedAt: number };

export interface JobStoreOptions {
  ttlMs: number; // how long a finished job stays available
  maxJobs: number; // pending and finished jobs kept at once
  now?: () => number; // injectable clock, so tests do not wait
}

/** A job and the user it belongs to: only that user can read it */
interface JobEntry {
  owner: string;
  state: JobState;
}

export class JobStore {
  private readonly jobs = new Map<string, JobEntry>();
  private readonly ttlMs: number;
  private readonly maxJobs: number;
  private readonly now: () => number;

  constructor(options: JobStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.maxJobs = options.maxJobs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Number of stored jobs, pending or finished */
  get size(): number {
    return this.jobs.size;
  }

  /** Starts `run` in the background for `owner` and returns the id to poll */
  start(owner: string, run: () => Promise<unknown>): string {
    this.sweep();
    if (this.jobs.size >= this.maxJobs) {
      throw new HttpError(503, "Server busy, try again shortly");
    }

    const id = randomUUID();
    this.jobs.set(id, { owner, state: { status: "pending", createdAt: this.now() } });

    // The promise constructor calls run() and turns a synchronous throw into a rejection
    new Promise<unknown>((resolve) => resolve(run())).then(
      (result) => {
        this.jobs.set(id, { owner, state: { status: "done", result, finishedAt: this.now() } });
      },
      (error) => {
        logFailure("planner job", error);
        const message = error instanceof Error && error.message ? error.message : "Internal server error";
        this.jobs.set(id, { owner, state: { status: "error", message, finishedAt: this.now() } });
      },
    );
    return id;
  }

  /**
   * The state of a job, or undefined if it does not exist, has expired, or belongs to another owner: the
   * caller cannot tell these apart, so a job of someone else looks the same as one that is not there.
   */
  get(id: string, owner: string): JobState | undefined {
    const entry = this.jobs.get(id);
    if (!entry || entry.owner !== owner) return undefined;
    if (this.expired(entry.state)) {
      this.jobs.delete(id);
      return undefined;
    }
    return entry.state;
  }

  /** Removes finished jobs older than the TTL. Pending jobs never expire. */
  sweep(): void {
    for (const [id, entry] of this.jobs) {
      if (this.expired(entry.state)) this.jobs.delete(id);
    }
  }

  private expired(job: JobState): boolean {
    return job.status !== "pending" && this.now() - job.finishedAt > this.ttlMs;
  }
}
