import { randomUUID } from "node:crypto";
import { HttpError } from "./request.js";
import { logFailure } from "./log.js";
import { stageRank, type PlannerStage } from "./planner/stages.js";

/** In-memory jobs: the planner runs in the background and the client polls for the result */

export type JobState =
  | { status: "pending"; createdAt: number; stage?: PlannerStage }
  | { status: "done"; result: unknown; finishedAt: number }
  | { status: "error"; message: string; finishedAt: number };

export interface JobStoreOptions {
  ttlMs: number; // how long a finished job stays available
  maxJobs: number; // pending and finished jobs kept at once
  now?: () => number; // injectable clock, so tests do not wait
}

/** A job and the user it belongs to: only that user can read it. The abort stops the work when the job is cancelled. */
interface JobEntry {
  owner: string;
  state: JobState;
  abort: AbortController;
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

  /**
   * Starts `run` in the background for `owner` and returns the id to poll. `run` gets a signal that is aborted on
   * cancel, and `report`, which says the step the run is in (a later step only; an earlier one is ignored).
   */
  start(owner: string, run: (signal: AbortSignal, report: (stage: PlannerStage) => void) => Promise<unknown>): string {
    this.sweep();
    if (this.jobs.size >= this.maxJobs) {
      throw new HttpError(503, "Server busy, try again shortly");
    }

    const id = randomUUID();
    const abort = new AbortController();
    this.jobs.set(id, { owner, state: { status: "pending", createdAt: this.now() }, abort });

    // The promise constructor calls run() and turns a synchronous throw into a rejection
    const report = (stage: PlannerStage) => this.advance(id, stage);
    new Promise<unknown>((resolve) => resolve(run(abort.signal, report))).then(
      (result) => {
        this.finish(id, owner, { status: "done", result, finishedAt: this.now() });
      },
      (error) => {
        // A cancelled job fails on purpose (its request was aborted): that is not a failure to log
        if (!abort.signal.aborted) logFailure("planner job", error);
        const message = error instanceof Error && error.message ? error.message : "Internal server error";
        this.finish(id, owner, { status: "error", message, finishedAt: this.now() });
      },
    );
    return id;
  }

  /**
   * Cancels a pending job of `owner`: its work is aborted and it is removed, so polling it answers not found.
   * Returns false when there is no such pending job (unknown, someone else's, or already finished).
   */
  cancel(id: string, owner: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry || entry.owner !== owner || entry.state.status !== "pending") return false;
    this.jobs.delete(id);
    entry.abort.abort();
    return true;
  }

  /** Moves a pending job to a later step. Unknown, finished or cancelled jobs, and earlier steps, change nothing. */
  private advance(id: string, stage: PlannerStage): void {
    const entry = this.jobs.get(id);
    if (!entry || entry.state.status !== "pending") return;
    if (stageRank(stage) <= stageRank(entry.state.stage)) return;
    this.jobs.set(id, { ...entry, state: { ...entry.state, stage } });
  }

  /** Stores the outcome of a job. A job cancelled meanwhile has no entry, so its late outcome is dropped. */
  private finish(id: string, owner: string, state: Exclude<JobState, { status: "pending" }>): void {
    const entry = this.jobs.get(id);
    if (!entry) return;
    this.jobs.set(id, { ...entry, owner, state });
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
