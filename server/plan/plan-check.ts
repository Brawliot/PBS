/**
 * The gate of the whole plan: every problem that the four levels can have, in one list. Pure:
 * it only reads the plan it receives. The problems carry codes, levels, positions and ids,
 * never the text of the user. The rules of each level live in their own module; this file
 * checks the references between records and the coherence between levels, and calls the rest.
 *
 * plan-tree.ts assumes a plan that already passed this check. The only way to change a step
 * inside a plan is plan-actions.ts, which runs it before returning anything.
 */

import { departmentRelationProblems } from "./department-rules.js";
import type { Plan, Relation, Step } from "./plan-model.js";
import { phaseOrderProblems, phaseRelationProblems, phaseSpanProblems } from "./phase-rules.js";
import { growthProblems } from "./growth-rules.js";
import { cycleIn, feedsFromNonAi, findStepCycle, stepProblems, type StepProblem } from "./step-rules.js";
import { componentsOf } from "./graph.js";
import { orderOf } from "./order.js";

export const PLAN_LEVELS = ["department", "phase", "task", "step", "fact", "proposal"] as const;
export type PlanLevel = (typeof PLAN_LEVELS)[number];

/** Every code checkPlan can report. The level says which record kind it is about. */
export const PLAN_PROBLEM_CODES = [
  "unknown_phase",
  "unknown_department",
  "unknown_task",
  "unknown_relation_from",
  "unknown_relation_to",
  "step_invalid",
  "feeds_from_non_ai",
  "cycle",
  "duplicate_relation",
  "unknown_department_from",
  "unknown_department_to",
  "unknown_aspect",
  "unknown_phase_from",
  "unknown_phase_to",
  "duplicate_order",
  "order_contradicts_relation",
  "blocked_phase_starts_too_early",
  "follows_before_predecessor",
  "task_order_contradicts_steps",
  "task_order_contradicts_phase",
  "fact_unknown_key",
  "fact_value_not_allowed",
  "fact_unknown_step",
  "fact_superseded_by_broken",
  "fact_duplicate_confirmed",
  "derived_from_unknown_fact",
  "placeholder_has_steps",
  "placeholder_unknown_key",
  "proposal_reason_unknown",
  "proposal_resolves_unknown_task",
  "proposal_pending_has_time",
  "proposal_pending_ids_exist",
  "proposal_decided_without_time",
] as const;
export type PlanProblemCode = (typeof PLAN_PROBLEM_CODES)[number];

export interface PlanProblem {
  code: PlanProblemCode;
  level: PlanLevel;
  /** Position in the list of its record kind (plan.tasks, plan.steps, plan.relations...) */
  index?: number;
  /** Ids involved, in order (a cycle lists its loop; a reference lists the record and the missing id) */
  ids?: string[];
  /** For step_invalid: the broken invariant of the step */
  detail?: StepProblem;
}

/** Edges [before, after] between tasks, with the same convention as orderEdges for steps */
const taskEdges = (relations: readonly Relation[], known: ReadonlySet<string>): [string, string][] =>
  relations.flatMap((relation): [string, string][] => {
    if (relation.level !== "task" || !known.has(relation.from) || !known.has(relation.to)) return [];
    return [orderOf(relation)];
  });


/** The task order that steps imply: "blocks" and "feeds" between steps of different tasks, never "follows" */
function impliedTaskOrder(plan: Plan): { before: string; after: string; index: number }[] {
  const task = new Map(plan.steps.map((step) => [step.id, step.taskId]));
  const known = new Set(plan.tasks.map((item) => item.id));
  return plan.relations.flatMap((relation, index) => {
    if (relation.level !== "step" || relation.type === "follows") return [];
    const before = task.get(relation.from);
    const after = task.get(relation.to);
    if (before === undefined || after === undefined || before === after) return [];
    if (!known.has(before) || !known.has(after)) return [];
    return [{ before, after, index }];
  });
}

/**
 * Coherence between levels. (a) A task order implied by steps must not close a loop with the
 * stored task relations or with the other implied orders: reported at the step relation that
 * implies it. (b) Every task order, stored or implied, must not go from a later phase to an earlier one.
 */
function crossLevelProblems(plan: Plan): PlanProblem[] {
  const implied = impliedTaskOrder(plan);
  const known = new Set(plan.tasks.map((item) => item.id));
  const stored = taskEdges(plan.relations, known);
  const edges = [...stored, ...implied.map(({ before, after }) => [before, after] as [string, string])];

  // The edge before -> after closes a loop exactly when both ends are in one strongly connected component
  const component = componentsOf([...known], edges);
  const problems: PlanProblem[] = [];
  for (const { before, after, index } of implied) {
    if (component.get(before) === component.get(after)) {
      problems.push({ code: "task_order_contradicts_steps", level: "step", index, ids: [before, after] });
    }
  }

  const phaseOrder = new Map(plan.phases.map((phase) => [phase.id, phase.order]));
  const phaseOf = new Map(plan.tasks.map((item) => [item.id, item.phaseId]));
  const later = (before: string, after: string) => {
    const first = phaseOrder.get(phaseOf.get(before) ?? "");
    const second = phaseOrder.get(phaseOf.get(after) ?? "");
    return first !== undefined && second !== undefined && first > second;
  };
  plan.relations.forEach((relation, index) => {
    if (relation.level !== "task") return;
    const [before, after] = orderOf(relation);
    if (known.has(before) && known.has(after) && later(before, after)) {
      problems.push({ code: "task_order_contradicts_phase", level: "task", index, ids: [before, after] });
    }
  });
  for (const { before, after, index } of implied) {
    if (later(before, after)) problems.push({ code: "task_order_contradicts_phase", level: "step", index, ids: [before, after] });
  }
  return problems;
}

/**
 * Every problem of the plan, in a fixed order: references, steps, tasks, departments, phases,
 * then the coherence between levels. An empty list is a plan that can be used.
 */
export function checkPlan(plan: Plan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const phaseIds = new Set(plan.phases.map((phase) => phase.id));
  const departmentIds = new Set(plan.departments.map((department) => department.id));

  // References that exist
  plan.tasks.forEach((task, index) => {
    if (!phaseIds.has(task.phaseId)) problems.push({ code: "unknown_phase", level: "task", index, ids: [task.id, task.phaseId] });
    if (!departmentIds.has(task.primaryDepartmentId)) {
      problems.push({ code: "unknown_department", level: "task", index, ids: [task.id, task.primaryDepartmentId] });
    }
  });
  plan.steps.forEach((step, index) => {
    if (!taskIds.has(step.taskId)) problems.push({ code: "unknown_task", level: "step", index, ids: [step.id, step.taskId] });
    if (!departmentIds.has(step.departmentId)) {
      problems.push({ code: "unknown_department", level: "step", index, ids: [step.id, step.departmentId] });
    }
  });
  const ends: Record<"step" | "task", Set<string>> = {
    step: new Set(plan.steps.map((step) => step.id)),
    task: taskIds,
  };
  plan.relations.forEach((relation, index) => {
    if (relation.level !== "step" && relation.level !== "task") return;
    if (!ends[relation.level].has(relation.from)) problems.push({ code: "unknown_relation_from", level: relation.level, index, ids: [relation.from] });
    if (!ends[relation.level].has(relation.to)) problems.push({ code: "unknown_relation_to", level: relation.level, index, ids: [relation.to] });
  });

  // Steps
  plan.steps.forEach((step, index) => {
    for (const detail of stepProblems(step)) problems.push({ code: "step_invalid", level: "step", index, ids: [step.id], detail });
  });
  const stepCycle = findStepCycle(plan.relations);
  if (stepCycle) problems.push({ code: "cycle", level: "step", ids: stepCycle });
  for (const index of feedsFromNonAi(plan)) problems.push({ code: "feeds_from_non_ai", level: "step", index });
  // The same from, to and type twice: the second one is reported
  const seenStep = new Set<string>();
  plan.relations.forEach((relation, index) => {
    if (relation.level !== "step") return;
    const key = JSON.stringify([relation.from, relation.to, relation.type]);
    if (seenStep.has(key)) problems.push({ code: "duplicate_relation", level: "step", index });
    seenStep.add(key);
  });

  // Tasks: the same relation twice, and loops among the stored ones
  const seen = new Set<string>();
  plan.relations.forEach((relation, index) => {
    if (relation.level !== "task") return;
    const key = JSON.stringify([relation.from, relation.to, relation.type]);
    if (seen.has(key)) problems.push({ code: "duplicate_relation", level: "task", index });
    seen.add(key);
  });
  const taskCycle = cycleIn(taskEdges(plan.relations, taskIds));
  if (taskCycle) problems.push({ code: "cycle", level: "task", ids: taskCycle });

  // Departments, phases: their own rules, with their own positions
  for (const problem of departmentRelationProblems(plan.relations, plan.departments)) problems.push({ level: "department", ...problem });
  for (const problem of phaseRelationProblems(plan.relations, plan.phases)) problems.push({ level: "phase", ...problem });
  for (const problem of phaseOrderProblems(plan)) problems.push({ level: "phase", ...problem });
  for (const problem of phaseSpanProblems(plan)) problems.push({ level: "phase", ...problem });

  // Between levels
  problems.push(...crossLevelProblems(plan));

  // What the plan grows with: facts, their references, the gaps and the proposals
  problems.push(...growthProblems(plan));
  return problems;
}
