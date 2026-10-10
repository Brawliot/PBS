/**
 * The fixed input of the tasks level (see levels.ts): two AI tasks per department, with the department's prefix, cited on a
 * confirmed fact, and no steps. Pure and deterministic: the same skeleton gives the same tasks, so a recording of one run
 * can be replayed on another. The level then runs the steps of EVAL_TASKS of them, as the chain does.
 *
 * The review does not use fixed tasks any more: it reads the tasks of the departments of the same run, or does not run.
 */

import { AGENT_TASK_CONFIDENCE } from "../plan/agents/department-agent.js";
import { parsePlan, type Plan, type Task } from "../plan/plan-model.js";

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
