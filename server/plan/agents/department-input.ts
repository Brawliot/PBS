/**
 * Builds what one department call receives, from the plan as it is (pure: the plan and the idea go in, the input
 * comes out). Only confirmed things reach a call: the facts the person confirmed, the outputs confirmed by AI
 * steps of OTHER departments that feed this department's steps, and the order relations that touch it. Its own
 * tasks are read from the plan. Nothing proposed is read here, so a department never sees another's proposal.
 */

import { contextOf } from "./contract.js";
import { MAX_DEPARTMENT_OUTPUTS, MAX_DEPARTMENT_RELATIONS, type DepartmentInput } from "./department-agent.js";
import { feedersOf } from "../step-graph.js";
import type { Plan, Step } from "../plan-model.js";

/** The aspect as text: the catalogue entry, with its note when there is one, or the free text */
function aspectText(aspect: { kind: "catalog"; id: string; note?: string } | { kind: "other"; note: string }): string {
  if (aspect.kind === "other") return aspect.note;
  return aspect.note === undefined ? aspect.id : `${aspect.id}: ${aspect.note}`;
}

/** The summary of the last confirmed output of an AI step (a draft or a rejected output is never sent) */
function confirmedSummary(step: Step): string | undefined {
  const outputs = step.outputs ?? [];
  return [...outputs].reverse().find((output) => output.state === "confirmed")?.summary;
}

/** The input of one department, or undefined when the plan has no department with this id */
export function buildDepartmentInput(plan: Plan, departmentId: string, idea: string): DepartmentInput | undefined {
  const department = plan.departments.find((candidate) => candidate.id === departmentId);
  if (!department) return undefined;

  // The AI steps of other departments that feed a step of this one, each once, with a confirmed output only
  const feeders = new Map<string, Step>();
  for (const step of plan.steps.filter((candidate) => candidate.departmentId === departmentId)) {
    for (const feeder of feedersOf(step, plan.steps, plan.relations)) {
      if (feeder.departmentId !== departmentId && feeder.executor === "ai") feeders.set(feeder.id, feeder);
    }
  }
  const confirmedOutputs = [...feeders.values()].flatMap((feeder) => {
    const summary = confirmedSummary(feeder);
    return summary === undefined ? [] : [{ stepId: feeder.id, departmentId: feeder.departmentId, summary }];
  });

  const aspects = plan.relations
    .filter((relation) => relation.level === "department" && (relation.from === departmentId || relation.to === departmentId))
    .slice(0, MAX_DEPARTMENT_RELATIONS)
    .map((relation) => ({
      from: relation.from,
      to: relation.to,
      type: relation.type,
      aspect: relation.level === "department" ? aspectText(relation.aspect) : "",
    }));

  return {
    context: contextOf(idea, plan),
    department: { id: department.id, name: department.name, tier: department.tier },
    phases: plan.phases.map((phase) => ({ id: phase.id, name: phase.name })),
    ownTasks: plan.tasks.filter((task) => task.primaryDepartmentId === departmentId).map((task) => ({ id: task.id, title: task.title, phaseId: task.phaseId })),
    confirmedOutputs: confirmedOutputs.slice(0, MAX_DEPARTMENT_OUTPUTS),
    aspects,
  };
}
