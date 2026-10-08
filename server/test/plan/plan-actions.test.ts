import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan } from "../../plan/plan-check.js";
import { PLAN_ACTION_ERRORS, applyPlanAction, stepActionContext } from "../../plan/plan-actions.js";
import type { Plan } from "../../plan/plan-model.js";
import type { StepAction, StepActor } from "../../plan/step-actions.js";
import { STEP_ACTION_ERRORS } from "../../plan/step-actions.js";
import { prng } from "./prng.js";
import { deepFreeze, restaurantPlan, step } from "./plan-fixtures.js";

const T = "2026-10-07T10:00:00Z";
const now = () => T;
const options = (actor: StepActor = "user", payload?: unknown) => ({ now, actor, payload });

/** Applies an action and asserts it worked; returns the new plan */
function ok(plan: Plan, stepId: string, action: StepAction, actor: StepActor = "user", payload?: unknown): Plan {
  const result = applyPlanAction(plan, stepId, action, options(actor, payload));
  assert.ok(result.ok, `${action} on ${stepId} should work, got ${JSON.stringify(result)}`);
  return result.plan;
}
const refused = (plan: Plan, stepId: string, action: StepAction, actor: StepActor = "user", payload?: unknown) => {
  const result = applyPlanAction(plan, stepId, action, options(actor, payload));
  assert.equal(result.ok, false, `${action} on ${stepId} should be refused`);
  return result.ok ? undefined : result.code;
};

/** Two steps: an AI step that feeds a user step, which can only start once the AI output is confirmed */
function feedPlan(): Plan {
  const plan = restaurantPlan();
  return {
    ...plan,
    steps: [step("a", "t-viability", "finance", { executor: "ai" }), step("b", "t-permits", "legal", { executor: "user", mode: "online" })] as never,
    relations: [{ level: "step", from: "a", to: "b", type: "feeds" }] as never,
  };
}

describe("stepActionContext", () => {
  test("readiness and feedsOthers come from the whole plan", () => {
    const plan = restaurantPlan();
    // s-permits waits for s-menu (blocks) and reads the output of s-viability (feeds)
    assert.deepEqual(
      { readiness: stepActionContext(plan, "s-permits", options())?.readiness, feedsOthers: stepActionContext(plan, "s-permits", options())?.feedsOthers },
      { readiness: "blocked", feedsOthers: false },
    );
    assert.equal(stepActionContext(plan, "s-viability", options())?.feedsOthers, true);
    assert.equal(stepActionContext(plan, "s-menu", options())?.readiness, "ready");
  });

  test("an unknown step has no context", () => {
    assert.equal(stepActionContext(restaurantPlan(), "ghost", options()), undefined);
  });
});

describe("applyPlanAction: each action on a plan", () => {
  test("an unknown step is refused, and nothing changes", () => {
    assert.equal(refused(restaurantPlan(), "ghost", "launch"), "unknown_step");
  });

  test("launching a step that waits for another one is not_ready; launching the other one works", () => {
    const plan = restaurantPlan();
    assert.equal(refused(plan, "s-permits", "launch"), "not_ready");
    const next = ok(plan, "s-menu", "launch");
    assert.equal(next.steps.find((item) => item.id === "s-menu")?.status, "running");
  });

  test("a step that reads an output waits until the output is confirmed", () => {
    const plan = feedPlan();
    assert.equal(refused(plan, "b", "launch"), "not_ready");
    let next = ok(plan, "a", "launch");
    next = ok(next, "a", "attach_output", "ai", { summary: "Viability summary", questions: [] });
    assert.equal(refused(next, "b", "launch"), "not_ready");
    next = ok(next, "a", "confirm_output");
    assert.equal(stepActionContext(next, "b", options())?.readiness, "ready");
    next = ok(next, "b", "launch");
    assert.equal(next.steps.find((item) => item.id === "b")?.status, "running");
  });

  test("changing the executor of a step that feeds another one is executor_in_use", () => {
    assert.equal(refused(feedPlan(), "a", "change_executor", "user", { executor: "third_party" }), "executor_in_use");
  });

  test("changing the executor of a step that feeds nothing works, and keeps the status", () => {
    const next = ok(restaurantPlan(), "s-opening", "change_executor", "user", { executor: "ai" });
    const changed = next.steps.find((item) => item.id === "s-opening");
    assert.equal(changed?.executor, "ai");
    assert.equal(changed?.status, "not_started");
    assert.equal(changed?.mode, undefined);
  });

  test("the person's action refused for an AI step: only the system attaches an output", () => {
    assert.equal(refused(feedPlan(), "a", "launch", "ai"), "wrong_actor");
  });

  test("a proof closes a user step; the status moves on the plan", () => {
    let next = ok(restaurantPlan(), "s-menu", "launch");
    next = ok(next, "s-menu", "submit_proof", "user", { text: "Menu confirmed" });
    assert.equal(next.steps.find((item) => item.id === "s-menu")?.status, "done");
  });

  test("the rejected output and the reopen keep the other steps as they are", () => {
    let next = ok(feedPlan(), "a", "launch");
    next = ok(next, "a", "attach_output", "ai", { summary: "First", questions: [] });
    const before = next.steps.find((item) => item.id === "b");
    next = ok(next, "a", "reject_output");
    assert.deepEqual(next.steps.find((item) => item.id === "b"), before);
    assert.equal(next.steps.find((item) => item.id === "a")?.status, "rejected");
  });

  test("refusals use the step error codes, and the list of codes is the step list plus unknown_step", () => {
    assert.deepEqual(PLAN_ACTION_ERRORS, [...STEP_ACTION_ERRORS, "unknown_step"]);
    assert.equal(refused(restaurantPlan(), "s-menu", "confirm_output"), "not_allowed");
  });

  test("a plan that already had a problem keeps working for the steps that do not add to it", () => {
    const plan = restaurantPlan();
    const broken: Plan = { ...plan, relations: [...plan.relations, { level: "step", from: "s-menu", to: "s-opening", type: "feeds" }] as never };
    const next = ok(broken, "s-menu", "launch");
    assert.equal(next.steps.find((item) => item.id === "s-menu")?.status, "running");
  });
});

describe("applyPlanAction: the plan received is never changed", () => {
  test("a frozen plan works, and the copy that comes back is new", () => {
    const plan = deepFreeze(feedPlan());
    const before = structuredClone(plan);
    const result = applyPlanAction(plan, "a", "launch", options("user"));
    assert.ok(result.ok);
    assert.notEqual(result.plan, plan);
    assert.deepEqual(plan, before);
  });
});

describe("applyPlanAction: random sequences keep the plan valid", () => {
  const SEED = 20261008;
  const SEQUENCES = 120;
  const TURNS = 50;
  const ACTIONS: StepAction[] = [
    "launch", "attach_output", "answer", "confirm_output", "reject_output",
    "submit_proof", "wait_third_party", "third_party_responded", "reopen", "change_executor",
  ];

  function payloadFor(random: ReturnType<typeof prng>, action: StepAction, plan: Plan, stepId: string, counter: number): unknown {
    if (random.chance(0.15)) return random.pick([undefined, {}, { text: "" }]);
    switch (action) {
      case "attach_output":
        return { summary: `Summary ${counter}`, questions: Array.from({ length: random.int(3) }, (_, i) => `Q ${counter}.${i}`) };
      case "answer": {
        const latest = plan.steps.find((item) => item.id === stepId)?.outputs?.at(-1);
        return { answers: (latest?.questions ?? []).map((_, i) => `A ${counter}.${i}`) };
      }
      case "submit_proof":
        return { text: `Proof ${counter}` };
      case "change_executor": {
        const current = plan.steps.find((item) => item.id === stepId)!.executor;
        const executor = random.pick((["ai", "user", "third_party"] as const).filter((item) => item !== current));
        return { executor, ...(executor === "user" && { mode: random.pick(["online", "in_person"] as const) }) };
      }
      default:
        return undefined;
    }
  }

  test("every accepted action leaves a plan with no checkPlan problems (fixed seed)", () => {
    const random = prng(SEED);
    const codes = new Map<string, number>();
    let accepted = 0;
    let counter = 0;
    for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
      let plan = restaurantPlan();
      for (let turn = 0; turn < TURNS; turn += 1) {
        counter += 1;
        const stepId = random.pick(plan.steps.map((item) => item.id));
        const action = random.pick(ACTIONS);
        const actor = random.chance(0.85) ? "user" : random.pick(["ai", "system"] as const);
        const payload = payloadFor(random, action, plan, stepId, counter);
        const before = structuredClone(plan);
        const result = applyPlanAction(deepFreeze(structuredClone(plan)), stepId, action, { now, actor, payload });
        assert.deepEqual(plan, before, "the plan received must not change");
        if (!result.ok) {
          assert.ok((PLAN_ACTION_ERRORS as readonly string[]).includes(result.code), result.code);
          codes.set(result.code, (codes.get(result.code) ?? 0) + 1);
          continue;
        }
        accepted += 1;
        const label = `sequence ${sequence} turn ${turn} (${action} on ${stepId})`;
        assert.deepEqual(checkPlan(result.plan), [], label);
        plan = result.plan;
      }
    }
    assert.ok(accepted > 200, `only ${accepted} accepted actions`);
    for (const code of ["not_ready", "executor_in_use", "not_allowed", "wrong_actor"]) {
      assert.ok((codes.get(code) ?? 0) > 0, `${code} was never seen`);
    }
  });
});
