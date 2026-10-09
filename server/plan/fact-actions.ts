/**
 * Actions on the facts of a project. Pure, with the same shape as applyStepAction: a plan goes in,
 * { ok, plan, ... } or { ok: false, code } comes out, the clock is injected and nothing received is
 * changed. A fact is proposed by the AI (from one of its steps) or by the person; only the person
 * confirms or rejects it. Confirming a key that already has a confirmed fact supersedes that one.
 */

import { isAllowedFact, factKeyId, isFactKeyId } from "./fact-catalog.js";
import type { Fact, FactTerm, Plan } from "./plan-model.js";
import { checkPlan } from "./plan-check.js";
import { newProblems } from "./plan-actions.js";

export const FACT_ACTION_ERRORS = [
  "wrong_actor",
  "unknown_fact",
  "not_proposed",
  "invalid_fact",
  "unknown_step",
  "invalid_result",
] as const;
export type FactActionError = (typeof FACT_ACTION_ERRORS)[number];

export type FactActor = "user" | "ai" | "system";

export interface FactActionOptions {
  /** Injected clock: an ISO 8601 UTC instant */
  now: () => string;
  actor: FactActor;
}

export type FactResult = { ok: true; plan: Plan; fact: Fact } | { ok: false; code: FactActionError };
export type FactRefusal = { ok: false; code: FactActionError };

export interface ProposeInput {
  key: FactTerm;
  value: FactTerm;
  /** Required when the AI proposes: the AI step the fact comes from. Not allowed for the person. */
  stepId?: string;
  /** The version of that step's output the fact comes from, if any */
  version?: number;
  /** Required for an agent of the plan or a department level (actor "ai"), which has no step: the fact is about the whole level */
  agentLevel?: "plan" | "department";
}

const fail = (code: FactActionError): FactRefusal => ({ ok: false, code });

/** An id not used yet: the base, then base-2, base-3... Deterministic for the same plan. */
function freshId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Keeps the plan valid after a fact changes: no problem may appear that was not there before */
function validResult(before: Plan, after: Plan): boolean {
  return newProblems(checkPlan(before), checkPlan(after)).length === 0;
}

export function proposeFact(plan: Plan, input: ProposeInput, options: FactActionOptions): FactResult {
  if (options.actor !== "user" && options.actor !== "ai") return fail("wrong_actor");
  if (input.key.kind === "catalog" && !isFactKeyId(input.key.id)) return fail("invalid_fact");
  if (!isAllowedFact(input.key, input.value)) return fail("invalid_fact");

  let from: Fact["from"];
  if (options.actor === "ai" && input.agentLevel !== undefined) {
    // An agent's fact comes from its level, never from a step: the two origins do not mix
    if (input.stepId !== undefined || input.version !== undefined) return fail("invalid_fact");
    from = { kind: "agent", level: input.agentLevel };
  } else if (options.actor === "ai") {
    if (input.stepId === undefined) return fail("unknown_step");
    const step = plan.steps.find((candidate) => candidate.id === input.stepId);
    if (!step) return fail("unknown_step");
    if (step.executor !== "ai") return fail("wrong_actor");
    from = { kind: "step", stepId: step.id, ...(input.version !== undefined && { version: input.version }) };
  } else {
    if (input.agentLevel !== undefined) return fail("invalid_fact");
    if (input.stepId !== undefined || input.version !== undefined) return fail("invalid_fact");
    from = { kind: "user" };
  }

  const taken = new Set((plan.facts ?? []).map((fact) => fact.id));
  const slug = input.key.kind === "catalog" ? input.key.id : "other";
  const fact: Fact = {
    id: freshId(`fact-${slug}`, taken),
    key: input.key,
    value: input.value,
    status: "proposed",
    from,
    createdAt: options.now(),
  };
  const next: Plan = { ...plan, facts: [...(plan.facts ?? []), fact] };
  if (!validResult(plan, next)) return fail("invalid_result");
  return { ok: true, plan: next, fact };
}

export function confirmFact(plan: Plan, factId: string, options: FactActionOptions): FactResult {
  if (options.actor !== "user") return fail("wrong_actor");
  const facts = plan.facts ?? [];
  const target = facts.find((fact) => fact.id === factId);
  if (!target) return fail("unknown_fact");
  if (target.status !== "proposed") return fail("not_proposed");

  const at = options.now();
  const key = factKeyId(target.key);
  const confirmed: Fact = { ...target, status: "confirmed", confirmedAt: at };
  const next: Plan = {
    ...plan,
    facts: facts.map((fact) => {
      if (fact.id === factId) return confirmed;
      // The one confirmed fact of the same key is replaced by this one
      if (fact.status === "confirmed" && factKeyId(fact.key) === key) return { ...fact, status: "superseded", supersededBy: factId };
      return fact;
    }),
  };
  if (!validResult(plan, next)) return fail("invalid_result");
  return { ok: true, plan: next, fact: confirmed };
}

export function rejectFact(plan: Plan, factId: string, options: FactActionOptions): FactResult {
  if (options.actor !== "user") return fail("wrong_actor");
  const facts = plan.facts ?? [];
  const target = facts.find((fact) => fact.id === factId);
  if (!target) return fail("unknown_fact");
  if (target.status !== "proposed") return fail("not_proposed");

  const rejected: Fact = { ...target, status: "rejected" };
  const next: Plan = { ...plan, facts: facts.map((fact) => (fact.id === factId ? rejected : fact)) };
  if (!validResult(plan, next)) return fail("invalid_result");
  return { ok: true, plan: next, fact: rejected };
}

/**
 * The tasks and steps that were generated from a fact that is no longer confirmed. Read only: what to
 * do with them (retire or redo) is not decided here. A fact still confirmed, or unknown, has none.
 */
export function staleItems(plan: Plan, factId: string): { taskIds: string[]; stepIds: string[] } {
  const fact = (plan.facts ?? []).find((candidate) => candidate.id === factId);
  if (!fact || fact.status === "confirmed") return { taskIds: [], stepIds: [] };
  return {
    taskIds: plan.tasks.filter((task) => task.derivedFrom?.includes(factId)).map((task) => task.id),
    stepIds: plan.steps.filter((step) => step.derivedFrom?.includes(factId)).map((step) => step.id),
  };
}
