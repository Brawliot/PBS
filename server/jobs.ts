import { randomUUID } from "node:crypto";
import { HttpError } from "./request.js";

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

export class JobStore {
  private readonly jobs = new Map<string, JobState>();
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

  /** Starts `run` in the background and returns the id to poll */
  start(run: () => Promise<unknown>): string {
    this.sweep();
    if (this.jobs.size >= this.maxJobs) {
      throw new HttpError(503, "Server busy, try again shortly");
    }

    const id = randomUUID();
    this.jobs.set(id, { status: "pending", createdAt: this.now() });

    // The promise constructor calls run() and turns a synchronous throw into a rejection
    new Promise<unknown>((resolve) => resolve(run())).then(
      (result) => {
        this.jobs.set(id, { status: "done", result, finishedAt: this.now() });
      },
      (error) => {
        console.error(error);
        const message = error instanceof Error && error.message ? error.message : "Internal server error";
        this.jobs.set(id, { status: "error", message, finishedAt: this.now() });
      },
    );
    return id;
  }

  /** The state of a job, or undefined if it does not exist or has expired */
  get(id: string): JobState | undefined {
    const job = this.jobs.get(id);
    if (job && this.expired(job)) {
      this.jobs.delete(id);
      return undefined;
    }
    return job;
  }

  /** Removes finished jobs older than the TTL. Pending jobs never expire. */
  sweep(): void {
    for (const [id, job] of this.jobs) {
      if (this.expired(job)) this.jobs.delete(id);
    }
  }

  private expired(job: JobState): boolean {
    return job.status !== "pending" && this.now() - job.finishedAt > this.ttlMs;
  }
}
