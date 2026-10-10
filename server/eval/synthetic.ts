/**
 * The fixed inputs of the levels that do not start from the output of another level (see levels.ts). Both are pure and
 * deterministic: the same skeleton gives the same tasks, so a recording of one run can be replayed on another.
 *
 * - The review gets the tasks of the first three departments of the plan, one each, and a duplicate on purpose: the
 *   second department proposes the same work as the first. A review that misses the duplicate is a finding of the level.
 * - The tasks level gets two AI tasks per department, with the department's prefix, cited on a confirmed fact, and no
 *   steps. The level then runs the steps of EVAL_TASKS of them, as the chain does.
 */

import type { ProposedTask } from "../plan/agents/plan-agent.js";
import { AGENT_TASK_CONFIDENCE } from "../plan/agents/department-agent.js";
import { parsePlan, type Plan, type Task } from "../plan/plan-model.js";

/** Departments whose tasks the review reads: the first ones of the plan, in its order */
export const REVIEW_DEPARTMENTS = 3;

/** The tasks the review reads: one per department, and a duplicate of the first one proposed by the second department */
export function syntheticReviewTasks(plan: Plan): ProposedTask[] {
  const departments = plan.departments.slice(0, REVIEW_DEPARTMENTS);
  const phaseId = plan.phases[0].id;
  const tasks: ProposedTask[] = departments.map((department) => ({
    id: `${department.id}-review-1`,
    title: `Revisar el trabajo de ${department.name}`,
    departmentId: department.id,
    phaseId,
  }));
  if (departments.length < 2) return tasks;
  return [...tasks, { id: `${departments[1].id}-review-copy`, title: tasks[0].title, departmentId: departments[1].id, phaseId }];
}

/**
 * The plan with two AI tasks per department and no steps, or undefined when the plan has no confirmed fact to cite (the
 * tasks must be derived from one, as every AI task is) or when the result would not be a valid plan.
 */
export function withSyntheticTasks(plan: Plan): Plan | undefined {
  const fact = (plan.facts ?? []).find((item) => item.status === "confirmed");
  if (fact === undefined) return undefined;
  const phaseId = plan.phases[0].id;
  const tasks: Task[] = plan.departments.flatMap((department) =>
    [1, 2].map((n) => ({
      id: `${department.id}-eval-${n}`,
      phaseId,
      primaryDepartmentId: department.id,
      title: `Preparar ${department.name} (${n})`,
      origin: { kind: "ai" as const },
      confidence: AGENT_TASK_CONFIDENCE,
      derivedFrom: [fact.id],
    })),
  );
  try {
    return parsePlan({ ...plan, tasks: [...plan.tasks, ...tasks] });
  } catch {
    return undefined;
  }
}
