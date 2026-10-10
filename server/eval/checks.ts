/**
 * What the report reads from a plan, besides the numbers: the heuristic expectations, the order between departments
 * and tasks in plain words, and the first titles of each department. Only titles and names: never a prompt, an answer
 * or a note the model wrote.
 */

import type { Plan, Relation } from "../plan/plan-model.js";
import type { Expectation } from "./cases.js";

export interface ExpectationResult {
  id: string;
  description: string;
  passed: boolean;
}

/** Whether an AI task of the plan meets each expectation. Skeleton tasks (rules, not agents) never count. */
export function evaluateExpectations(expectations: Expectation[], plan: Plan): ExpectationResult[] {
  const proposed = plan.tasks.filter((task) => task.origin.kind === "ai");
  return expectations.map((expectation) => ({
    id: expectation.id,
    description: expectation.description,
    passed: proposed.some(
      (task) => (expectation.departments === null || expectation.departments.includes(task.primaryDepartmentId)) && expectation.pattern.test(task.title),
    ),
  }));
}

/**
 * "blocks": from is ready before to. "follows": to is ready before from (the same reading the agents use, see
 * department-suggestion.ts). The sentence is only for a person to read the direction; it is never checked automatically.
 */
function sentence(type: Relation["type"], from: string, to: string): string {
  const [before, after] = type === "blocks" ? [from, to] : [to, from];
  return `«${before}» debe estar lista antes que «${after}»`;
}

/** The relations as sentences: between departments (names), and between the AI tasks (titles) */
export function describeRelations(plan: Plan): { departments: string[]; tasks: string[] } {
  const nameOf = (id: string) => plan.departments.find((department) => department.id === id)?.name ?? id;
  const titleOf = (id: string) => plan.tasks.find((task) => task.id === id)?.title ?? id;
  const aiTask = (id: string) => plan.tasks.some((task) => task.id === id && task.origin.kind === "ai");
  return {
    departments: plan.relations
      .filter((relation) => relation.level === "department")
      .map((relation) => sentence(relation.type, nameOf(relation.from), nameOf(relation.to))),
    tasks: plan.relations
      .filter((relation) => relation.level === "task" && (aiTask(relation.from) || aiTask(relation.to)))
      .map((relation) => sentence(relation.type, titleOf(relation.from), titleOf(relation.to))),
  };
}

/** The first three AI task titles of each department that has any */
export function tasksByDepartment(plan: Plan): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const department of plan.departments) {
    const titles = plan.tasks
      .filter((task) => task.origin.kind === "ai" && task.primaryDepartmentId === department.id)
      .map((task) => task.title);
    if (titles.length > 0) result[department.name] = titles.slice(0, 3);
  }
  return result;
}
