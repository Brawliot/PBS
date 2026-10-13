/**
 * The summary of a plan on the project list: its title, the last change, and how far the steps have got.
 * It is computed here, from the plan, so the list and the plan page cannot disagree about progress.
 * A rejected step is not counted: it is not work to do.
 */

import type { ProjectRow } from "./plan-repository.js";

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

export function summarizeProject(row: ProjectRow): ProjectSummary {
  const steps = row.plan.steps.filter((step) => step.status !== "rejected");
  const done = steps.filter((step) => step.status === "done").length;
  const total = steps.length;
  const started = steps.some((step) => step.status !== "not_started");
  const status: ProjectStatus = total > 0 && done === total ? "done" : started ? "in_progress" : "not_started";
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
