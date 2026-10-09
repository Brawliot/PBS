/**
 * The values a client shows, computed by the server from a plan: readiness and available actions of
 * each step, the summary of each task, the status and progress of each phase, the progress of each
 * department, and the problems of the plan. Pure: everything comes from the plan it receives, and
 * nothing derived is ever stored.
 */

import { checkPlan, type PlanProblem } from "./plan-check.js";
import { factKeyId } from "./fact-catalog.js";
import { staleItems } from "./fact-actions.js";
import { expandable, isObsolete } from "./proposals.js";
import type { FactTerm, Plan } from "./plan-model.js";
import { departmentProgress, type DepartmentProgress } from "./department-rules.js";
import { phaseProgress, phaseStatus, type PhaseStatus } from "./phase-rules.js";
import { departmentNode } from "./plan-tree.js";
import { availableActions, type StepAction } from "./step-actions.js";
import { feedsAnyStep, readiness, type Readiness } from "./step-graph.js";
import { summarizeTask, type TaskSummary } from "./task-rules.js";

export interface StepDerived {
  readiness: Readiness;
  availableActions: StepAction[];
}

export interface PhaseDerived {
  status: PhaseStatus;
  progress: { total: number; done: number; percent: number };
}

export interface DerivedPlan {
  problems: PlanProblem[];
  steps: Record<string, StepDerived>;
  tasks: Record<string, TaskSummary>;
  phases: Record<string, PhaseDerived>;
  departments: Record<string, DepartmentProgress>;
  /** The gaps: what they wait for, and whether every key has a confirmed fact */
  placeholders: Record<string, { waitsFor: string[]; expandable: boolean }>;
  /** The confirmed fact of each key (factKeyId), with its value */
  confirmedFacts: Record<string, { factId: string; value: FactTerm }>;
  /** What was generated from a fact that is no longer confirmed (read only, see staleItems) */
  stale: { taskIds: string[]; stepIds: string[] };
  /**
   * The pending proposals: what each one would add, the titles of its tasks, and whether it is obsolete
   * (a fact it comes from is no longer confirmed, so accepting it is refused)
   */
  proposals: Record<string, { tasks: number; steps: number; relations: number; titles: string[]; obsolete: boolean }>;
}

export function derivePlan(plan: Plan): DerivedPlan {
  const steps: Record<string, StepDerived> = {};
  for (const step of plan.steps) {
    const stepReadiness = readiness(step, plan.steps, plan.relations);
    steps[step.id] = {
      readiness: stepReadiness,
      availableActions: availableActions(step, stepReadiness, feedsAnyStep(step, plan.relations)),
    };
  }

  const tasks: Record<string, TaskSummary> = {};
  for (const task of plan.tasks) {
    tasks[task.id] = summarizeTask(task, plan.steps.filter((step) => step.taskId === task.id), plan.relations, plan.steps);
  }

  const phases: Record<string, PhaseDerived> = {};
  for (const phase of plan.phases) {
    phases[phase.id] = { status: phaseStatus(plan, phase.id), progress: phaseProgress(plan, phase.id) };
  }

  const departments: Record<string, DepartmentProgress> = {};
  for (const department of plan.departments) {
    const node = departmentNode(plan, department.id);
    if (node) departments[department.id] = departmentProgress(node, plan.relations, plan.steps);
  }

  const placeholders: DerivedPlan["placeholders"] = {};
  for (const task of plan.tasks) {
    if (task.placeholder) {
      placeholders[task.id] = { waitsFor: [...task.placeholder.waitsFor], expandable: expandable(plan, task.id) };
    }
  }

  const proposals: DerivedPlan["proposals"] = {};
  for (const proposal of plan.proposals ?? []) {
    if (proposal.status !== "pending") continue;
    proposals[proposal.id] = {
      tasks: proposal.add.tasks.length,
      steps: proposal.add.steps.length,
      relations: proposal.add.relations.length,
      titles: proposal.add.tasks.map((task) => task.title),
      obsolete: isObsolete(plan, proposal),
    };
  }

  const confirmedFacts: DerivedPlan["confirmedFacts"] = {};
  const stale = { taskIds: new Set<string>(), stepIds: new Set<string>() };
  for (const fact of plan.facts ?? []) {
    if (fact.status === "confirmed") confirmedFacts[factKeyId(fact.key)] = { factId: fact.id, value: fact.value };
    const items = staleItems(plan, fact.id);
    items.taskIds.forEach((id) => stale.taskIds.add(id));
    items.stepIds.forEach((id) => stale.stepIds.add(id));
  }

  return {
    problems: checkPlan(plan),
    steps,
    tasks,
    phases,
    departments,
    placeholders,
    confirmedFacts,
    stale: { taskIds: [...stale.taskIds], stepIds: [...stale.stepIds] },
    proposals,
  };
}
