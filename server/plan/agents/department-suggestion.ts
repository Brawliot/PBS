/**
 * The task suggestion of the whole plan: one call per department (in parallel, see runDepartments), then ONE review
 * of the plan level over all the tasks proposed. The result is only proposals and proposed facts: plan-routes.ts
 * saves them in one write, or nothing at all. Pure apart from the model and the judge it is given.
 */

import { type AgentDeps, type AgentResult, type FactProposal, clip, fail } from "./contract.js";
import { type DepartmentAnswer, type DepartmentInput, runDepartments } from "./department-agent.js";
import { buildDepartmentInput } from "./department-input.js";
import { type PlanReviewOutput, type ProposedTask, runPlanReview } from "./plan-agent.js";
import { PROPOSAL_NOTE_LIMITS, type Plan, type Proposal } from "../plan-model.js";

/** The longest a suggestion may take: under Node's 300 s request timeout, so the answer is always ours to send */
export const DEPARTMENTS_DEADLINE_MS = 240_000;

/**
 * The departments that already have a pending task proposal of the assistant: they are skipped, so a second press
 * never proposes the same tasks twice and costs nothing for them.
 */
export function departmentsWithPendingTasks(plan: Plan): Set<string> {
  return new Set(
    (plan.proposals ?? [])
      .filter((item) => item.status === "pending" && item.structure === undefined)
      .flatMap((item) => item.add.tasks.filter((task) => task.origin.kind === "ai").map((task) => task.primaryDepartmentId)),
  );
}

export interface DepartmentSuggestion {
  /** One proposal per department that proposed tasks, with its notes. Empty when no department had a task to add. */
  proposals: Proposal[];
  /** The facts the departments proposed, as they came (the caller drops the ones the plan already has) */
  facts: FactProposal[];
}

/** Runs the departments that have no pending proposal, then the review. Any failure makes the whole call fail. */
export async function suggestDepartmentTasks(deps: AgentDeps, plan: Plan, idea: string, options: { now: () => string }): Promise<AgentResult<DepartmentSuggestion>> {
  const pending = departmentsWithPendingTasks(plan);
  const inputs = plan.departments
    .filter((department) => !pending.has(department.id))
    .map((department) => buildDepartmentInput(plan, department.id, idea))
    .filter((input): input is DepartmentInput => input !== undefined);

  const departments = await runDepartments(deps, inputs, plan, options);
  if (!departments.ok) return departments;
  const { proposals: created, answers } = departments.value;
  const facts = answers.flatMap((answer) => answer.output.facts);
  if (created.length === 0) return { ok: true, value: { proposals: [], facts } };

  const proposed: ProposedTask[] = created.flatMap((proposal) =>
    proposal.add.tasks.map((task) => ({ id: task.id, title: task.title, departmentId: task.primaryDepartmentId, phaseId: task.phaseId })),
  );
  const review = await runPlanReview(deps, { idea: clip(idea), proposed }, plan);
  if (!review.ok) return fail(review.code);

  return { ok: true, value: { proposals: withNotes(plan, created, answers, review.value.output, proposed), facts } };
}

/**
 * The read-only notes of each proposal: the requests and questions of its department, the review findings and the
 * suggested orders that name one of its tasks. A finding or order that names no proposed task goes to the first
 * proposal. A department with no task has no proposal, so its requests and questions are not kept (a known limit).
 */
function withNotes(plan: Plan, created: Proposal[], answers: DepartmentAnswer[], review: PlanReviewOutput, proposed: ProposedTask[]): Proposal[] {
  const nameOf = (id: string) => plan.departments.find((department) => department.id === id)?.name ?? id;
  const titleOf = (id: string) => proposed.find((task) => task.id === id)?.title ?? plan.tasks.find((task) => task.id === id)?.title ?? id;
  const taskIdsOf = (proposal: Proposal) => new Set(proposal.add.tasks.map((task) => task.id));
  const byDepartment = new Map(created.map((proposal) => [proposal.add.tasks[0].primaryDepartmentId, proposal]));
  const notes = new Map<string, string[]>(created.map((proposal) => [proposal.id, []]));
  const add = (proposal: Proposal, text: string) => notes.get(proposal.id)?.push(text);
  const targets = (taskIds: string[]) => {
    const named = created.filter((proposal) => taskIds.some((id) => taskIdsOf(proposal).has(id)));
    return named.length > 0 ? named : created.slice(0, 1);
  };

  for (const answer of answers) {
    const proposal = byDepartment.get(answer.departmentId);
    if (!proposal) continue;
    for (const request of answer.output.requests) {
      add(proposal, `Request to ${request.to === "plan" ? "Plan" : nameOf(request.to)}: ${request.text}`);
    }
    for (const question of answer.output.questions) add(proposal, `Question: ${question}`);
  }
  for (const finding of review.findings) {
    for (const proposal of targets(finding.taskIds)) add(proposal, `${finding.kind}: ${finding.text}`);
  }
  for (const item of review.adjustments) {
    // "blocks": from is done before to. "follows": to is done before from (B follows A: B comes after A)
    const [before, after] = item.type === "blocks" ? [item.from, item.to] : [item.to, item.from];
    for (const proposal of targets([item.from, item.to])) add(proposal, `Suggested order: ${titleOf(before)} before ${titleOf(after)}`);
  }

  return created.map((proposal) => {
    const list = (notes.get(proposal.id) ?? []).slice(0, PROPOSAL_NOTE_LIMITS.notes).map((text) => text.slice(0, PROPOSAL_NOTE_LIMITS.text));
    return list.length > 0 ? { ...proposal, notes: list } : proposal;
  });
}

/**
 * Waits for `work` for at most `ms`. Undefined when the time is up: the work keeps running, but its result is never
 * used, so nothing is saved from it. Rejections of the work are handled by the race.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
