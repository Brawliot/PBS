/**
 * The contract every agent level shares. An agent only PROPOSES: it returns proposals, proposed facts,
 * requests and questions, and never touches the plan. Each answer goes through the same pipeline, in this
 * order: (a) the schema of the level, (b) the plan with the answer applied to a copy, checked by checkPlan,
 * (c) the relevance judge (Jev), (d) conversion to the proposals of proposals.ts, which the person accepts or
 * rejects. The level files (plan-agent.ts, department-agent.ts, task-agent.ts) say what each step checks.
 *
 * A failure is retried up to MAX_AGENT_ATTEMPTS times. If it still fails, the caller gets a typed error and
 * nothing is kept: no level ever stores a half-validated answer.
 */

import { z } from "zod";
import { newProblems } from "../plan-actions.js";
import { checkPlan } from "../plan-check.js";
import { FactTermSchema, IdSchema, type FactTerm, type Plan } from "../plan-model.js";
import { isAllowedFact, isFactKeyId } from "../fact-catalog.js";

// Unmeasured limits, tune with real runs (the same kind as the step contract's)
/** Most attempts at one agent call: the first try plus two retries */
export const MAX_AGENT_ATTEMPTS = 3;
/** Characters of one text an agent may return (a question, a request, a finding) */
export const MAX_AGENT_TEXT = 300;
/** Characters of the idea the agents receive. The person's text is cut to this, never refused */
export const MAX_AGENT_IDEA = 2000;
/** Confirmed facts an agent receives as context: the most recent ones, when there are more */
export const MAX_AGENT_FACTS = 50;
/** Facts an agent may propose in one answer */
export const MAX_FACT_PROPOSALS = 10;
/** Requests an agent may send in one answer (to the plan level or to a department) */
export const MAX_REQUESTS = 5;
/** Questions an agent may ask the person in one answer */
export const MAX_AGENT_QUESTIONS = 5;

export const AGENT_ERRORS = [
  "agent_failed",
  "invalid_output",
  "invalid_result",
  "relevance_unavailable",
  "not_relevant",
  "unknown_department",
  "unknown_task",
  "id_taken",
  "not_confirmed",
  "invalid_proposal",
  "duplicate_pending",
  "too_large",
] as const;
export type AgentError = (typeof AGENT_ERRORS)[number];

export type AgentResult<T> = { ok: true; value: T } | { ok: false; code: AgentError };

export const fail = (code: AgentError): { ok: false; code: AgentError } => ({ ok: false, code });

/** Errors that a new attempt may fix: the model answered badly, or a check or the judge failed */
const RETRYABLE: ReadonlySet<AgentError> = new Set<AgentError>([
  "agent_failed",
  "invalid_output",
  "invalid_result",
  "relevance_unavailable",
  "not_relevant",
]);

/**
 * Runs one attempt again while it fails with a retryable code, up to `attempts` times. Any other code is
 * final at once (a wrong department id does not get better by asking again). Returns the last result.
 */
export async function withAttempts<T>(once: () => Promise<AgentResult<T>>, attempts: number = MAX_AGENT_ATTEMPTS): Promise<AgentResult<T>> {
  let last: AgentResult<T> = fail("agent_failed");
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await once();
    if (last.ok || !RETRYABLE.has(last.code)) return last;
  }
  return last;
}

/** The model, behind one method. The real one calls OpenAI (openai-model.ts); tests use a fake. */
export interface AgentRequest {
  /** Which level is asking, used for the name of the schema sent to the model */
  role: string;
  system: string;
  /** The user's text is only ever inside this message, between tags, and is data, never instructions */
  user: string;
  /** The shape the answer must have. The caller validates it again after the call */
  schema: z.ZodType;
}

export interface AgentModel {
  /** Resolves to the parsed JSON the model produced. Rejects on any failure (the caller maps it to agent_failed). */
  complete(request: AgentRequest): Promise<unknown>;
}

/**
 * Checks that the idea and the answer are relevant (Jev). The judge throws when Jev cannot answer: that is
 * relevance_unavailable, and the attempt is retried. `null` is the one case where no judge is called: the
 * manual script with AGENTS_JEV unset, and the result says so (checked: false).
 */
export interface RelevanceJudge {
  judge(idea: string, proposed: string): Promise<boolean>;
}

export async function judgeRelevance(
  judge: RelevanceJudge | null,
  idea: string,
  proposed: string,
): Promise<AgentResult<{ checked: boolean }>> {
  if (judge === null) return { ok: true, value: { checked: false } };
  let fits: boolean;
  try {
    fits = await judge.judge(idea, proposed);
  } catch {
    return fail("relevance_unavailable");
  }
  return fits ? { ok: true, value: { checked: true } } : fail("not_relevant");
}

/**
 * Whether applying an answer keeps the plan valid: no problem may appear that the plan did not already have.
 * `after` is a copy, so the real plan is never changed by this check.
 */
export function keepsPlanValid(before: Plan, after: Plan): boolean {
  return newProblems(checkPlan(before), checkPlan(after)).length === 0;
}

/** The text a judge reads about a proposal: titles and summaries only, cut to the limit */
export function clip(text: string, max: number = MAX_AGENT_IDEA): string {
  return text.length <= max ? text : text.slice(0, max);
}

// ---- Shared shapes of an answer (the parts every level returns besides its proposals)

const shortText = z
  .string()
  .trim()
  .min(1)
  .max(MAX_AGENT_TEXT)
  .refine((value) => !value.includes("\u0000"), "NUL is not allowed");

/** A fact the agent suggests. The plan keeps it as proposed until the person confirms it (fact-actions.ts) */
export const FactProposalSchema = z.strictObject({
  key: FactTermSchema,
  value: FactTermSchema,
});
export type FactProposal = z.infer<typeof FactProposalSchema>;

/** A request: something an agent needs from the plan level, or from one department */
export const RequestSchema = z.strictObject({
  to: z.union([z.literal("plan"), IdSchema]),
  text: shortText,
});
export type Request = z.infer<typeof RequestSchema>;

/** The extra parts of every answer: facts, requests and questions for the person */
export const AnswerExtrasSchema = z.strictObject({
  facts: z.array(FactProposalSchema).max(MAX_FACT_PROPOSALS),
  requests: z.array(RequestSchema).max(MAX_REQUESTS),
  questions: z.array(shortText).max(MAX_AGENT_QUESTIONS),
});
export type AnswerExtras = z.infer<typeof AnswerExtrasSchema>;

export { shortText };

/** The dependencies of one agent call: the model, the judge (null when Jev is not called) and the attempts */
export interface AgentDeps {
  model: AgentModel;
  judge: RelevanceJudge | null;
  /** Most attempts; the policy's MAX_AGENT_ATTEMPTS when omitted */
  attempts?: number;
}

/** What an agent receives about the business: the idea, and only the facts the person confirmed */
export interface AgentContext {
  idea: string;
  /** The confirmed facts, with their ids: an answer cites the ids it is derived from */
  facts: { id: string; key: FactTerm; value: FactTerm }[];
}

/** The context of a plan: the idea cut to its limit, and the most recent confirmed facts (never a proposed or rejected one) */
export function contextOf(idea: string, plan: Plan): AgentContext {
  const confirmed = (plan.facts ?? []).filter((fact) => fact.status === "confirmed");
  return {
    idea: clip(idea),
    facts: confirmed.slice(-MAX_AGENT_FACTS).map((fact) => ({ id: fact.id, key: fact.key, value: fact.value })),
  };
}

/** Whether every fact an answer proposes is a key and value the fact catalogue allows (fact-catalog.ts) */
export function factProposalsValid(facts: FactProposal[]): boolean {
  return facts.every((fact) => (fact.key.kind === "catalog" ? isFactKeyId(fact.key.id) : true) && isAllowedFact(fact.key, fact.value));
}

/** Maps a code of the proposal rules to an agent error: the ones the agent can cause keep their name, the rest is an invalid result */
export function agentErrorOf(code: string): AgentError {
  return (AGENT_ERRORS as readonly string[]).includes(code) ? (code as AgentError) : "invalid_result";
}
