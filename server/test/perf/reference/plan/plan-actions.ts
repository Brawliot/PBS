/**
 * The only way to change a step inside a plan. It finds the step, takes its context from the
 * plan (readiness and whether others feed on it), applies the action with step-actions, and
 * returns a new plan with that step replaced. Nothing it receives is mutated. Before returning,
 * the new plan must not have any problem that checkPlan did not already find in the old one.
 */

import type { ActionContext, StepAction, StepActor } from "./step-actions.js";
import { STEP_ACTION_ERRORS, applyStepAction } from "./step-actions.js";
import type { Plan, StepEvent } from "./plan-model.js";
import { checkPlan, type PlanProblem } from "./plan-check.js";
import { feedsAnyStep, readiness } from "./step-graph.js";

export const PLAN_ACTION_ERRORS = [...STEP_ACTION_ERRORS, "unknown_step"] as const;
export type PlanActionError = (typeof PLAN_ACTION_ERRORS)[number];

export type PlanActionResult =
  | { ok: true; plan: Plan; event: StepEvent }
  | { ok: false; code: PlanActionError };

export interface PlanActionOptions {
  /** Injected clock: an ISO 8601 UTC instant */
  now: () => string;
  actor: StepActor;
  payload?: unknown;
}

/** The context an action needs, read from the whole plan: readiness counts every step, not only the task's */
export function stepActionContext(plan: Plan, stepId: string, options: PlanActionOptions): ActionContext | undefined {
  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) return undefined;
  return {
    now: options.now,
    actor: options.actor,
    payload: options.payload,
    readiness: readiness(step, plan.steps, plan.relations),
    feedsOthers: feedsAnyStep(step, plan.relations),
  };
}

const problemKey = (problem: PlanProblem) => JSON.stringify(problem);

/** Problems of `after` that `before` did not have, counting repeats */
export function newProblems(before: PlanProblem[], after: PlanProblem[]): PlanProblem[] {
  const remaining = new Map<string, number>();
  for (const problem of before) remaining.set(problemKey(problem), (remaining.get(problemKey(problem)) ?? 0) + 1);
  return after.filter((problem) => {
    const count = remaining.get(problemKey(problem)) ?? 0;
    if (count === 0) return true;
    remaining.set(problemKey(problem), count - 1);
    return false;
  });
}

export function applyPlanAction(plan: Plan, stepId: string, action: StepAction, options: PlanActionOptions): PlanActionResult {
  const context = stepActionContext(plan, stepId, options);
  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (!context || !step) return { ok: false, code: "unknown_step" };

  const result = applyStepAction(step, action, context);
  if (!result.ok) return { ok: false, code: result.code };

  const next: Plan = {
    ...plan,
    steps: plan.steps.map((candidate) => (candidate.id === stepId ? result.step : candidate)),
  };
  if (newProblems(checkPlan(plan), checkPlan(next)).length > 0) return { ok: false, code: "invalid_result" };
  return { ok: true, plan: next, event: result.event };
}
