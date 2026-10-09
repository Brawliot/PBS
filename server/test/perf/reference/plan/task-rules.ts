/**
 * What a task is, computed from its steps. A task stores only its identity and its primary
 * department; status, mode, effort, elapsed time and secondary departments are always
 * derived here, so they cannot disagree with the steps. Pure functions over the steps of one
 * task and the step-level relations: a relation that does not join two steps of this task is
 * ignored (what a task needs from another one is a task-level matter).
 */

import type { Plan, Step, Task } from "./plan-model.js";
import { readiness, topologicalOrder } from "./step-graph.js";

type Relations = Plan["relations"];

/** Hours of work in a day. Unmeasured: it ignores the real capacity of the person, which comes later. */
export const WORKDAY_HOURS = 8;

export type TaskStatus = "not_started" | "in_progress" | "blocked" | "done";
export type TaskAutomation = "automatic" | "manual" | "hybrid";
export type ElapsedResult = { ok: true; days: number } | { ok: false; code: "cycle"; ids: string[] };

export interface TaskSummary {
  status: TaskStatus;
  automation: TaskAutomation | undefined;
  effortHours: number;
  elapsed: ElapsedResult;
  departments: { primary: string; secondary: string[] };
}

const ACTIVE = ["running", "waiting_user", "waiting_third_party"];

/** The step-level relations that join two steps of this task */
function insideRelations(steps: readonly Step[], relations: Relations): Relations {
  const ids = new Set(steps.map((step) => step.id));
  return relations.filter((relation) => relation.level === "step" && ids.has(relation.from) && ids.has(relation.to));
}

/**
 * In order: no steps is not started; all done is done; any active step, or a done step with
 * others unfinished, is in progress; with nothing active, blocked when no step that has not
 * started is ready (all blocked, or only rejected steps left); otherwise not started.
 * Assumption: "blocked" also covers a task that cannot start yet because it depends on something.
 */
export function taskStatus(steps: readonly Step[], relations: Relations, allSteps: readonly Step[] = steps): TaskStatus {
  if (steps.length === 0) return "not_started";
  if (steps.every((step) => step.status === "done")) return "done";
  if (steps.some((step) => ACTIVE.includes(step.status) || step.status === "done")) return "in_progress";
  const anyReady = steps.some((step) => step.status === "not_started" && readiness(step, allSteps, relations) === "ready");
  return anyReady ? "not_started" : "blocked";
}

/** AI steps only is automatic, none is manual (user and third party count as not AI), a mix is hybrid */
export function taskAutomation(steps: readonly Step[]): TaskAutomation | undefined {
  if (steps.length === 0) return undefined;
  if (steps.every((step) => step.executor === "ai")) return "automatic";
  return steps.some((step) => step.executor === "ai") ? "hybrid" : "manual";
}

export const taskEffortHours = (steps: readonly Step[]): number => steps.reduce((sum, step) => sum + step.effortHours, 0);

/**
 * The longest path through the steps of the task, in days. Only "blocks" and "feeds" add time
 * (assumption: "follows" sets an order but no wait); independent steps run side by side. Each
 * step weighs effortHours / WORKDAY_HOURS + waitDays. A cycle is an error result, not an exception.
 */
export function taskElapsedDays(steps: readonly Step[], relations: Relations): ElapsedResult {
  const inside = insideRelations(steps, relations);
  const sorted = topologicalOrder(steps, inside);
  if (!sorted.ok) return sorted;

  const before = new Map<string, string[]>();
  for (const relation of inside) {
    if (relation.level !== "step" || relation.type === "follows") continue;
    before.set(relation.to, [...(before.get(relation.to) ?? []), relation.from]);
  }
  const finish = new Map<string, number>();
  let longest = 0;
  for (const step of sorted.order) {
    const start = Math.max(0, ...(before.get(step.id) ?? []).map((id) => finish.get(id) ?? 0));
    const end = start + step.effortHours / WORKDAY_HOURS + step.waitDays;
    finish.set(step.id, end);
    longest = Math.max(longest, end);
  }
  return { ok: true, days: longest };
}

/** The primary department, and the other departments of its steps in order of first appearance */
export function taskDepartments(task: Pick<Task, "primaryDepartmentId">, steps: readonly Step[]): { primary: string; secondary: string[] } {
  const secondary = [...new Set(steps.map((step) => step.departmentId))].filter((id) => id !== task.primaryDepartmentId);
  return { primary: task.primaryDepartmentId, secondary };
}

export function summarizeTask(task: Task, steps: readonly Step[], relations: Relations, allSteps: readonly Step[] = steps): TaskSummary {
  return {
    status: taskStatus(steps, relations, allSteps),
    automation: taskAutomation(steps),
    effortHours: taskEffortHours(steps),
    elapsed: taskElapsedDays(steps, relations),
    departments: taskDepartments(task, steps),
  };
}
