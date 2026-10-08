/**
 * Rules of the phase level, pure functions. A phase only groups tasks: its status and its
 * progress are computed from them, and nothing closes it by hand. Its place on the timeline is
 * optional; the relations between phases only order them, and never change a task or a step.
 */

import type { Plan, TimelineUnit } from "./plan-model.js";
import { cycleIn } from "./step-rules.js";
import { taskStatus, type TaskStatus } from "./task-rules.js";

type Relations = Plan["relations"];

export type PhaseStatus = "not_started" | "in_progress" | "blocked" | "done";

/**
 * The unit of the timeline for each answer of the planner's "timeline" question (planner-handler.ts).
 * Rule: a term of a year or more in months, about six months or less in weeks, shorter in days.
 * ASSUMPTION to review: this table is a proposal, not measured; "Normal (6-12m)" in weeks goes
 * against the rule's wording, and it was kept as proposed. A Map, so no answer can reach a prototype.
 */
const TIMELINE_UNIT_BY_CHOICE = new Map<string, TimelineUnit>([
  ["Ultra-fast (0-3m)", "day"],
  ["Fast (3-6m)", "week"],
  ["Normal (6-12m)", "week"],
  ["Long (12-18m)", "month"],
  ["Very long (18+m)", "month"],
  ["Not specified", "week"],
]);

/** The unit of the timeline for an answer; an answer not in the table is a week (never an error) */
export function timelineUnit(timelineChoice: string): TimelineUnit {
  return TIMELINE_UNIT_BY_CHOICE.get(timelineChoice) ?? "week";
}

/** The status of each task of the phase, computed from its steps and the relations between them */
export function phaseTaskStatuses(plan: Plan, phaseId: string): TaskStatus[] {
  return plan.tasks
    .filter((task) => task.phaseId === phaseId)
    .map((task) => taskStatus(plan.steps.filter((step) => step.taskId === task.id), plan.relations));
}

/**
 * Only from its tasks. No tasks is not started; all done is done; some task in progress, or some
 * done with the rest unfinished, is in progress; otherwise not started. A blocked task does not
 * start a phase by itself.
 */
export function intrinsicPhaseStatus(plan: Plan, phaseId: string): PhaseStatus {
  const statuses = phaseTaskStatuses(plan, phaseId);
  if (statuses.length === 0) return "not_started";
  if (statuses.every((status) => status === "done")) return "done";
  if (statuses.some((status) => status === "in_progress" || status === "done")) return "in_progress";
  return "not_started";
}

/**
 * The intrinsic status, except that a phase not started yet is blocked while a phase that blocks
 * it is not done. A phase already started or done is never blocked. An id that is not a phase
 * counts as not done, as an unknown source does for steps. "follows" never blocks.
 * Assumption: "blocked" only applies to phases that have not started yet.
 */
export function phaseStatus(plan: Plan, phaseId: string): PhaseStatus {
  const own = intrinsicPhaseStatus(plan, phaseId);
  if (own !== "not_started") return own;
  const blocked = plan.relations.some(
    (relation) =>
      relation.level === "phase" &&
      relation.type === "blocks" &&
      relation.to === phaseId &&
      intrinsicPhaseStatus(plan, relation.from) !== "done",
  );
  return blocked ? "blocked" : "not_started";
}

/** Progress by number of tasks (assumption: a task counts the same whatever its size) */
export function phaseProgress(plan: Plan, phaseId: string): { total: number; done: number; percent: number } {
  const statuses = phaseTaskStatuses(plan, phaseId);
  const total = statuses.length;
  const done = statuses.filter((status) => status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

export type PhaseRelationProblem =
  | { code: "unknown_phase_from" | "unknown_phase_to" | "duplicate_relation"; index: number }
  | { code: "cycle"; ids: string[] };

/**
 * Edges [before, after] of the phase relations, with the same convention as orderEdges for steps:
 * "A blocks B" puts A before B, "A follows B" puts B before A. Only between known phases.
 */
const phaseEdges = (relations: Relations, known: ReadonlySet<string>): [string, string][] =>
  relations.flatMap((relation): [string, string][] => {
    if (relation.level !== "phase" || !known.has(relation.from) || !known.has(relation.to)) return [];
    return relation.type === "follows" ? [[relation.to, relation.from]] : [[relation.from, relation.to]];
  });

/**
 * Problems of the phase-level relations, with the position each one has in `relations` (relations of
 * other levels are skipped but still counted). A duplicate is the same from, to and type; the second
 * one is reported. A cycle is reported once, with its ids. Crossed pairs are not a problem by themselves.
 */
export function phaseRelationProblems(relations: Relations, phases: readonly { id: string }[]): PhaseRelationProblem[] {
  const ids = new Set(phases.map((phase) => phase.id));
  const seen = new Set<string>();
  const problems: PhaseRelationProblem[] = [];
  relations.forEach((relation, index) => {
    if (relation.level !== "phase") return;
    if (!ids.has(relation.from)) problems.push({ code: "unknown_phase_from", index });
    if (!ids.has(relation.to)) problems.push({ code: "unknown_phase_to", index });
    const key = JSON.stringify([relation.from, relation.to, relation.type]);
    if (seen.has(key)) problems.push({ code: "duplicate_relation", index });
    seen.add(key);
  });
  const cycle = cycleIn(phaseEdges(relations, ids));
  if (cycle) problems.push({ code: "cycle", ids: cycle });
  return problems;
}

export type PhaseOrderProblem =
  | { code: "duplicate_order"; index: number }
  | { code: "order_contradicts_relation"; index: number };

/**
 * Problems of the order numbers. duplicate_order is reported at the position in plan.phases (the second
 * one); order_contradicts_relation at the position in plan.relations. Equal orders do not contradict
 * a relation: they are already a duplicate_order.
 */
export function phaseOrderProblems(plan: Plan): PhaseOrderProblem[] {
  const problems: PhaseOrderProblem[] = [];
  const seen = new Set<number>();
  plan.phases.forEach((phase, index) => {
    if (seen.has(phase.order)) problems.push({ code: "duplicate_order", index });
    seen.add(phase.order);
  });
  const order = new Map<string, number>(plan.phases.map((phase) => [phase.id, phase.order]));
  plan.relations.forEach((relation, index) => {
    if (relation.level !== "phase") return;
    const [before, after] = relation.type === "follows" ? [relation.to, relation.from] : [relation.from, relation.to];
    const first = order.get(before);
    const second = order.get(after);
    if (first !== undefined && second !== undefined && first > second) {
      problems.push({ code: "order_contradicts_relation", index });
    }
  });
  return problems;
}

export type PhaseSpanProblem =
  | { code: "blocked_phase_starts_too_early"; index: number }
  | { code: "follows_before_predecessor"; index: number };

/**
 * Problems of the place on the timeline, checked only between phases that have both a start and a length.
 * "A blocks B": B starts once A has ended (it may start later, never earlier). "A follows B": A starts
 * no earlier than B; they may overlap. Positions are indexes in plan.relations.
 */
export function phaseSpanProblems(plan: Plan): PhaseSpanProblem[] {
  const placed = new Map<string, { start: number; length: number }>();
  for (const phase of plan.phases) {
    if (phase.startUnit !== undefined && phase.lengthUnits !== undefined) {
      placed.set(phase.id, { start: phase.startUnit, length: phase.lengthUnits });
    }
  }
  const problems: PhaseSpanProblem[] = [];
  plan.relations.forEach((relation, index) => {
    if (relation.level !== "phase") return;
    const from = placed.get(relation.from);
    const to = placed.get(relation.to);
    if (!from || !to) return;
    if (relation.type === "blocks" && to.start < from.start + from.length) {
      problems.push({ code: "blocked_phase_starts_too_early", index });
    }
    if (relation.type === "follows" && from.start < to.start) {
      problems.push({ code: "follows_before_predecessor", index });
    }
  });
  return problems;
}
