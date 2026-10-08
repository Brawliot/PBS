import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { derivePlan } from "../../plan/plan-derived.js";

describe("derivePlan on the restaurant plan", () => {
  test("gives the exact derived values", () => {
    assert.deepEqual(derivePlan(restaurantPlan()), {
      problems: [],
      steps: {
        // Legal's first step: free to start, and nothing feeds on it, so it can also change executor
        "s-menu": { readiness: "ready", availableActions: ["launch", "change_executor"] },
        // The AI step whose output feeds the permits: it can start, but its executor is fixed
        "s-viability": { readiness: "ready", availableActions: ["launch"] },
        // Waits for the menu to be done (blocks), so only the executor can change
        "s-permits": { readiness: "blocked", availableActions: ["change_executor"] },
        "s-opening": { readiness: "ready", availableActions: ["launch", "change_executor"] },
      },
      tasks: {
        "t-menu": {
          status: "not_started",
          automation: "manual",
          effortHours: 2,
          elapsed: { ok: true, days: 0.25 },
          departments: { primary: "legal", secondary: [] },
        },
        "t-viability": {
          status: "not_started",
          automation: "automatic",
          effortHours: 2,
          elapsed: { ok: true, days: 0.25 },
          departments: { primary: "finance", secondary: [] },
        },
        "t-permits": {
          status: "not_started",
          automation: "manual",
          effortHours: 2,
          elapsed: { ok: true, days: 0.25 },
          departments: { primary: "legal", secondary: [] },
        },
        "t-opening": {
          status: "not_started",
          automation: "manual",
          effortHours: 2,
          elapsed: { ok: true, days: 0.25 },
          departments: { primary: "finance", secondary: [] },
        },
      },
      phases: {
        // Nothing blocks the first phase; the second is only "follows", which never blocks
        f1: { status: "not_started", progress: { total: 2, done: 0, percent: 0 } },
        f2: { status: "not_started", progress: { total: 1, done: 0, percent: 0 } },
        // Blocked by f2 (f2 blocks f3) until f2 is done
        f3: { status: "blocked", progress: { total: 1, done: 0, percent: 0 } },
      },
      departments: {
        legal: { total: 2, notStarted: 2, inProgress: 0, blocked: 0, done: 0 },
        finance: { total: 2, notStarted: 2, inProgress: 0, blocked: 0, done: 0 },
      },
    });
  });

  test("derives nothing from a plan it does not change: the same plan gives the same values", () => {
    assert.deepEqual(derivePlan(restaurantPlan()), derivePlan(restaurantPlan()));
  });
});
