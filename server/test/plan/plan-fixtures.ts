import type { Plan } from "../../plan/plan-model.js";

const origin = { kind: "rule" } as const;

/**
 * The Japanese restaurant, whole and valid: four departments' worth of steps in four tasks across three
 * phases on a weekly timeline. Built fresh on each call, so a test may change its copy.
 */
export function restaurantPlan(): Plan {
  return {
    timeline: { unit: "week" },
    departments: [
      { id: "legal", name: "Legal & Compliance", tier: "core" },
      { id: "finance", name: "Finance", tier: "important" },
    ],
    phases: [
      { id: "f1", name: "Preparation", order: 0, startUnit: 0, lengthUnits: 8 },
      { id: "f2", name: "Permits and premises", order: 1, startUnit: 6, lengthUnits: 10 },
      { id: "f3", name: "Opening", order: 2, startUnit: 16, lengthUnits: 8 },
    ],
    tasks: [
      { id: "t-menu", phaseId: "f1", primaryDepartmentId: "legal", title: "Menu", origin, confidence: 100 },
      { id: "t-viability", phaseId: "f1", primaryDepartmentId: "finance", title: "Viability", origin, confidence: 100 },
      { id: "t-permits", phaseId: "f2", primaryDepartmentId: "legal", title: "Permits", origin, confidence: 100 },
      { id: "t-opening", phaseId: "f3", primaryDepartmentId: "finance", title: "Opening", origin, confidence: 100 },
    ],
    steps: [
      step("s-menu", "t-menu", "legal", { executor: "user", mode: "online" }),
      step("s-viability", "t-viability", "finance", { executor: "ai" }),
      step("s-permits", "t-permits", "legal", { executor: "user", mode: "in_person" }),
      step("s-opening", "t-opening", "finance", { executor: "user", mode: "in_person" }),
    ],
    relations: [
      { level: "phase", from: "f2", to: "f1", type: "follows" },
      { level: "phase", from: "f2", to: "f3", type: "blocks" },
      { level: "task", from: "t-permits", to: "t-menu", type: "follows" },
      { level: "step", from: "s-menu", to: "s-permits", type: "blocks" },
      { level: "step", from: "s-viability", to: "s-permits", type: "feeds" },
      { level: "department", from: "legal", to: "finance", type: "blocks", aspect: { kind: "catalog", id: "budget" } },
    ],
  } as unknown as Plan;
}

/** A step that is not started and has no events (its status is where its events end, so this is always valid) */
export function step(id: string, taskId: string, departmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    taskId,
    departmentId,
    text: `Secret text of ${id}`,
    executor: "ai",
    evidence: { kind: "none" },
    effortHours: 2,
    waitDays: 0,
    status: "not_started",
    events: [],
    origin,
    confidence: 100,
    ...overrides,
  };
}

/** A copy of a value with every object frozen, so that any write to it throws */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
