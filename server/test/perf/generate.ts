/**
 * Synthetic plans for the benchmark and the equivalence tests. A plan made here passes checkPlan: tasks
 * are spread over three phases in order, each task is a chain of steps, and the k-th step of a task blocks the
 * k-th step of the next one (consecutive tasks, so the implied task order agrees with the phases).
 */

import type { Plan, Step, Task } from "../../plan/plan-model.js";
import { parsePlan } from "../../plan/plan-model.js";

const origin = { kind: "rule" } as const;
const DEPARTMENTS = ["legal", "finance", "product"] as const;

export interface SyntheticSize {
  tasks: number;
  steps: number;
}

export function syntheticPlan({ tasks: taskCount, steps: stepCount }: SyntheticSize): Plan {
  const phases = [
    { id: "p0", name: "Prepare", order: 0, startUnit: 0, lengthUnits: 10 },
    { id: "p1", name: "Set up", order: 1, startUnit: 10, lengthUnits: 10 },
    { id: "p2", name: "Launch", order: 2, startUnit: 20, lengthUnits: 10 },
  ];
  const tasks: Task[] = [];
  const steps: Step[] = [];
  const relations: Plan["relations"] = [];
  let previousStepIds: string[] = [];
  for (let t = 0; t < taskCount; t++) {
    const taskId = `t${t}`;
    const phase = phases[Math.floor((t * 3) / taskCount)].id;
    tasks.push({ id: taskId, phaseId: phase, primaryDepartmentId: DEPARTMENTS[t % 3], title: `Task ${t}`, origin, confidence: 100 });
    // Steps spread evenly over the tasks; each task has at least one
    const count = Math.max(1, Math.floor(((t + 1) * stepCount) / taskCount) - Math.floor((t * stepCount) / taskCount));
    const previousCount = previousStepIds.length;
    const stepIds: string[] = [];
    let previous: string | undefined;
    for (let k = 0; k < count; k++) {
      const id = `${taskId}-s${k}`;
      steps.push({
        id,
        taskId,
        departmentId: DEPARTMENTS[(t + k) % 3],
        text: `Step ${id}`,
        executor: "user",
        mode: "online",
        evidence: { kind: "none" },
        effortHours: 2,
        waitDays: 0,
        status: "not_started",
        events: [],
        origin,
        confidence: 100,
      } as Step);
      stepIds.push(id);
      if (previous) relations.push({ level: "step", from: previous, to: id, type: "blocks" });
      previous = id;
      // The k-th step of the previous task blocks the k-th step of this one (consecutive tasks only)
      if (k < previousCount) relations.push({ level: "step", from: previousStepIds[k], to: id, type: "blocks" });
    }
    previousStepIds = stepIds;
  }
  return parsePlan({
    timeline: { unit: "week" },
    departments: DEPARTMENTS.map((id) => ({ id, name: id, tier: "core" })),
    phases,
    tasks,
    steps,
    relations,
  });
}

/** The sizes of the benchmark: small, medium, large and the largest plan that LIMITS allows */
export const BENCH_SIZES: Record<string, SyntheticSize> = {
  small: { tasks: 10, steps: 40 },
  medium: { tasks: 100, steps: 500 },
  large: { tasks: 500, steps: 2500 },
  maximum: { tasks: 500, steps: 5000 },
};
