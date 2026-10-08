/**
 * Lookups built once per plan, so the rules do not search the whole plan again for every task or step.
 * Each index holds the same answers as the search it replaces, in the same order: a rule that takes an
 * index gives the same result as one that takes none (the rules keep the search as their default).
 */

import type { Plan, Relation, Step } from "./plan-model.js";

type StepRelation = Extract<Relation, { level: "step" }>;

/** The steps of a plan by id, and what blocks and feeds each one */
export interface StepGraph {
  /** The step with each id (the last one, if an id is repeated: as the rules always took it) */
  byId: Map<string, Step>;
  /** For each step id, the ids of the steps that block it */
  blockers: Map<string, string[]>;
  /** For each step id, the ids of the steps that feed it */
  feeders: Map<string, string[]>;
}

export interface PlanIndex {
  /** Steps of the plan by id, and what blocks and feeds each one */
  graph: StepGraph;
  /** The steps of each task, in the order of plan.steps */
  stepsOfTask: Map<string, Step[]>;
  /** For each task, the step-level relations that join two of its steps, in the order of plan.relations */
  insideRelations: Map<string, Relation[]>;
  /** The ids of the steps whose result feeds another step */
  feeding: Set<string>;
}

/** The graph of the given steps and step-level relations */
export function stepGraph(steps: readonly Step[], relations: Plan["relations"]): StepGraph {
  const graph: StepGraph = { byId: new Map(steps.map((step) => [step.id, step])), blockers: new Map(), feeders: new Map() };
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const relation of relations) {
    if (relation.level !== "step") continue;
    if (relation.type === "blocks") add(graph.blockers, relation.to, relation.from);
    if (relation.type === "feeds") add(graph.feeders, relation.to, relation.from);
  }
  return graph;
}

export function buildPlanIndex(plan: Plan): PlanIndex {
  const stepsOfTask = new Map<string, Step[]>();
  // Every task that has a step with this id: an id repeated in two tasks joins both, as the search did
  const tasksOfStep = new Map<string, Set<string>>();
  for (const step of plan.steps) {
    const list = stepsOfTask.get(step.taskId);
    if (list) list.push(step);
    else stepsOfTask.set(step.taskId, [step]);
    const tasks = tasksOfStep.get(step.id);
    if (tasks) tasks.add(step.taskId);
    else tasksOfStep.set(step.id, new Set([step.taskId]));
  }

  const insideRelations = new Map<string, Relation[]>();
  const feeding = new Set<string>();
  for (const relation of plan.relations) {
    if (relation.level !== "step") continue;
    if (relation.type === "feeds") feeding.add(relation.from);
    const fromTasks = tasksOfStep.get(relation.from);
    const toTasks = tasksOfStep.get(relation.to);
    if (!fromTasks || !toTasks) continue;
    for (const task of fromTasks) {
      if (!toTasks.has(task)) continue;
      const list = insideRelations.get(task);
      if (list) list.push(relation);
      else insideRelations.set(task, [relation]);
    }
  }
  return { graph: stepGraph(plan.steps, plan.relations), stepsOfTask, insideRelations, feeding };
}

/** The step-level relations of one type, with the type narrowed */
export const stepRelationsOf = (relations: Plan["relations"], type: StepRelation["type"]) =>
  relations.filter((relation): relation is StepRelation => relation.level === "step" && relation.type === type);
