/**
 * The steps of a planner run that the browser can show while it waits, in order. A closed list: nothing the model
 * wrote or any internal detail is ever sent as a stage. A leaf module, so the jobs and the planner can both read it.
 */

export const PLANNER_STAGES = ["reading", "costs", "explaining", "saving"] as const;
export type PlannerStage = (typeof PLANNER_STAGES)[number];

/** Position of a stage in the run, or -1 for anything that is not one */
export const stageRank = (stage: unknown): number => PLANNER_STAGES.indexOf(stage as PlannerStage);
