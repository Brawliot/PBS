/**
 * The fixed departments and groups of every plan, with stable ids, and the closed list of
 * aspects a department can depend on another for. The names match GROUPS in the validation
 * handler; the ids are what the plan and the URLs use, so they never change.
 */

import type { Department } from "./plan-model.js";
import type { Validation } from "../planner/planner-validation-handler.js";

/** Department name (as in GROUPS) to its stable id, in the order of GROUPS */
export const DEPARTMENT_IDS = {
  "Legal & Compliance": "legal",
  Finance: "finance",
  HR: "hr",
  Marketing: "marketing",
  Sales: "sales",
  Product: "product",
  Technology: "technology",
  Operations: "operations",
  Infrastructure: "infrastructure",
  Health: "health",
} as const;

/**
 * Groups have their own kind of route (#/group/:id), apart from departments (#/dept/:id), so a
 * group may share an id with a department. Ids must be unique inside each kind, not across them.
 * Kept as a contract for the tests (no product code calls it yet): the ids that the groups of the catalogue use, kept with the rules that check them.
 */
export const GROUP_IDS = {
  "Legal & Compliance": "legal",
  "Finance & People": "finance-people",
  Growth: "growth",
  "Product & Tech": "product-tech",
  Operations: "operations",
  Health: "health",
} as const;

/** Closed list of what a department can depend on another for. Pending review. */
export const DEPENDENCY_ASPECTS = {
  "data-protection": "Personal data handling and privacy obligations",
  contracts: "Contracts and agreements that must be drafted or reviewed",
  "product-spec": "What the product does and how it is described",
  pricing: "Prices, fees and billing terms",
  licenses: "Licenses and permits needed to operate",
  hiring: "People to recruit, onboard or train",
  budget: "Money to approve or allocate",
  brand: "Name, identity and public messaging",
  suppliers: "Suppliers and third parties to select or manage",
} as const;
export type DependencyAspectId = keyof typeof DEPENDENCY_ASPECTS;

export const isCatalogAspect = (id: string): id is DependencyAspectId =>
  Object.hasOwn(DEPENDENCY_ASPECTS, id);

export type BuildDepartmentsError = "missing_department" | "unknown_department" | "duplicate_department";
export type BuildDepartmentsResult =
  | { ok: true; departments: Department[] }
  | { ok: false; code: BuildDepartmentsError };

/**
 * plan.departments from the validation, in its order (heaviest first) and with its tiers. The
 * validation must have exactly one entry for each department of the catalog: a missing one, one
 * the catalog does not know, or a repeated one is an error with its code. Nothing is invented,
 * dropped or repeated, so what comes out is always a list the plan accepts.
 */
export function buildDepartments(validation: Pick<Validation, "departments">): BuildDepartmentsResult {
  const seen = new Set<string>();
  const departments: Department[] = [];
  for (const { name, tier } of validation.departments) {
    if (!Object.hasOwn(DEPARTMENT_IDS, name)) return { ok: false, code: "unknown_department" };
    const id = DEPARTMENT_IDS[name as keyof typeof DEPARTMENT_IDS];
    if (seen.has(id)) return { ok: false, code: "duplicate_department" };
    seen.add(id);
    departments.push({ id, name, tier });
  }
  if (seen.size !== Object.keys(DEPARTMENT_IDS).length) return { ok: false, code: "missing_department" };
  return { ok: true, departments };
}
