/**
 * Applies one action to a step. Pure: it never changes the step it receives, it returns a
 * new one with the event added, or a closed error code. Status changes go through
 * canTransition, so the table lives in one place. Only the person acts, except for
 * delivering an AI output: a human is always in the loop.
 */

import { z } from "zod";
import {
  MAX_OUTPUT_QUESTIONS,
  OutputSchema,
  ProofSchema,
  QuestionSchema,
  StepSchema,
  type Step,
  type StepEvent,
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
  /** What the action carries: see PAYLOADS. Actions without payload take none. */
  payload?: unknown;
}

export type ActionResult =
  | { ok: true; step: Step; event: StepEvent }
  | { ok: false; code: StepActionError };

/** The status each action leads to */
const TARGET: Record<StepAction, StepStatus> = {
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
};

/** Actions that do not need the person: delivering an AI output. Every other one is theirs. */
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
  if (context.actor !== "user" && !AUTOMATIC.includes(action)) return fail("wrong_actor");
  if (action === "launch" && context.readiness !== "ready") return fail("not_ready");

  const startsFrom = STARTS_FROM[action];
  if (startsFrom !== undefined && step.status !== startsFrom) return fail("not_allowed");

  const parsed = PAYLOADS[action].safeParse(context.payload);
  if (!parsed.success) return fail("invalid_payload");
  // Already checked against the schema of this action; each case reads only its own fields
  const payload = parsed.data as { summary: string; documentRef?: string; questions: string[]; answers: string[]; text: string };

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
  }

  // An AI step keeps its status while the person hands in a proof: it is closed by confirming the output
  const keepsStatus = action === "submit_proof" && isAi && step.status === "waiting_user";
  const to = keepsStatus ? step.status : TARGET[action];
  if (!keepsStatus) {
    const verdict = canTransition(step.status, to, { step: candidate, launchedByUser: context.actor === "user" });
    if (!verdict.allowed) return fail(REFUSALS[verdict.reason](candidate));
  }

  const event: StepEvent = { at, actor: context.actor, action, from: step.status, to };
  const result = StepSchema.safeParse({ ...candidate, status: to, events: [...step.events, event] });
  if (!result.success) return fail("invalid_result");
  return { ok: true, step: result.data, event };
}
