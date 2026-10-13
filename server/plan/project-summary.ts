/**
 * The summary of a plan on the project list: its title, the last change, and how far the steps have got.
 * It is computed here, from the plan, so the list and the plan page cannot disagree about progress.
 * A rejected step is not counted: it is not work to do.
 */

import type { Plan } from "./plan-model.js";
import type { ProjectRow, StepCounts } from "./plan-repository.js";

export type ProjectStatus = "not_started" | "in_progress" | "done";

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  status: ProjectStatus;
  done: number;
  total: number;
  percent: number;
}

/** The counts the summary needs, made from a whole plan. The database makes the same counts in SQL (see pg-plan-repository.ts). */
export function countSteps(plan: Plan): StepCounts {
  const steps = plan.steps.filter((step) => step.status !== "rejected");
  return {
    total: steps.length,
    done: steps.filter((step) => step.status === "done").length,
    started: steps.filter((step) => step.status !== "not_started").length,
  };
}

export function summarizeProject(row: ProjectRow): ProjectSummary {
  const { total, done, started } = row.counts;
  const status: ProjectStatus = total > 0 && done === total ? "done" : started > 0 ? "in_progress" : "not_started";
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    status,
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
