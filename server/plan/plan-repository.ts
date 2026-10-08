/**
 * Storage of plans: what every repository promises, and the checks that a plan goes through on the
 * way in and out. A plan is one JSON document with a version (optimistic lock). Each change appends
 * its events in the same write. Every method takes the user: nothing is read or written without it.
 * The errors carry codes and never the content of a plan.
 */

import { checkPlan } from "./plan-check.js";
import { EVENT_ACTORS, MAX_DOCUMENT_BYTES, MAX_TITLE, parsePlan, type Plan, type StepEvent } from "./plan-model.js";

/** The kinds of the decision log (plan_log.kind in the migrations) */
export const PLAN_LOG_KINDS = ["fact_proposed", "fact_confirmed", "fact_rejected", "proposal_created", "proposal_accepted", "proposal_rejected"] as const;

/** A plan whose document would be over MAX_DOCUMENT_BYTES. Only the code reaches a response. */
export class PlanTooLargeError extends Error {
  readonly code = "plan_too_large";
  constructor() {
    super("Plan is too large to store");
  }
}

/** The version of the stored document. A row with another one is not read: a migration has to decide what it means. */
export const PLAN_SCHEMA_VERSION = 1;

export interface StoredPlan {
  id: string;
  title: string;
  version: number;
  plan: Plan;
}

/** One entry of the history, with the step it belongs to */
export interface PlanEventRecord {
  stepId: string;
  event: StepEvent;
}

/** One decision on a fact or a proposal. The actor is set by the server, never by the request. */
export interface PlanLogRecord {
  kind: (typeof PLAN_LOG_KINDS)[number];
  actor: (typeof EVENT_ACTORS)[number];
  refId: string;
  at: string;
}

export type UpdateResult = { ok: true; stored: StoredPlan } | { ok: false; code: "not_found" | "version_conflict" | "plan_too_large" };

export interface PlanRepository {
  create(userId: string, title: string, plan: Plan): Promise<StoredPlan>;
  get(id: string, userId: string): Promise<StoredPlan | undefined>;
  /** Writes the plan, its step events and its decision log in one step, under the version the caller read */
  update(id: string, userId: string, expectedVersion: number, plan: Plan, events: PlanEventRecord[], logs?: PlanLogRecord[]): Promise<UpdateResult>;
  /** Removes a plan that was created and never handed out: the loser of two requests for the same report */
  remove(id: string, userId: string): Promise<void>;
}

/** A stored row that cannot be read. The message is fixed: the code says why, and nothing from the row goes in. */
export class StoredPlanError extends Error {
  constructor(readonly code: "schema_mismatch" | "invalid_document") {
    super("Stored plan could not be read");
  }
}

/** Turns a stored row into a plan: the schema version must be the current one, and the document must pass parsePlan */
export function readStoredPlan(schemaVersion: number, document: unknown): Plan {
  if (schemaVersion !== PLAN_SCHEMA_VERSION) throw new StoredPlanError("schema_mismatch");
  try {
    return parsePlan(document);
  } catch {
    throw new StoredPlanError("invalid_document");
  }
}

/** What a new plan must satisfy before it is stored: a title, a valid document and no problem at all */
export function preparePlan(title: string, plan: Plan): { title: string; plan: Plan } {
  const clean = title.trim();
  if (clean.length === 0 || clean.length > MAX_TITLE) throw new Error("Invalid plan title");
  const valid = parsePlan(plan);
  if (Buffer.byteLength(JSON.stringify(valid)) > MAX_DOCUMENT_BYTES) throw new PlanTooLargeError();
  if (checkPlan(valid).length > 0) throw new Error("A new plan must have no problems");
  return { title: clean, plan: valid };
}
