/**
 * A step has room for MAX_EVENTS events. When it is full, every action answers events_full (409 in the API):
 * the step stays valid, the plan can still be read, and no action is offered for it.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_EVENTS, StepSchema, parsePlan, type Plan, type Step } from "../../plan/plan-model.js";
import { applyPlanAction, stepActionContext } from "../../plan/plan-actions.js";
import { applyStepAction, availableActions, STEP_ACTION_ERRORS, type StepAction, type StepActor } from "../../plan/step-actions.js";
import { EVENT_ACTIONS } from "../../plan/plan-model.js";
import { checkPlan } from "../../plan/plan-check.js";
import { readiness } from "../../plan/step-graph.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { handlePlanRequest } from "../../plan-routes.js";

// launch, attach, reject, reopen: four events per cycle, so MAX_EVENTS is reached after MAX_EVENTS / 4 cycles
const CYCLE: [StepAction, StepActor, unknown?][] = [
  ["launch", "user"],
  ["attach_output", "ai", { summary: "Draft", questions: ["Which city?"] }],
  ["reject_output", "user"],
  ["reopen", "user"],
];
const EXPECTED_CYCLES = MAX_EVENTS / CYCLE.length;

/** A clock that moves forward on every call, in the form the schemas accept */
const clock = () => {
  let minute = 0;
  return () => new Date(Date.UTC(2026, 9, 7, 10) + minute++ * 60_000).toISOString().replace(".000Z", "Z");
};

/** The plan with one AI step that is ready, run through full cycles until its history is full */
function fullPlan(): { plan: Plan; stepId: string } {
  const start = restaurantPlan();
  const stepId = start.steps.find((step) => step.executor === "ai" && readiness(step, start.steps, start.relations) === "ready")!.id;
  const now = clock();
  let plan = start;
  for (let cycle = 0; cycle < EXPECTED_CYCLES; cycle++) {
    for (const [action, actor, payload] of CYCLE) {
      const result = applyPlanAction(plan, stepId, action, { now, actor, payload });
      assert.ok(result.ok, `cycle ${cycle + 1}, ${action}: ${result.ok ? "" : result.code}`);
      plan = result.plan;
    }
  }
  return { plan, stepId };
}

describe("a step whose history is full", () => {
  test("the cycle ends with events_full, not with invalid_result, after MAX_EVENTS events", () => {
    const { plan, stepId } = fullPlan();
    const step = plan.steps.find((candidate) => candidate.id === stepId)!;
    assert.equal(step.events.length, MAX_EVENTS);

    const now = clock();
    const refused = applyPlanAction(plan, stepId, "launch", { now, actor: "user" });
    assert.deepEqual(refused, { ok: false, code: "events_full" });
    for (const [action, actor, payload] of CYCLE) {
      assert.deepEqual(applyPlanAction(plan, stepId, action, { now, actor, payload }), { ok: false, code: "events_full" }, action);
    }
  });

  test("the step is still valid, the plan is still readable and checkPlan is still empty", () => {
    const { plan, stepId } = fullPlan();
    const step = plan.steps.find((candidate) => candidate.id === stepId)!;
    assert.ok(StepSchema.safeParse(step).success);
    assert.deepEqual(checkPlan(plan), []);
    assert.doesNotThrow(() => parsePlan(JSON.parse(JSON.stringify(plan))));
  });

  test("no action is offered for it, and each action is refused with events_full", () => {
    const { plan, stepId } = fullPlan();
    const step = plan.steps.find((candidate) => candidate.id === stepId)!;
    const context = stepActionContext(plan, stepId, { now: clock(), actor: "user" })!;
    assert.deepEqual(availableActions(step, context.readiness, context.feedsOthers), []);
    for (const action of EVENT_ACTIONS) {
      assert.deepEqual(applyStepAction(step, action, { ...context, actor: "user" }), { ok: false, code: "events_full" }, action);
    }
  });

  test("events_full is one of the step action codes, so every route can answer it", () => {
    assert.ok((STEP_ACTION_ERRORS as readonly string[]).includes("events_full"));
  });

  test("the API answers the launch with 409 and the fixed body", async () => {
    const { plan, stepId } = fullPlan();
    const repo = new InMemoryPlanRepository();
    const stored = await repo.create("local", "Full history", plan);
    const response = await handlePlanRequest({
      method: "POST",
      path: `/api/plan/${stored.id}/steps/${stepId}/actions`,
      body: JSON.stringify({ action: "launch", expectedVersion: stored.version }),
      repo,
      reports: undefined,
      now: clock(),
      env: {},
    });
    assert.deepEqual(response, { status: 409, body: { error: "This step has reached the limit of its history and cannot change", code: "events_full" } });

    const read = await handlePlanRequest({ method: "GET", path: `/api/plan/${stored.id}`, body: "", repo, reports: undefined, now: clock(), env: {} });
    assert.equal(read.status, 200);
  });
});
