import { parsePlan, type Plan } from "../../plan/plan-model.js";

const origin = { kind: "rule" } as const;

/**
 * A small plan with a gap: "Plan the development" waits for product_type, and an AI step ("Describe
 * the business") is where a fact can come from. Valid for checkPlan.
 */
export function exampleGrowthPlan(): Plan {
  return parsePlan({
    timeline: { unit: "week" },
    departments: [
      { id: "product", name: "Product", tier: "core" },
      { id: "technology", name: "Technology", tier: "important" },
      { id: "operations", name: "Operations", tier: "light" },
    ],
    phases: [
      { id: "f1", name: "Prepare", order: 0 },
      { id: "f2", name: "Set up", order: 1 },
    ],
    tasks: [
      { id: "t-idea", phaseId: "f1", primaryDepartmentId: "product", title: "Describe the idea", origin, confidence: 100 },
      {
        id: "t-plan",
        phaseId: "f2",
        primaryDepartmentId: "product",
        title: "Plan the development",
        origin,
        confidence: 100,
        placeholder: { waitsFor: ["product_type"] },
      },
    ],
    steps: [
      {
        id: "s-idea",
        taskId: "t-idea",
        departmentId: "product",
        text: "Describe the business in one paragraph",
        executor: "ai",
        evidence: { kind: "none" },
        effortHours: 1,
        waitDays: 0,
        status: "not_started",
        events: [],
        origin,
        confidence: 100,
      },
    ],
    relations: [{ level: "task", from: "t-plan", to: "t-idea", type: "follows" }],
  });
}
