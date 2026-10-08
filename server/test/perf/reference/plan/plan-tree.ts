/**
 * Reads the plan as a tree: a department or a phase has tasks, and a task has steps.
 * Pure lookups over a plan that already passed the coherence rules: an id that does not
 * exist gives undefined, and a task whose department is missing from the plan is left out.
 */

import type { Department, Phase, Plan, Step, Task } from "./plan-model.js";
import { taskDepartments } from "./task-rules.js";

export interface TaskNode {
  task: Task;
  steps: Step[];
}

export interface DepartmentNode {
  department: Department;
  /** Tasks where it is the primary department */
  responsible: TaskNode[];
  /** Tasks where it has a step but is not the primary department (computed from the steps) */
  participates: TaskNode[];
}

export interface PhaseNode {
  phase: Phase;
  /** Tasks grouped by their primary department, in the order of plan.departments */
  groups: { department: Department; tasks: TaskNode[] }[];
}

const node = (plan: Plan, task: Task): TaskNode => ({
  task,
  steps: plan.steps.filter((step) => step.taskId === task.id),
});

export function taskNode(plan: Plan, taskId: string): TaskNode | undefined {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  return task && node(plan, task);
}

export function departmentNode(plan: Plan, departmentId: string): DepartmentNode | undefined {
  const department = plan.departments.find((candidate) => candidate.id === departmentId);
  if (!department) return undefined;
  return {
    department,
    responsible: plan.tasks
      .filter((task) => task.primaryDepartmentId === departmentId)
      .map((task) => node(plan, task)),
    participates: plan.tasks
      .map((task) => node(plan, task))
      .filter(({ task, steps }) => taskDepartments(task, steps).secondary.includes(departmentId)),
  };
}

export function phaseNode(plan: Plan, phaseId: string): PhaseNode | undefined {
  const phase = plan.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) return undefined;
  const inPhase = plan.tasks.filter((task) => task.phaseId === phaseId);
  const groups = plan.departments
    .map((department) => ({
      department,
      tasks: inPhase
        .filter((task) => task.primaryDepartmentId === department.id)
        .map((task) => node(plan, task)),
    }))
    .filter((group) => group.tasks.length > 0);
  return { phase, groups };
}
