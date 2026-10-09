/**
 * The values a client shows, computed by the server from a plan: readiness and available actions of
 * each step, the summary of each task, the status and progress of each phase, the progress of each
 * department, and the problems of the plan. Pure: everything comes from the plan it receives, and
 * nothing derived is ever stored.
 */

import { checkPlan, type PlanProblem } from "./plan-check.js";
import { buildPlanIndex } from "./plan-index.js";
import { factKeyId } from "./fact-catalog.js";
import { staleItems } from "./fact-actions.js";
import { expandable, isObsolete } from "./proposals.js";
import type { FactTerm, Plan, Structure } from "./plan-model.js";
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

/** A structure waiting for a decision, in words the screen can show: names instead of ids, the tiers from and to */
export interface StructureSummary {
  phases: string[];
  tiers: { department: string; from: string; to: string }[];
  relations: { from: string; to: string; type: string; aspect: string }[];
  requests: string[];
  questions: string[];
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
   * (a fact it comes from is no longer confirmed, so accepting it is refused). A structure proposal has its
   * StructureSummary; no other proposal does.
   */
  proposals: Record<string, { tasks: number; steps: number; relations: number; titles: string[]; obsolete: boolean; structure?: StructureSummary }>;
}

/** The structure as names and words: the departments by name, relations and aspects as text */
function summarizeStructure(plan: Plan, structure: Structure): StructureSummary {
  const department = (id: string) => plan.departments.find((candidate) => candidate.id === id);
  const name = (id: string) => department(id)?.name ?? id;
  return {
    phases: structure.phases.map((phase) => phase.name),
    tiers: structure.tiers.flatMap((item) => {
      const current = department(item.departmentId);
      return current ? [{ department: current.name, from: current.tier, to: item.tier }] : [];
    }),
    relations: structure.relations.map((relation) => ({
      from: name(relation.from),
      to: name(relation.to),
      type: relation.type,
      aspect: relation.aspect.kind === "catalog" ? [relation.aspect.id, relation.aspect.note].filter(Boolean).join(": ") : relation.aspect.note,
    })),
    requests: structure.requests,
    questions: structure.questions,
  };
}

export function derivePlan(plan: Plan): DerivedPlan {
  // Built once: each rule below reads the steps of a task or the relations of a step from here
  const index = buildPlanIndex(plan);

  const steps: Record<string, StepDerived> = {};
  for (const step of plan.steps) {
    const stepReadiness = readiness(step, plan.steps, plan.relations, index.graph);
    steps[step.id] = {
      readiness: stepReadiness,
      availableActions: availableActions(step, stepReadiness, feedsAnyStep(step, plan.relations, index.feeding)),
    };
  }

  const tasks: Record<string, TaskSummary> = {};
  for (const task of plan.tasks) {
    tasks[task.id] = summarizeTask(task, index.stepsOfTask.get(task.id) ?? [], index.insideRelations.get(task.id) ?? [], index.graph);
  }

  const phases: Record<string, PhaseDerived> = {};
  for (const phase of plan.phases) {
    phases[phase.id] = { status: phaseStatus(plan, phase.id, index), progress: phaseProgress(plan, phase.id, index) };
  }

  const departments: Record<string, DepartmentProgress> = {};
  for (const department of plan.departments) {
    const node = departmentNode(plan, department.id, index);
    if (node) departments[department.id] = departmentProgress(node, plan.relations, index.graph);
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
      ...(proposal.structure && { structure: summarizeStructure(plan, proposal.structure) }),
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
