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

/**
 * plan.departments from the validation, in its order (heaviest first). A department the
 * validation lacks is an error with code "missing_department", never invented.
 */
export function buildDepartments(validation: Pick<Validation, "departments">): Department[] {
  const byName = new Map(validation.departments.map((item) => [item.name, item]));
  for (const [name, id] of Object.entries(DEPARTMENT_IDS)) {
    if (!byName.has(name)) {
      throw Object.assign(new Error(`Validation lacks a department (missing_department): ${id}`), {
        code: "missing_department" as const,
      });
    }
  }
  return validation.departments
    .filter((item) => Object.hasOwn(DEPARTMENT_IDS, item.name))
    .map((item) => ({ id: DEPARTMENT_IDS[item.name as keyof typeof DEPARTMENT_IDS], name: item.name, tier: item.tier }));
}
