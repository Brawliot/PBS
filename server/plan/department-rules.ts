/**
 * Rules of the department level, pure functions. Relations between departments only inform:
 * they never change the state of a task or a step.
 */

import { isCatalogAspect } from "./department-catalog.js";
import type { Plan } from "./plan-model.js";
import type { DepartmentNode } from "./plan-tree.js";
import { taskStatus } from "./task-rules.js";

type Relations = Plan["relations"];
type DepartmentRelation = Extract<Relations[number], { level: "department" }>;

export type DepartmentRelationProblem = {
  code: "unknown_aspect" | "unknown_department_from" | "unknown_department_to" | "duplicate_relation";
  /** Position of the relation in the list that was given (all levels), never its content */
  index: number;
};

const aspectKey = (aspect: DepartmentRelation["aspect"]) =>
  aspect.kind === "catalog" ? `catalog:${aspect.id}` : `other:${aspect.note}`;

/**
 * Problems of the department-level relations, with the position each one has in `relations`
 * (relations of other levels are skipped but still counted). Cycles and crossed pairs with different aspects
 * are valid; only an identical relation (same from, to, type and aspect) is a duplicate.
 */
export function departmentRelationProblems(
  relations: Relations,
  departments: readonly { id: string }[],
): DepartmentRelationProblem[] {
  const ids = new Set(departments.map((department) => department.id));
  const seen = new Set<string>();
  const problems: DepartmentRelationProblem[] = [];
  relations.forEach((relation, index) => {
    if (relation.level !== "department") return;
    if (relation.aspect.kind === "catalog" && !isCatalogAspect(relation.aspect.id)) problems.push({ code: "unknown_aspect", index });
    if (!ids.has(relation.from)) problems.push({ code: "unknown_department_from", index });
    if (!ids.has(relation.to)) problems.push({ code: "unknown_department_to", index });
    const key = JSON.stringify([relation.from, relation.to, relation.type, aspectKey(relation.aspect)]);
    if (seen.has(key)) problems.push({ code: "duplicate_relation", index });
    seen.add(key);
  });
  return problems;
}

export interface DepartmentProgress {
  total: number;
  notStarted: number;
  inProgress: number;
  blocked: number;
  done: number;
}

/** Tasks the department is responsible for, by status. Tasks where it only participates do not count (optional assumption). */
export function departmentProgress(node: DepartmentNode, relations: Relations): DepartmentProgress {
  const progress: DepartmentProgress = { total: 0, notStarted: 0, inProgress: 0, blocked: 0, done: 0 };
  for (const { steps } of node.responsible) {
    progress.total++;
    const status = taskStatus(steps, relations);
    if (status === "not_started") progress.notStarted++;
    else if (status === "in_progress") progress.inProgress++;
    else if (status === "blocked") progress.blocked++;
    else progress.done++;
  }
  return progress;
}
