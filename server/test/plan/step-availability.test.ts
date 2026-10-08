import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_ACTIONS, type Plan, type Step } from "../../plan/plan-model.js";
import { applyPlanAction } from "../../plan/plan-actions.js";
import { feedsAnyStep, readiness } from "../../plan/step-graph.js";
import { availableActions, type StepAction } from "../../plan/step-actions.js";
import { restaurantPlan } from "../../plan/demo-plan.js";

const NOW = "2026-10-08T10:00:00Z";
const now = () => NOW;

/** Refusals that depend on the step and its readiness alone: the ones availableActions must predict */
const STATE_REFUSALS = ["not_allowed", "not_ready", "wrong_actor", "rounds_exceeded", "executor_in_use"];

/** A payload that the action accepts, for a step in its current state */
function payloadFor(step: Step, action: StepAction): unknown {
  switch (action) {
    case "attach_output":
      return { summary: "Resumen de prueba", questions: ["¿Qué falta?"] };
    case "answer":
      return { answers: (step.outputs?.at(-1)?.questions ?? []).map(() => "Respuesta") };
    case "submit_proof":
      return { text: "Justificante de prueba" };
    case "change_executor":
      return step.executor === "ai" ? { executor: "user", mode: "online" } : { executor: "ai" };
    default:
      return undefined;
  }
}

/** Checks every step of the plan, and every action on it, against what applyStepAction does */
function checkAvailability(plan: Plan): void {
  for (const step of plan.steps) {
    const listed = availableActions(step, readiness(step, plan.steps, plan.relations), feedsAnyStep(step, plan.relations));
    for (const action of EVENT_ACTIONS) {
      const result = applyPlanAction(plan, step.id, action, { now, actor: "user", payload: payloadFor(step, action) });
      const where = `${step.id} ${action} from ${step.status}`;
      if (listed.includes(action)) {
        assert.ok(result.ok, `${where} is listed but refused with ${result.ok ? "" : result.code}`);
      } else {
        assert.ok(!result.ok && STATE_REFUSALS.includes(result.code), `${where} is not listed but was not refused for its state: ${result.ok ? "accepted" : result.code}`);
      }
    }
  }
}

/** Walks the demo plan through the states that matter, checking every step at every state */
function walk(steps: [string, StepAction][]): void {
  let plan = restaurantPlan();
  checkAvailability(plan);
  for (const [stepId, action] of steps) {
    const step = plan.steps.find((candidate) => candidate.id === stepId)!;
    const result = applyPlanAction(plan, stepId, action, { now, actor: "user", payload: payloadFor(step, action) });
    assert.ok(result.ok, `${stepId} ${action} should apply on the way: ${result.ok ? "" : result.code}`);
    plan = result.plan;
    checkAvailability(plan);
  }
}

describe("availableActions agrees with applyStepAction", () => {
  test("the restaurant plan, from the start", () => {
    walk([]);
  });

  test("the life of a user step: launch, third party, reject and reopen, then done", () => {
    walk([["s-menu", "launch"], ["s-menu", "wait_third_party"], ["s-menu", "third_party_responded"], ["s-menu", "reject_output"], ["s-menu", "reopen"], ["s-menu", "launch"], ["s-menu", "submit_proof"]]);
  });

  test("a step that waits for others: the permits open once the menu is done and the viability output is confirmed", () => {
    walk([
      ["s-menu", "launch"],
      ["s-menu", "submit_proof"],
      ["s-viability", "launch"],
      ["s-viability", "attach_output"],
      ["s-viability", "confirm_output"],
      ["s-permits", "launch"],
      ["s-permits", "submit_proof"],
    ]);
  });

  test("an AI step through its rounds until the rounds run out", () => {
    walk([
      ["s-viability", "launch"],
      ["s-viability", "attach_output"],
      ["s-viability", "answer"],
      ["s-viability", "attach_output"],
      ["s-viability", "answer"],
      ["s-viability", "attach_output"],
    ]);
  });

  test("an AI step that is confirmed, and one that is rejected", () => {
    walk([["s-viability", "launch"], ["s-viability", "attach_output"], ["s-viability", "confirm_output"]]);
    walk([["s-viability", "launch"], ["s-viability", "attach_output"], ["s-viability", "reject_output"], ["s-viability", "reopen"]]);
  });

  test("the executor of a step that nothing uses can change, and it is then an AI step", () => {
    walk([["s-permits", "change_executor"]]);
  });
});

describe("availableActions on the restaurant plan, exactly", () => {
  test("a step that has not started", () => {
    const step = restaurantPlan().steps.find((candidate) => candidate.id === "s-viability")!;
    assert.deepEqual(availableActions(step, "ready", true), ["launch"]);
  });

  test("a running AI step can only deliver an output: its proof comes from confirming it", () => {
    const plan = applyPlanAction(restaurantPlan(), "s-viability", "launch", { now, actor: "user" });
    assert.ok(plan.ok);
    const step = plan.plan.steps.find((candidate) => candidate.id === "s-viability")!;
    assert.deepEqual(availableActions(step, "not_applicable", true), ["attach_output"]);
  });
});

describe("availableActions with evidence the step still lacks", () => {
  test("confirming an output needs the proof first, and the proof keeps the status", () => {
    const plan = restaurantPlan();
    plan.steps = plan.steps.map((step) => (step.id === "s-viability" ? { ...step, evidence: { kind: "receipt" } } : step));
    const launched = applyPlanAction(plan, "s-viability", "launch", { now, actor: "user" });
    assert.ok(launched.ok);
    const attached = applyPlanAction(launched.plan, "s-viability", "attach_output", { now, actor: "user", payload: { summary: "x", questions: [] } });
    assert.ok(attached.ok);

    const step = attached.plan.steps.find((candidate) => candidate.id === "s-viability")!;
    assert.deepEqual(availableActions(step, "not_applicable", true), ["answer", "reject_output", "submit_proof"]);
    // Not listed because of the missing proof, which is not one of the state refusals
    const refused = applyPlanAction(attached.plan, "s-viability", "confirm_output", { now, actor: "user" });
    assert.deepEqual(refused, { ok: false, code: "missing_proof" });

    const proved = applyPlanAction(attached.plan, "s-viability", "submit_proof", { now, actor: "user", payload: { text: "Recibo" } });
    assert.ok(proved.ok);
    const after = proved.plan.steps.find((candidate) => candidate.id === "s-viability")!;
    assert.ok(availableActions(after, "not_applicable", true).includes("confirm_output"));
  });
});
