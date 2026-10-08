import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { checkPlan } from "../../plan/plan-check.js";
import { derivePlan } from "../../plan/plan-derived.js";
import { applyPlanAction } from "../../plan/plan-actions.js";
import { LIMITS } from "../../plan/plan-model.js";
import { BENCH_SIZES, syntheticPlan } from "./generate.js";

// A generous time budget, so the test catches a return of the slow rules (seconds) without being fragile
const BUDGET_MS = 1500;

function timed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("the largest plan that LIMITS allows stays within the time budget", () => {
  const plan = syntheticPlan(BENCH_SIZES.maximum);

  test("the synthetic plan is at the limits", () => {
    assert.equal(plan.tasks.length, LIMITS.tasks);
    assert.equal(plan.steps.length, LIMITS.steps);
  });

  test("derivePlan takes less than the budget", () => {
    assert.ok(timed(() => derivePlan(plan)) < BUDGET_MS);
  });

  test("checkPlan takes less than the budget", () => {
    assert.ok(timed(() => checkPlan(plan)) < BUDGET_MS);
  });

  test("applying a step action takes less than the budget", () => {
    const first = plan.steps[0];
    assert.ok(timed(() => applyPlanAction(plan, first.id, "launch", { now: () => "2026-10-08T10:00:00Z", actor: "user" })) < BUDGET_MS);
  });
});
