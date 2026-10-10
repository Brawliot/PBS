/**
 * Builds what one task call receives, from the plan as it is (pure: the plan, a task and the idea go in, the input
 * comes out). Only confirmed things reach the call: the facts the person confirmed, and the confirmed output of an AI
 * step of ANOTHER task that feeds a step of this one. The related tasks are read from the plan's accepted tasks and
 * their order relations: title and direction only, never a proposal, a draft or a rejected output.
 */

import { contextOf } from "./contract.js";
import { feedersOf } from "../step-graph.js";
import { readableOutput } from "../step-rules.js";
import type { Plan, Step } from "../plan-model.js";
import type { TaskInput } from "./task-agent.js";

/** Most related tasks a call receives: the order matters for the nearest ones, the rest are not needed to plan a task */
export const MAX_RELATED_TASKS = 50;

/** The task as the call receives it, with the context of the plan, or undefined when the plan has no task with this id */
export function buildTaskInput(plan: Plan, taskId: string, idea: string): TaskInput | undefined {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return undefined;

  // The AI steps of other tasks that feed a step of this one, each once, with a confirmed output only
  const feeders = new Map<string, Step>();
  for (const step of plan.steps.filter((candidate) => candidate.taskId === taskId)) {
    for (const feeder of feedersOf(step, plan.steps, plan.relations)) {
      if (feeder.taskId !== taskId && feeder.executor === "ai") feeders.set(feeder.id, feeder);
    }
  }
  const confirmedOutputs = [...feeders.values()].flatMap((feeder) => {
    const output = readableOutput(feeder);
    return output === undefined ? [] : [{ stepId: feeder.id, summary: output.summary }];
  });

  const related = plan.relations
    .filter((relation) => relation.level === "task" && (relation.from === taskId || relation.to === taskId))
    .flatMap((relation) => {
      const otherId = relation.from === taskId ? relation.to : relation.from;
      const other = plan.tasks.find((candidate) => candidate.id === otherId);
      if (!other) return [];
      // "blocks": from comes before to. "follows": to comes before from (the same reading as the department notes)
      const before = relation.type === "blocks" ? relation.to === taskId : relation.from === taskId;
      return [{ title: other.title, relation: before ? ("before" as const) : ("after" as const) }];
    });

  return {
    context: contextOf(idea, plan),
    task: { id: task.id, title: task.title, phaseId: task.phaseId, departmentId: task.primaryDepartmentId },
    confirmedOutputs,
    related: related.slice(0, MAX_RELATED_TASKS),
  };
}
