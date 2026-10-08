/**
 * The plan API as a pure function: a request goes in, a status and a body come out, and the storage
 * is reached only through PlanRepository. server.ts is the only place that deals with HTTP.
 * Error bodies carry a fixed text and a code, never content of a plan.
 */

import { z } from "zod";
import { restaurantPlan } from "./plan/demo-plan.js";
import { applyPlanAction, type PlanActionError } from "./plan/plan-actions.js";
import { derivePlan } from "./plan/plan-derived.js";
import { buildPlanSkeleton } from "./plan/plan-skeleton.js";
import { EVENT_ACTIONS, FactTermSchema, IdSchema, type Plan } from "./plan/plan-model.js";
import { applyProposalAction, createProposal, proposeExpansion, type ProposalError } from "./plan/proposals.js";
import { confirmFact, proposeFact, rejectFact, type FactActionError } from "./plan/fact-actions.js";
import { FACT_KEYS, PRODUCT_TYPES } from "./plan/fact-catalog.js";
import { devRoutesAllowed } from "./security.js";
import { UUID } from "./ids.js";
import type { PlanLogRecord, PlanRepository, StoredPlan } from "./plan/plan-repository.js";
import { PlanTooLargeError, StoredPlanError } from "./plan/plan-repository.js";
import type { AttachResult, ReportRepository } from "./plan/report-repository.js";
import type { StepAction, StepActor } from "./plan/step-actions.js";

/** The one user until authentication exists. Every repository call is scoped to it; server.ts and this file are the only places that name it. */
export const LOCAL_USER = "local";


export interface PlanRequest {
  method: string;
  path: string;
  /** The raw body, as read from the socket (empty for GET) */
  body: string;
  /** Undefined when DATABASE_URL is not set: the plan routes then answer 503 */
  repo: PlanRepository | undefined;
  /** The reports the planner kept. Undefined together with repo when there is no database. */
  reports?: ReportRepository | undefined;
  /** Injected clock: an ISO 8601 UTC instant */
  now: () => string;
  env: Record<string, string | undefined>;
}

export interface PlanResponse {
  status: number;
  body: unknown;
}

/** Every failure a route can answer with: the storage codes of the plan, plus the ones of the request itself */
export type ErrorCode =
  | PlanActionError
  | FactActionError
  | ProposalError
  | "invalid_body"
  | "unknown_task"
  | "version_conflict"
  | "not_found"
  | "report_not_found"
  | "skeleton_failed"
  | "plan_too_large"
  | "storage_unavailable"
  | "internal_error";

// One fixed text per code. The status of each step action is listed here, so none is left without one.
export const FAILURE: Record<ErrorCode, { status: number; error: string }> = {
  invalid_body: { status: 400, error: "Invalid request body" },
  not_found: { status: 404, error: "Plan not found" },
  unknown_step: { status: 404, error: "Step not found" },
  invalid_payload: { status: 400, error: "The payload does not fit this action" },
  invalid_executor_change: { status: 400, error: "The executor change is not valid" },
  events_full: { status: 409, error: "This step has reached the limit of its history and cannot change" },
  wrong_actor: { status: 403, error: "This actor cannot do this action" },
  version_conflict: { status: 409, error: "The plan changed since it was loaded" },
  not_allowed: { status: 409, error: "This action is not allowed in the current state of the step" },
  not_ready: { status: 409, error: "The step is not ready to start" },
  rounds_exceeded: { status: 409, error: "The step has used all its rounds" },
  missing_proof: { status: 409, error: "The step needs a proof before it can be closed" },
  output_not_confirmed: { status: 409, error: "The output must be confirmed first" },
  executor_in_use: { status: 409, error: "Another step uses this step's result, so its executor cannot change" },
  invalid_result: { status: 500, error: "Internal server error" },
  report_not_found: { status: 404, error: "Report not found" },
  skeleton_failed: { status: 500, error: "Could not build the plan" },
  storage_unavailable: { status: 503, error: "Plan storage is not configured" },
  internal_error: { status: 500, error: "Internal server error" },
  // Facts and proposals: the same table, one HTTP status and one fixed text per code
  not_proposed: { status: 409, error: "This fact is not waiting for a decision" },
  unknown_fact: { status: 404, error: "Fact not found" },
  invalid_fact: { status: 400, error: "The fact does not fit the catalogue" },
  not_confirmed: { status: 409, error: "The decision behind this suggestion is no longer confirmed" },
  unknown_task: { status: 404, error: "Task not found" },
  not_expandable: { status: 409, error: "This task cannot be expanded yet" },
  unknown_proposal: { status: 404, error: "Proposal not found" },
  invalid_proposal: { status: 400, error: "The proposal is not valid" },
  unknown_reason: { status: 400, error: "The proposal refers to something not in the plan" },
  too_large: { status: 400, error: "The proposal is too large" },
  duplicate_pending: { status: 409, error: "A proposal for this task is already waiting for a decision" },
  id_taken: { status: 409, error: "An id of the proposal is already in use" },
  already_decided: { status: 409, error: "This proposal was already decided" },
  needs_ai: { status: 409, error: "There is no ready-made suggestion for this decision yet." },
  not_available: { status: 409, error: "This is not available in the current state of the plan" },
  plan_too_large: { status: 409, error: "This change would make the plan too large to store" },
};

const fail = (code: ErrorCode): PlanResponse => ({
  status: FAILURE[code].status,
  body: { error: FAILURE[code].error, code },
});

const NOT_FOUND: PlanResponse = { status: 404, body: { error: "Not found" } };

/** The paths this module answers, so server.ts can hand them over */
export function isPlanPath(path: string): boolean {
  return path === "/api/plan" || path.startsWith("/api/plan/") || path.startsWith("/api/dev/");
}

// The body of an action: the actor is not here, the server sets it. strictObject refuses any other key.
const ActionBody = z.strictObject({
  action: z.enum(EVENT_ACTIONS),
  payload: z.unknown().optional(),
  expectedVersion: z.number().int().min(1),
});

const DEMO_TITLE = "Restaurante japonés";

export async function handlePlanRequest(request: PlanRequest): Promise<PlanResponse> {
  try {
    return await route(request);
  } catch (error) {
    // Only the code reaches the log: the message of a storage error can carry values
    const code = error instanceof StoredPlanError ? error.code : (error as { code?: unknown }).code;
    console.error("Plan request failed:", typeof code === "string" ? code : "unknown");
    return fail("internal_error");
  }
}

async function route(request: PlanRequest): Promise<PlanResponse> {
  const { method, path, env } = request;
  const isDev = path.startsWith("/api/dev/");
  if (isDev && !devRoutesAllowed(env)) return NOT_FOUND;

  if (method === "POST" && path === "/api/plan") return createPlan(request);

  const fact = path.match(/^\/api\/plan\/([^/]+)\/facts$/);
  if (method === "POST" && fact) return createFact(request, fact[1]);
  const factDecision = path.match(/^\/api\/plan\/([^/]+)\/facts\/([^/]+)\/(confirm|reject)$/);
  if (method === "POST" && factDecision) return decideFact(request, factDecision[1], factDecision[2], factDecision[3] as "confirm" | "reject");
  const gap = path.match(/^\/api\/plan\/([^/]+)\/gaps\/([^/]+)\/proposal$/);
  if (method === "POST" && gap) return proposeForGap(request, gap[1], gap[2]);
  const proposal = path.match(/^\/api\/plan\/([^/]+)\/proposals\/([^/]+)\/(accept|reject)$/);
  if (method === "POST" && proposal) return decideProposal(request, proposal[1], proposal[2], proposal[3] as "accept" | "reject");

  const plan = path.match(/^\/api\/plan\/([^/]+)$/);
  if (method === "GET" && plan) return getPlan(request, plan[1]);

  const action = path.match(/^\/api\/plan\/([^/]+)\/steps\/([^/]+)\/actions$/);
  if (method === "POST" && action) return userAction(request, action[1], action[2]);

  if (isDev && method === "POST" && path === "/api/dev/demo-plan") return createDemoPlan(request);

  const fake = path.match(/^\/api\/dev\/plan\/([^/]+)\/steps\/([^/]+)\/fake-output$/);
  if (isDev && method === "POST" && fake) return fakeOutput(request, fake[1], fake[2]);
  const fakeProposal = path.match(/^\/api\/dev\/plan\/([^/]+)\/facts\/fake-proposal$/);
  if (isDev && method === "POST" && fakeProposal) return fakeFactProposal(request, fakeProposal[1]);

  return NOT_FOUND;
}

async function getPlan(request: PlanRequest, id: string): Promise<PlanResponse> {
  if (!UUID.test(id)) return fail("not_found");
  if (!request.repo) return fail("storage_unavailable");
  const stored = await request.repo.get(id, LOCAL_USER);
  if (!stored) return fail("not_found");
  return { status: 200, body: { ...storedBody(stored), derived: derivePlan(stored.plan), catalog: CATALOG } };
}

/** What the screen can offer for a fact: the keys, and the catalogue values of the keys that have them */
const CATALOG = { factKeys: [...FACT_KEYS], factValues: { product_type: [...PRODUCT_TYPES] } };

// ---- Facts and proposals. The actor is always the person, set here: no body takes one (strict schemas).

const VersionBody = z.strictObject({ expectedVersion: z.number().int().min(1) });
const CreateFactBody = z.strictObject({
  key: FactTermSchema,
  value: FactTermSchema,
  confirm: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
});

type Decision = { ok: true; plan: Plan; logs: PlanLogRecord[] } | { ok: false; code: ErrorCode };

/**
 * The one path that changes facts and proposals: load, check the version, apply, and save the plan and
 * its log entries in one write. A second request with the same version gets version_conflict.
 */
async function changeDecisions(
  request: PlanRequest,
  id: string,
  // null: no version check, for the development route only
  expectedVersion: number | null,
  decide: (plan: Plan, at: string) => Decision,
  status: 200 | 201,
): Promise<PlanResponse> {
  if (!UUID.test(id)) return fail("not_found");
  if (!request.repo) return fail("storage_unavailable");
  const stored = await request.repo.get(id, LOCAL_USER);
  if (!stored) return fail("not_found");
  if (expectedVersion !== null && expectedVersion !== stored.version) return fail("version_conflict");

  const result = decide(stored.plan, request.now());
  if (!result.ok) return fail(result.code);
  const saved = await request.repo.update(id, LOCAL_USER, stored.version, result.plan, [], result.logs);
  if (!saved.ok) return fail(saved.code);
  return {
    status,
    body: {
      id: saved.stored.id,
      version: saved.stored.version,
      plan: saved.stored.plan,
      derived: derivePlan(saved.stored.plan),
    },
  };
}

function parseBody<T>(raw: string, schema: z.ZodType<T>): T | undefined {
  const parsed = schema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : undefined;
}

async function createFact(request: PlanRequest, id: string): Promise<PlanResponse> {
  const body = parseBody(request.body, CreateFactBody);
  if (!body) return fail("invalid_body");
  return changeDecisions(
    request,
    id,
    body.expectedVersion,
    (plan, at) => {
      const made = proposeFact(plan, { key: body.key, value: body.value }, { now: () => at, actor: "user" });
      if (!made.ok) return made;
      const logs: PlanLogRecord[] = [{ kind: "fact_proposed", actor: "user", refId: made.fact.id, at }];
      if (body.confirm !== true) return { ok: true, plan: made.plan, logs };
      // Proposed and confirmed in the same write: one version, two log entries
      const confirmed = confirmFact(made.plan, made.fact.id, { now: () => at, actor: "user" });
      if (!confirmed.ok) return confirmed;
      return { ok: true, plan: confirmed.plan, logs: [...logs, { kind: "fact_confirmed", actor: "user", refId: made.fact.id, at }] };
    },
    201,
  );
}

async function decideFact(request: PlanRequest, id: string, factId: string, decision: "confirm" | "reject"): Promise<PlanResponse> {
  const body = parseBody(request.body, VersionBody);
  if (!body) return fail("invalid_body");
  if (!IdSchema.safeParse(factId).success) return fail("unknown_fact");
  return changeDecisions(
    request,
    id,
    body.expectedVersion,
    (plan, at) => {
      const options = { now: () => at, actor: "user" as const };
      const result = decision === "confirm" ? confirmFact(plan, factId, options) : rejectFact(plan, factId, options);
      if (!result.ok) return result;
      const kind = decision === "confirm" ? "fact_confirmed" : "fact_rejected";
      return { ok: true, plan: result.plan, logs: [{ kind, actor: "user", refId: factId, at }] };
    },
    200,
  );
}

async function proposeForGap(request: PlanRequest, id: string, taskId: string): Promise<PlanResponse> {
  const body = parseBody(request.body, VersionBody);
  if (!body) return fail("invalid_body");
  return changeDecisions(
    request,
    id,
    body.expectedVersion,
    (plan, at) => {
      if (!IdSchema.safeParse(taskId).success || !plan.tasks.some((task) => task.id === taskId)) return { ok: false, code: "unknown_task" };
      const expansion = proposeExpansion(plan, taskId);
      if (!expansion.ok) return expansion;
      const created = createProposal(plan, expansion.proposal, { now: () => at });
      if (!created.ok) return created;
      return { ok: true, plan: created.plan, logs: [{ kind: "proposal_created", actor: "user", refId: created.proposal.id, at }] };
    },
    201,
  );
}

async function decideProposal(request: PlanRequest, id: string, proposalId: string, action: "accept" | "reject"): Promise<PlanResponse> {
  const body = parseBody(request.body, VersionBody);
  if (!body) return fail("invalid_body");
  return changeDecisions(
    request,
    id,
    body.expectedVersion,
    (plan, at) => {
      const result = applyProposalAction(plan, proposalId, action, { now: () => at, actor: "user" });
      if (!result.ok) return result;
      const kind = action === "accept" ? "proposal_accepted" : "proposal_rejected";
      return { ok: true, plan: result.plan, logs: [{ kind, actor: "user", refId: proposalId, at }] };
    },
    200,
  );
}

/** Development only: a fact proposed by the AI from its first AI step, so the screen has one to show */
async function fakeFactProposal(request: PlanRequest, id: string): Promise<PlanResponse> {
  return changeDecisions(
    request,
    id,
    null,
    (plan, at) => {
      const step = plan.steps.find((candidate) => candidate.executor === "ai");
      if (!step) return { ok: false, code: "unknown_step" };
      const made = proposeFact(
        plan,
        { key: { kind: "catalog", id: "launch_channel" }, value: { kind: "other", text: "Test channel" }, stepId: step.id },
        { now: () => at, actor: "ai" },
      );
      if (!made.ok) return made;
      return { ok: true, plan: made.plan, logs: [{ kind: "fact_proposed", actor: "ai", refId: made.fact.id, at }] };
    },
    201,
  );
}

async function userAction(request: PlanRequest, id: string, stepId: string): Promise<PlanResponse> {
  if (!UUID.test(id)) return fail("not_found");
  if (!IdSchema.safeParse(stepId).success) return fail("unknown_step");
  const body = parseJson(request.body);
  const parsed = ActionBody.safeParse(body);
  if (!parsed.success) return fail("invalid_body");
  return changePlan(request, id, stepId, {
    actor: "user",
    action: parsed.data.action,
    payload: parsed.data.payload,
    expectedVersion: parsed.data.expectedVersion,
  });
}

// The plan is made from a report the server kept: the body names the report and nothing else
const CreatePlanBody = z.strictObject({ reportId: z.string().regex(UUID) });
/** The title is the idea, cut to this many characters */
const TITLE_CHARS = 80;

/**
 * POST /api/plan: one plan per report. A report that has a plan gives that plan back (200). Otherwise the
 * plan is built from the report by the fixed rules and linked to it (201). Two requests at once for the
 * same report may both build a plan, but only one is linked; the other removes its own and answers with
 * the linked one (200), so the user never ends up with two plans.
 */
async function createPlan(request: PlanRequest): Promise<PlanResponse> {
  // The body is checked first: a bad request is 400 whether or not the storage is there
  const parsed = CreatePlanBody.safeParse(parseJson(request.body));
  if (!parsed.success) return fail("invalid_body");
  if (!request.repo || !request.reports) return fail("storage_unavailable");
  const { reportId } = parsed.data;

  const stored = await request.reports.get(reportId, LOCAL_USER);
  if (!stored) return fail("report_not_found");
  if (stored.planId !== null) return { status: 200, body: { id: stored.planId } };

  let skeleton: ReturnType<typeof buildPlanSkeleton>;
  try {
    skeleton = buildPlanSkeleton(stored.report);
  } catch {
    return fail("skeleton_failed");
  }
  if (!skeleton.ok) return fail("skeleton_failed");

  const title = [...stored.report.input.idea].slice(0, TITLE_CHARS).join("");
  let plan: StoredPlan;
  try {
    plan = await request.repo.create(LOCAL_USER, title, skeleton.plan);
  } catch (error) {
    if (error instanceof PlanTooLargeError) return fail("plan_too_large");
    throw error;
  }
  // A plan that is not linked to its report is never handed out: it is removed on every path that does not keep it
  let linked: AttachResult;
  try {
    linked = await request.reports.attachPlan(reportId, LOCAL_USER, plan.id);
  } catch (error) {
    await request.repo.remove(plan.id, LOCAL_USER);
    throw error;
  }
  if (linked.ok && linked.attached) return { status: 201, body: { id: plan.id } };

  await request.repo.remove(plan.id, LOCAL_USER);
  if (!linked.ok) return fail("report_not_found");
  return { status: 200, body: { id: linked.planId } };
}

async function createDemoPlan(request: PlanRequest): Promise<PlanResponse> {
  if (!request.repo) return fail("storage_unavailable");
  const stored = await request.repo.create(LOCAL_USER, DEMO_TITLE, restaurantPlan());
  return { status: 201, body: { id: stored.id } };
}

/** Development only: an AI output for a step, so the screen has something to show. The content is made up. */
async function fakeOutput(request: PlanRequest, id: string, stepId: string): Promise<PlanResponse> {
  if (!UUID.test(id)) return fail("not_found");
  if (!IdSchema.safeParse(stepId).success) return fail("unknown_step");
  return changePlan(request, id, stepId, {
    actor: "ai",
    action: "attach_output",
    payload: { summary: "Resultado de prueba (generado a mano, no por IA)", questions: ["¿Quieres cambiar algo?"] },
  });
}

/** The one path that changes a step: load, check the version, apply, save with the event */
async function changePlan(
  request: PlanRequest,
  id: string,
  stepId: string,
  change: { actor: StepActor; action: StepAction; payload?: unknown; expectedVersion?: number },
): Promise<PlanResponse> {
  if (!request.repo) return fail("storage_unavailable");
  const stored = await request.repo.get(id, LOCAL_USER);
  if (!stored) return fail("not_found");
  if (change.expectedVersion !== undefined && change.expectedVersion !== stored.version) return fail("version_conflict");

  const result = applyPlanAction(stored.plan, stepId, change.action, {
    now: request.now,
    actor: change.actor,
    payload: change.payload,
  });
  if (!result.ok) return fail(result.code);

  const saved = await request.repo.update(id, LOCAL_USER, stored.version, result.plan, [{ stepId, event: result.event }]);
  if (!saved.ok) return fail(saved.code);
  return {
    status: 200,
    body: {
      id: saved.stored.id,
      version: saved.stored.version,
      plan: saved.stored.plan,
      derived: derivePlan(saved.stored.plan),
      event: result.event,
    },
  };
}

const storedBody = (stored: StoredPlan) => ({
  id: stored.id,
  title: stored.title,
  version: stored.version,
  plan: stored.plan,
});

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
