import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { StepSchema, type Step } from "../../plan/plan-model.js";
import { STEP_ACTION_ERRORS, applyStepAction, type StepAction } from "../../plan/step-actions.js";
import { stepProblems } from "../../plan/step-rules.js";
import { prng } from "./prng.js";

const SEED = 20261007;
const SEQUENCES = 300;
const ACTIONS_PER_SEQUENCE = 60;
const BASE = Date.parse("2026-10-07T10:00:00Z");

const ACTIONS: StepAction[] = [
  "launch", "attach_output", "answer", "confirm_output", "reject_output",
  "submit_proof", "wait_third_party", "third_party_responded", "reopen", "change_executor",
];

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

type Random = ReturnType<typeof prng>;

function newStep(random: Random): Step {
  const executor = random.pick(["ai", "user", "third_party"] as const);
  const kinds = executor === "ai" ? ["none", "accepted_output", "written_confirmation", "receipt"] : ["none", "written_confirmation", "receipt"];
  return {
    id: "s1",
    taskId: "t1",
    departmentId: "legal",
    text: "A step",
    executor,
    ...(executor === "user" && { mode: random.pick(["online", "in_person"]) }),
    evidence: { kind: random.pick(kinds) },
    effortHours: 1,
    waitDays: 0,
    status: "not_started",
    events: [],
    origin: { kind: "rule" },
    confidence: 100,
  } as Step;
}

/** A payload that fits the action, or (one time in five) something that probably does not */
function payloadFor(random: Random, action: StepAction, step: Step, counter: number): unknown {
  if (random.chance(0.2)) {
    return random.pick([undefined, null, {}, "text", { text: "" }, { answers: [] }, { summary: "", questions: [] }, { text: "x", extra: 1 }]);
  }
  switch (action) {
    case "attach_output":
      return {
        summary: `Summary ${counter}`,
        ...(random.chance(0.3) && { documentRef: `doc${counter}` }),
        questions: Array.from({ length: random.int(4) }, (_, i) => `Question ${counter}.${i}`),
      };
    case "answer":
      return { answers: (step.outputs?.at(-1)?.questions ?? []).map((_, i) => `Answer ${counter}.${i}`) };
    case "submit_proof":
      return { text: `Proof ${counter}` };
    case "change_executor": {
      // Mostly a sensible change; now and then the same executor or a wrong mode
      const target = random.chance(0.1) ? step.executor : random.pick((["ai", "user", "third_party"] as const).filter((e) => e !== step.executor));
      const modeWrong = random.chance(0.1);
      const needsEvidence = step.evidence.kind === "accepted_output" && target !== "ai";
      return {
        executor: target,
        ...((target === "user") !== modeWrong && { mode: random.pick(["online", "in_person"]) }),
        ...((needsEvidence || random.chance(0.2)) && { evidence: { kind: random.pick(target === "ai" ? ["none", "accepted_output", "receipt"] : ["none", "written_confirmation", "receipt"]) } }),
      };
    }
    default:
      return undefined;
  }
}

describe("random sequences of actions", () => {
  test("every accepted action leaves a step without broken invariants (fixed seed)", () => {
    const random = prng(SEED);
    const accepted = new Map<string, number>();
    const refused = new Map<string, number>();
    const reached = new Set<string>();
    let counter = 0;
    let finished = 0;
    let changes = 0;
    let kept = 0;

    for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
      let step = newStep(random);
      let minutes = 0;
      for (let turn = 0; turn < ACTIONS_PER_SEQUENCE; turn += 1) {
        counter += 1;
        const action = random.pick(ACTIONS);
        const actor = random.chance(0.85) ? "user" : random.pick(["ai", "system"] as const);
        const readiness = random.pick(["ready", "ready", "blocked", "not_applicable"] as const);
        const feedsOthers = random.chance(0.3);
        // The clock moves forward, and now and then jumps back
        minutes += random.int(4);
        const at = new Date(BASE + (random.chance(0.05) ? minutes - 30 : minutes) * 60_000).toISOString();
        const payload = payloadFor(random, action, step, counter);

        const before = structuredClone(step);
        const result = applyStepAction(deepFreeze(structuredClone(step)), action, { now: () => at, actor, readiness, feedsOthers, payload });
        assert.deepEqual(step, before, "the step received must not change");

        if (!result.ok) {
          assert.ok((STEP_ACTION_ERRORS as readonly string[]).includes(result.code), result.code);
          refused.set(result.code, (refused.get(result.code) ?? 0) + 1);
          continue;
        }
        accepted.set(action, (accepted.get(action) ?? 0) + 1);
        const label = `sequence ${sequence} turn ${turn} (${step.executor} ${step.status} ${action})`;
        assert.deepEqual(stepProblems(result.step), [], label);
        assert.ok(StepSchema.safeParse(result.step).success, label);
        assert.equal(result.step.events.length, step.events.length + 1, label);
        assert.deepEqual(result.step.events.at(-1), result.event, label);
        assert.equal(result.step.status, result.event.to, label);
        assert.equal(result.event.from, step.status, label);
        assert.equal(result.event.actor, actor, label);
        reached.add(`${result.step.executor} ${result.step.status}`);
        if (action === "change_executor") {
          // The change keeps everything but the executor (and the mode that goes with it)
          const { executor, mode, events, ...restAfter } = result.step;
          const { executor: oldExecutor, mode: oldMode, events: oldEvents, evidence: oldEvidence, ...restBefore } = step;
          const { evidence, ...restAfterNoEvidence } = restAfter;
          assert.deepEqual(restAfterNoEvidence, restBefore, label);
          assert.notEqual(executor, oldExecutor, label);
          assert.deepEqual(result.event, { at, actor, action, from: "not_started", to: "not_started", executorFrom: oldExecutor, executorTo: executor }, label);
          assert.equal(mode !== undefined, executor === "user", label);
          if (feedsOthers) assert.equal(executor, "ai", `${label}: a step in use stayed AI`);
          if (step.outputs?.length) kept += 1;
          changes += 1;
        }
        step = result.step;
        if (step.status === "done") {
          finished += 1;
          step = newStep(random);
          minutes = 0;
        }
      }
    }

    // The run must be able to find problems: every action was accepted at some point, every
    // error code was seen, and every executor got to every status it can reach
    for (const action of ACTIONS) assert.ok((accepted.get(action) ?? 0) > 0, `${action} was never accepted`);
    // output_not_confirmed needs an AI step waiting for the person with no draft, which no valid
    // sequence produces: the unit tests of the actions cover it with a step built by hand
    for (const code of STEP_ACTION_ERRORS.filter((c) => c !== "output_not_confirmed")) assert.ok((refused.get(code) ?? 0) > 0, `${code} was never seen`);
    const expectedReached = [
      "ai running", "ai waiting_user", "ai done", "ai rejected", "ai not_started",
      "user running", "user waiting_third_party", "user done", "user rejected", "user not_started",
      "third_party waiting_third_party", "third_party done", "third_party rejected", "third_party not_started",
    ];
    for (const key of expectedReached) assert.ok(reached.has(key), `${key} was never reached`);
    assert.ok(changes > 100, `only ${changes} executor changes`);
    assert.ok(kept > 0, "no change kept old outputs");
    assert.ok(finished > 50, `only ${finished} steps got to done`);
  });

  test("the same seed gives the same run", () => {
    const run = () => {
      const random = prng(SEED);
      return Array.from({ length: 20 }, () => random.int(1000));
    };
    assert.deepEqual(run(), run());
    assert.notDeepEqual(run(), (() => { const r = prng(SEED + 1); return Array.from({ length: 20 }, () => r.int(1000)); })());
  });
});
