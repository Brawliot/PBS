/**
 * The values a client shows, computed by the server from a plan: readiness and available actions of
 * each step, the summary of each task, the status and progress of each phase, the progress of each
 * department, and the problems of the plan. Pure: everything comes from the plan it receives, and
 * nothing derived is ever stored.
 */

import { checkPlan, type PlanProblem } from "./plan-check.js";
import type { Plan } from "./plan-model.js";
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
    tasks[task.id] = summarizeTask(task, plan.steps.filter((step) => step.taskId === task.id), plan.relations);
  }

  const phases: Record<string, PhaseDerived> = {};
  for (const phase of plan.phases) {
    phases[phase.id] = { status: phaseStatus(plan, phase.id), progress: phaseProgress(plan, phase.id) };
  }

  const departments: Record<string, DepartmentProgress> = {};
  for (const department of plan.departments) {
    const node = departmentNode(plan, department.id);
    if (node) departments[department.id] = departmentProgress(node, plan.relations);
  }

  return { problems: checkPlan(plan), steps, tasks, phases, departments };
}
