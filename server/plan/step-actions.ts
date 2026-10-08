/**
 * Applies one action to a step. Pure: it never changes the step it receives, it returns a
 * new one with the event added, or a closed error code. Status changes go through
 * canTransition, so the table lives in one place; changing the executor is the exception,
 * because it keeps the status. Only the person acts, except for delivering an AI output
 * to an AI step: a human is always in the loop.
 */

import { z } from "zod";
import {
  EVENT_ACTIONS,
  MAX_EVENTS,
  MAX_OUTPUT_QUESTIONS,
  OutputSchema,
  ProofSchema,
  QuestionSchema,
  StepSchema,
  type Step,
  type StepEvent,
  type StepExecutor,
  type StepOutput,
  type StepStatus,
} from "./plan-model.js";
import type { Readiness } from "./step-graph.js";
import { canTransition, type TransitionRefusal } from "./step-rules.js";

export const STEP_ACTION_ERRORS = [
  "not_allowed",
  "not_ready",
  "wrong_actor",
  "rounds_exceeded",
  "missing_proof",
  "output_not_confirmed",
  "invalid_payload",
  "invalid_result",
  "executor_in_use",
  "invalid_executor_change",
  "events_full",
] as const;

export type StepActionError = (typeof STEP_ACTION_ERRORS)[number];
export type StepAction = StepEvent["action"];
export type StepActor = StepEvent["actor"];

export interface ActionContext {
  /** Injected clock: an ISO 8601 UTC instant */
  now: () => string;
  actor: StepActor;
  /** Readiness of the step in its plan, from step-graph */
  readiness: Readiness;
  /** Whether any step uses this one's result (feedsAnyStep): then it must stay an AI step */
  feedsOthers: boolean;
  /** What the action carries: see PAYLOADS. Actions without payload take none. */
  payload?: unknown;
}

export type ActionResult =
  | { ok: true; step: Step; event: StepEvent }
  | { ok: false; code: StepActionError };

/** The status each action leads to */
const TARGET: Record<Exclude<StepAction, "change_executor">, StepStatus> = {
  launch: "running",
  attach_output: "waiting_user",
  answer: "running",
  confirm_output: "done",
  reject_output: "rejected",
  submit_proof: "done",
  wait_third_party: "waiting_third_party",
  third_party_responded: "running",
  reopen: "not_started",
};

/**
 * The one status an action starts from, when its meaning needs it (a table entry that ends in
 * the same status is not enough: "running" is reached by several actions). Others: the table decides.
 */
const STARTS_FROM: Partial<Record<StepAction, StepStatus>> = {
  launch: "not_started",
  attach_output: "running",
  answer: "waiting_user",
  confirm_output: "waiting_user",
  third_party_responded: "waiting_third_party",
  reopen: "rejected",
  change_executor: "not_started",
};

/**
 * Actions that keep the status: the executor is not a status, and an AI step with a proof is closed
 * by confirming its output. Shared by applyStepAction and availableActions, so they cannot disagree.
 */
const keepsStatus = (step: Step, action: StepAction): boolean =>
  action === "change_executor" || (action === "submit_proof" && step.executor === "ai" && step.status === "waiting_user");

/** Actions that do not need the person: delivering an AI output, and only to an AI step. Every other one is theirs. */
const AUTOMATIC: readonly StepAction[] = ["attach_output"];

const noPayload = z.undefined();
const PAYLOADS: Record<StepAction, z.ZodType> = {
  launch: noPayload,
  attach_output: z.strictObject({
    summary: OutputSchema.shape.summary,
    documentRef: OutputSchema.shape.documentRef,
    questions: z.array(QuestionSchema.shape.question).max(MAX_OUTPUT_QUESTIONS),
  }),
  // One answer per question of the current output, in order
  answer: z.strictObject({ answers: z.array(QuestionSchema.shape.answer.unwrap()) }),
  confirm_output: noPayload,
  reject_output: noPayload,
  submit_proof: z.strictObject({ text: ProofSchema.shape.text }),
  wait_third_party: noPayload,
  third_party_responded: noPayload,
  reopen: noPayload,
  // Mode only for a user step; evidence only when it should change (or no longer fits)
  change_executor: z.strictObject({
    executor: StepSchema.shape.executor,
    mode: StepSchema.shape.mode,
    evidence: StepSchema.shape.evidence.optional(),
  }),
};

const fail = (code: StepActionError): ActionResult => ({ ok: false, code });

const REFUSALS: Record<TransitionRefusal, (step: Step) => StepActionError> = {
  not_allowed: () => "not_allowed",
  not_launched_by_user: () => "wrong_actor",
  rounds_exceeded: () => "rounds_exceeded",
  evidence_missing: (step) => (step.evidence.kind === "accepted_output" ? "output_not_confirmed" : "missing_proof"),
};

/** The step's outputs with the latest one replaced */
const withLatest = (outputs: StepOutput[], change: Partial<StepOutput>): StepOutput[] =>
  outputs.map((output, index) => (index === outputs.length - 1 ? { ...output, ...change } : output));

export function applyStepAction(step: Step, action: StepAction, context: ActionContext): ActionResult {
  // The history has no room left: no action can add an event, so none is applied (see availableActions)
  if (step.events.length >= MAX_EVENTS) return fail("events_full");
  if (context.actor !== "user" && (!AUTOMATIC.includes(action) || step.executor !== "ai")) return fail("wrong_actor");
  if (action === "launch" && context.readiness !== "ready") return fail("not_ready");

  const startsFrom = STARTS_FROM[action];
  if (startsFrom !== undefined && step.status !== startsFrom) return fail("not_allowed");

  const parsed = PAYLOADS[action].safeParse(context.payload);
  if (!parsed.success) return fail("invalid_payload");
  // Already checked against the schema of this action; each case reads only its own fields
  const payload = parsed.data as {
    summary: string;
    documentRef?: string;
    questions: string[];
    answers: string[];
    text: string;
    executor: StepExecutor;
    mode?: Step["mode"];
    evidence?: Step["evidence"];
  };

  const at = context.now();
  const outputs = step.outputs ?? [];
  const latest = outputs.at(-1);
  const isDraft = latest?.state === "draft";
  const isAi = step.executor === "ai";
  let candidate: Step = step;

  switch (action) {
    case "attach_output": {
      // A refinement replaces the draft it answers; a rejected version stays rejected
      const previous = isDraft ? withLatest(outputs, { state: "superseded" }) : outputs;
      const output: StepOutput = {
        version: outputs.length + 1,
        state: "draft",
        summary: payload.summary,
        ...(payload.documentRef !== undefined && { documentRef: payload.documentRef }),
        questions: payload.questions.map((question) => ({ question })),
        createdAt: at,
      };
      candidate = { ...step, outputs: [...previous, output] };
      break;
    }
    case "answer": {
      if (!isDraft) return fail("not_allowed");
      const { answers } = payload;
      if (answers.length !== latest.questions.length) return fail("invalid_payload");
      const questions = latest.questions.map((question, index) => ({ ...question, answer: answers[index], answeredAt: at }));
      candidate = { ...step, outputs: withLatest(outputs, { questions }) };
      break;
    }
    case "confirm_output":
      if (!isDraft) return fail("output_not_confirmed");
      candidate = { ...step, outputs: withLatest(outputs, { state: "confirmed", confirmedAt: at }) };
      break;
    case "reject_output":
      // A step without outputs is simply rejected
      if (isAi) {
        if (!isDraft) return fail("not_allowed");
        candidate = { ...step, outputs: withLatest(outputs, { state: "rejected" }) };
      }
      break;
    case "submit_proof":
      candidate = { ...step, proof: { text: payload.text, at, by: "user" } };
      break;
    case "change_executor": {
      const { executor, mode, evidence } = payload;
      // The request must make sense: a real change, a mode for a user step only, evidence that fits
      if (executor === step.executor) return fail("invalid_executor_change");
      if ((executor === "user") !== (mode !== undefined)) return fail("invalid_executor_change");
      if ((evidence ?? step.evidence).kind === "accepted_output" && executor !== "ai") return fail("invalid_executor_change");
      if (context.feedsOthers && executor !== "ai") return fail("executor_in_use");
      // The outputs stay as they were: a read-only history
      const { mode: _previousMode, ...rest } = step;
      candidate = { ...rest, executor, ...(mode !== undefined && { mode }), evidence: evidence ?? step.evidence };
      break;
    }
  }

  const keeps = keepsStatus(step, action);
  const to = action === "change_executor" || keeps ? step.status : TARGET[action];
  if (!keeps) {
    const verdict = canTransition(step.status, to, { step: candidate, launchedByUser: context.actor === "user" });
    if (!verdict.allowed) return fail(REFUSALS[verdict.reason](candidate));
  }

  const event: StepEvent = {
    at,
    actor: context.actor,
    action,
    from: step.status,
    to,
    ...(action === "change_executor" && { executorFrom: step.executor, executorTo: payload.executor }),
  };
  const result = StepSchema.safeParse({ ...candidate, status: to, events: [...step.events, event] });
  if (!result.success) return fail("invalid_result");
  return { ok: true, step: result.data, event };
}

/** Stands for the proof an action would bring: availability only checks that there is one */
const PROBE_PROOF = { text: "probe", at: "1970-01-01T00:00:00Z", by: "user" } as const;
const PROBE_TIME = "1970-01-01T00:00:00Z";

/**
 * The actions the person could apply to this step now, in the order of EVENT_ACTIONS. It judges
 * the step and its readiness, never a payload: the checks that need the payload itself are left
 * out, and the evidence is assumed present (see PROBE_PROOF). It reads the same tables as
 * applyStepAction (STARTS_FROM, TARGET, canTransition), so an action listed here is not refused for
 * its state, and an action not listed is.
 */
export function availableActions(step: Step, readiness: Readiness, feedsOthers: boolean): StepAction[] {
  if (step.events.length >= MAX_EVENTS) return [];
  return EVENT_ACTIONS.filter((action) => isAvailable(step, action, readiness, feedsOthers));
}

function isAvailable(step: Step, action: StepAction, readiness: Readiness, feedsOthers: boolean): boolean {
  if (action === "launch" && readiness !== "ready") return false;
  const startsFrom = STARTS_FROM[action];
  if (startsFrom !== undefined && step.status !== startsFrom) return false;

  const isDraft = step.outputs?.at(-1)?.state === "draft";
  switch (action) {
    case "answer":
    case "confirm_output":
      if (!isDraft) return false;
      break;
    case "reject_output":
      if (step.executor === "ai" && !isDraft) return false;
      break;
    case "change_executor":
      // Only an AI step whose result is used stays where it is; every other change has a valid target
      return !(feedsOthers && step.executor === "ai");
  }
  if (keepsStatus(step, action)) return true;

  return canTransition(step.status, TARGET[action], { step: probeCandidate(step, action), launchedByUser: true }).allowed;
}

/** The step as applyStepAction would leave it, with only what canTransition reads: the proof or the confirmation */
function probeCandidate(step: Step, action: StepAction): Step {
  if (action === "submit_proof") return { ...step, proof: step.proof ?? PROBE_PROOF };
  if (action === "confirm_output") return { ...step, outputs: withLatest(step.outputs ?? [], { state: "confirmed", confirmedAt: PROBE_TIME }) };
  return step;
}
