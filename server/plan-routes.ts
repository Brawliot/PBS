/**
 * The plan API as a pure function: a request goes in, a status and a body come out, and the storage
 * is reached only through PlanRepository. server.ts is the only place that deals with HTTP.
 * Error bodies carry a fixed text and a code, never content of a plan.
 */

import { z } from "zod";
import { restaurantPlan } from "./plan/demo-plan.js";
import { applyPlanAction, type PlanActionError } from "./plan/plan-actions.js";
import { derivePlan } from "./plan/plan-derived.js";
import { EVENT_ACTIONS, IdSchema } from "./plan/plan-model.js";
import type { PlanRepository, StoredPlan } from "./plan/plan-repository.js";
import { StoredPlanError } from "./plan/plan-repository.js";
import type { StepAction, StepActor } from "./plan/step-actions.js";

/** The one user until authentication exists. Every repository call is scoped to it, and only this file names it. */
export const LOCAL_USER = "local";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlanRequest {
  method: string;
  path: string;
  /** The raw body, as read from the socket (empty for GET) */
  body: string;
  /** Undefined when DATABASE_URL is not set: the plan routes then answer 503 */
  repo: PlanRepository | undefined;
  /** Injected clock: an ISO 8601 UTC instant */
  now: () => string;
  env: Record<string, string | undefined>;
}

export interface PlanResponse {
  status: number;
  body: unknown;
}

/** Every failure a route can answer with: the storage codes of the plan, plus the ones of the request itself */
type ErrorCode =
  | PlanActionError
  | "invalid_body"
  | "version_conflict"
  | "not_found"
  | "not_implemented"
  | "storage_unavailable"
  | "internal_error";

// One fixed text per code. The status of each step action is listed here, so none is left without one.
const FAILURE: Record<ErrorCode, { status: number; error: string }> = {
  invalid_body: { status: 400, error: "Invalid request body" },
  not_found: { status: 404, error: "Plan not found" },
  unknown_step: { status: 404, error: "Step not found" },
  invalid_payload: { status: 400, error: "The payload does not fit this action" },
  invalid_executor_change: { status: 400, error: "The executor change is not valid" },
  wrong_actor: { status: 403, error: "This actor cannot do this action" },
  version_conflict: { status: 409, error: "The plan changed since it was loaded" },
  not_allowed: { status: 409, error: "This action is not allowed in the current state of the step" },
  not_ready: { status: 409, error: "The step is not ready to start" },
  rounds_exceeded: { status: 409, error: "The step has used all its rounds" },
  missing_proof: { status: 409, error: "The step needs a proof before it can be closed" },
  output_not_confirmed: { status: 409, error: "The output must be confirmed first" },
  executor_in_use: { status: 409, error: "Another step uses this step's result, so its executor cannot change" },
  invalid_result: { status: 500, error: "Internal server error" },
  not_implemented: { status: 501, error: "Plan generation is not available yet" },
  storage_unavailable: { status: 503, error: "Plan storage is not configured" },
  internal_error: { status: 500, error: "Internal server error" },
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
  if (isDev && env.ENABLE_DEV_ROUTES !== "1") return NOT_FOUND;

  if (method === "POST" && path === "/api/plan") return fail("not_implemented");

  const plan = path.match(/^\/api\/plan\/([^/]+)$/);
  if (method === "GET" && plan) return getPlan(request, plan[1]);

  const action = path.match(/^\/api\/plan\/([^/]+)\/steps\/([^/]+)\/actions$/);
  if (method === "POST" && action) return userAction(request, action[1], action[2]);

  if (isDev && method === "POST" && path === "/api/dev/demo-plan") return createDemoPlan(request);

  const fake = path.match(/^\/api\/dev\/plan\/([^/]+)\/steps\/([^/]+)\/fake-output$/);
  if (isDev && method === "POST" && fake) return fakeOutput(request, fake[1], fake[2]);

  return NOT_FOUND;
}

async function getPlan(request: PlanRequest, id: string): Promise<PlanResponse> {
  if (!UUID.test(id)) return fail("not_found");
  if (!request.repo) return fail("storage_unavailable");
  const stored = await request.repo.get(id, LOCAL_USER);
  if (!stored) return fail("not_found");
  return { status: 200, body: { ...storedBody(stored), derived: derivePlan(stored.plan) } };
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
