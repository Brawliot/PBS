import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_OUTPUT_QUESTIONS, MAX_ROUNDS, MAX_STEP_TEXT, StepSchema, STEP_EXECUTORS, STEP_STATUSES, type Step } from "../../plan/plan-model.js";
import {
  STEP_ACTION_ERRORS,
  applyStepAction,
  type ActionContext,
  type StepAction,
} from "../../plan/step-actions.js";
import { TRANSITIONS, stepProblems } from "../../plan/step-rules.js";

const T1 = "2026-10-07T10:00:00Z";
const NOW = "2026-10-07T12:00:00Z";
const ACTIONS: StepAction[] = [
  "launch",
  "attach_output",
  "answer",
  "confirm_output",
  "reject_output",
  "submit_proof",
  "wait_third_party",
  "third_party_responded",
  "reopen",
  "change_executor",
];

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** A valid step in a status; the history is one event that leads there */
const make = (executor: string, status: string, overrides: Record<string, unknown> = {}): Step =>
  ({
    id: "s1",
    taskId: "t1",
    departmentId: "legal",
    text: "A step",
    executor,
    ...(executor === "user" && { mode: "online" }),
    evidence: { kind: "none" },
    effortHours: 1,
    waitDays: 0,
    status,
    events: status === "not_started" ? [] : [{ at: T1, actor: "user", action: "launch", from: "not_started", to: status }],
    origin: { kind: "rule" },
    confidence: 100,
    ...overrides,
  }) as Step;
const out = (version: number, state: string, overrides: Record<string, unknown> = {}) => ({
  version,
  state,
  summary: "Draft",
  questions: [{ question: "Which city?" }, { question: "Open on Sundays?" }],
  createdAt: T1,
  ...overrides,
});
const ai = (status: string, overrides: Record<string, unknown> = {}) => make("ai", status, overrides);
const user = (status: string, overrides: Record<string, unknown> = {}) => make("user", status, overrides);
const third = (status: string, overrides: Record<string, unknown> = {}) => make("third_party", status, overrides);
/** Events of an attempt with n rounds: a launch, then attach_output, and for each more round an answer and attach_output */
const attempt = (rounds: number) =>
  Array.from({ length: rounds }, (_, i) => [
    i === 0
      ? { at: T1, actor: "user", action: "launch", from: "not_started", to: "running" }
      : { at: T1, actor: "user", action: "answer", from: "waiting_user", to: "running" },
    { at: T1, actor: "ai", action: "attach_output", from: "running", to: "waiting_user" },
  ]).flat();
const proofOf = { text: "Receipt no. 42", at: T1, by: "user" };

const ctx = (overrides: Partial<ActionContext> = {}): ActionContext => ({
  now: () => NOW,
  actor: "user",
  readiness: "not_applicable",
  feedsOthers: false,
  ...overrides,
});
const run = (step: Step, action: StepAction, overrides: Partial<ActionContext> = {}) => {
  const frozen = deepFreeze(structuredClone(step));
  const result = applyStepAction(frozen, action, ctx(overrides));
  // The input must come out exactly as it went in
  assert.deepEqual(frozen, step);
  return result;
};
const succeeds = (step: Step, action: StepAction, overrides: Partial<ActionContext> = {}) => {
  const result = run(step, action, overrides);
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result)}`);
  return result;
};
const failsWith = (step: Step, action: StepAction, code: string, overrides: Partial<ActionContext> = {}) =>
  assert.deepEqual(run(step, action, overrides), { ok: false, code });

const attach = { summary: "A proposal", questions: ["Which city?", "Open on Sundays?"] };

describe("a successful action", () => {
  test("launch: not_started -> running, one event added, the rest as it was", () => {
    const step = user("not_started");
    const result = succeeds(step, "launch", { readiness: "ready" });
    assert.deepEqual(result.event, { at: NOW, actor: "user", action: "launch", from: "not_started", to: "running" });
    assert.deepEqual(result.step, { ...step, status: "running", events: [result.event] });
    assert.deepEqual(succeeds(ai("not_started"), "launch", { readiness: "ready" }).step.status, "running");
  });

  test("the new event goes at the end of the history", () => {
    const step = user("waiting_third_party");
    const result = succeeds(step, "third_party_responded");
    assert.deepEqual(result.step.events, [...step.events, result.event]);
    assert.deepEqual(result.event, { at: NOW, actor: "user", action: "third_party_responded", from: "waiting_third_party", to: "running" });
  });

  test("attach_output: running -> waiting_user with a first draft, by the AI", () => {
    const result = succeeds(ai("running"), "attach_output", { actor: "ai", payload: { ...attach, documentRef: "doc1" } });
    assert.deepEqual(result.event, { at: NOW, actor: "ai", action: "attach_output", from: "running", to: "waiting_user" });
    assert.equal(result.step.status, "waiting_user");
    assert.deepEqual(result.step.outputs, [
      {
        version: 1,
        state: "draft",
        summary: "A proposal",
        documentRef: "doc1",
        questions: [{ question: "Which city?" }, { question: "Open on Sundays?" }],
        createdAt: NOW,
      },
    ]);
  });

  test("attach_output without documentRef or questions", () => {
    const result = succeeds(ai("running"), "attach_output", { actor: "ai", payload: { summary: "S", questions: [] } });
    assert.deepEqual(result.step.outputs, [{ version: 1, state: "draft", summary: "S", questions: [], createdAt: NOW }]);
  });

  test("attach_output after an answer: the draft is superseded and the new version is a draft", () => {
    const step = ai("running", { outputs: [out(1, "draft")] });
    const result = succeeds(step, "attach_output", { actor: "ai", payload: { summary: "Refined", questions: [] } });
    assert.deepEqual(result.step.outputs?.map((o) => [o.version, o.state]), [[1, "superseded"], [2, "draft"]]);
    assert.equal(result.step.outputs?.[1].summary, "Refined");
  });

  test("attach_output after a rejection: the rejected version stays rejected", () => {
    const step = ai("running", { outputs: [out(1, "rejected")] });
    const result = succeeds(step, "attach_output", { actor: "system", payload: { summary: "Again", questions: [] } });
    assert.deepEqual(result.step.outputs?.map((o) => [o.version, o.state]), [[1, "rejected"], [2, "draft"]]);
    assert.equal(result.event.actor, "system");
  });

  test("the person may deliver an output too", () => {
    assert.equal(succeeds(ai("running"), "attach_output", { actor: "user", payload: { summary: "S", questions: [] } }).event.actor, "user");
  });

  test("answer: fills each question with its answer and the time, and the AI runs again", () => {
    const step = ai("waiting_user", { outputs: [out(1, "draft")] });
    const result = succeeds(step, "answer", { payload: { answers: ["Madrid", " Yes "] } });
    assert.deepEqual(result.event, { at: NOW, actor: "user", action: "answer", from: "waiting_user", to: "running" });
    assert.equal(result.step.status, "running");
    assert.deepEqual(result.step.outputs?.[0].questions, [
      { question: "Which city?", answer: "Madrid", answeredAt: NOW },
      { question: "Open on Sundays?", answer: "Yes", answeredAt: NOW },
    ]);
    assert.equal(result.step.outputs?.[0].state, "draft");
  });

  test("answer: the last allowed round is the one before MAX_ROUNDS versions exist", () => {
    const versions = Array.from({ length: MAX_ROUNDS - 1 }, (_, i) => out(i + 1, i === MAX_ROUNDS - 2 ? "draft" : "superseded"));
    assert.equal(succeeds(ai("waiting_user", { outputs: versions, events: attempt(MAX_ROUNDS - 1) }), "answer", { payload: { answers: ["a", "b"] } }).step.status, "running");
  });

  test("confirm_output: the output is confirmed with its date and the step is done", () => {
    const step = ai("waiting_user", { outputs: [out(1, "superseded"), out(2, "draft")] });
    const result = succeeds(step, "confirm_output");
    assert.deepEqual(result.event, { at: NOW, actor: "user", action: "confirm_output", from: "waiting_user", to: "done" });
    assert.equal(result.step.status, "done");
    assert.deepEqual(result.step.outputs?.map((o) => o.state), ["superseded", "confirmed"]);
    assert.equal(result.step.outputs?.[1].confirmedAt, NOW);
    assert.equal(result.step.outputs?.[0].confirmedAt, undefined);
  });

  test("confirm_output satisfies the accepted_output evidence by itself", () => {
    const step = ai("waiting_user", { evidence: { kind: "accepted_output" }, outputs: [out(1, "draft")] });
    assert.equal(succeeds(step, "confirm_output").step.status, "done");
  });

  test("reject_output: the output is rejected and so is the step", () => {
    const result = succeeds(ai("waiting_user", { outputs: [out(1, "draft")] }), "reject_output");
    assert.deepEqual(result.event, { at: NOW, actor: "user", action: "reject_output", from: "waiting_user", to: "rejected" });
    assert.deepEqual(result.step.outputs?.map((o) => o.state), ["rejected"]);
  });

  test("reject_output on a step without outputs just rejects it", () => {
    for (const step of [user("running"), user("waiting_third_party"), third("waiting_third_party")]) {
      const result = succeeds(step, "reject_output");
      assert.equal(result.step.status, "rejected");
      assert.equal(result.step.outputs, undefined);
    }
  });

  test("submit_proof: a user step is done with the proof saved", () => {
    const result = succeeds(user("running"), "submit_proof", { payload: { text: "  Signed on paper  " } });
    assert.deepEqual(result.event, { at: NOW, actor: "user", action: "submit_proof", from: "running", to: "done" });
    assert.deepEqual(result.step.proof, { text: "Signed on paper", at: NOW, by: "user" });
    assert.equal(result.step.status, "done");
  });

  test("submit_proof: a third-party step is done too", () => {
    const result = succeeds(third("waiting_third_party", { evidence: { kind: "receipt" } }), "submit_proof", { payload: { text: "Ref 7" } });
    assert.equal(result.step.status, "done");
    assert.deepEqual(result.step.proof, { text: "Ref 7", at: NOW, by: "user" });
  });

  test("submit_proof on an AI step saves the proof and waits: confirming the output closes it", () => {
    const step = ai("waiting_user", { evidence: { kind: "written_confirmation" }, outputs: [out(1, "draft")] });
    const proofed = succeeds(step, "submit_proof", { payload: { text: "Email from the lawyer" } });
    assert.deepEqual(proofed.event, { at: NOW, actor: "user", action: "submit_proof", from: "waiting_user", to: "waiting_user" });
    assert.equal(proofed.step.status, "waiting_user");
    assert.equal(proofed.step.proof?.text, "Email from the lawyer");
    assert.equal(succeeds(proofed.step, "confirm_output").step.status, "done");
  });

  test("wait_third_party: a user step waits from running, a third-party step from the start", () => {
    assert.deepEqual(succeeds(user("running"), "wait_third_party").event, {
      at: NOW, actor: "user", action: "wait_third_party", from: "running", to: "waiting_third_party",
    });
    assert.equal(succeeds(third("not_started"), "wait_third_party").step.status, "waiting_third_party");
  });

  test("reopen: a rejected step starts again, for every executor", () => {
    for (const step of [ai("rejected"), user("rejected"), third("rejected")]) {
      const result = succeeds(step, "reopen");
      assert.deepEqual(result.event, { at: NOW, actor: "user", action: "reopen", from: "rejected", to: "not_started" });
      assert.equal(result.step.status, "not_started");
    }
  });

  test("the returned step is valid and is not the one received", () => {
    const step = user("running");
    const result = succeeds(step, "submit_proof", { payload: { text: "x" } });
    assert.ok(StepSchema.safeParse(result.step).success);
    assert.notEqual(result.step, step);
    assert.notEqual(result.step.events, step.events);
  });

  test("the clock is read to stamp the event", () => {
    const times = ["2026-10-07T13:00:00Z"];
    const result = succeeds(user("not_started"), "launch", { readiness: "ready", now: () => times[0] });
    assert.equal(result.event.at, "2026-10-07T13:00:00Z");
  });
});

describe("error codes", () => {
  test("the list of codes is closed", () => {
    assert.deepEqual(
      [...STEP_ACTION_ERRORS],
      [
        "not_allowed", "not_ready", "wrong_actor", "rounds_exceeded", "missing_proof", "output_not_confirmed",
        "invalid_payload", "invalid_result", "executor_in_use", "invalid_executor_change",
      ],
    );
  });

  test("not_allowed: the table does not allow the change", () => {
    failsWith(user("not_started"), "reopen", "not_allowed");
    failsWith(user("done"), "reopen", "not_allowed");
    failsWith(ai("not_started"), "wait_third_party", "not_allowed"); // an AI step never waits for a third party
    failsWith(user("not_started"), "wait_third_party", "not_allowed");
    failsWith(third("not_started"), "launch", "not_allowed", { readiness: "ready" });
    failsWith(user("not_started"), "submit_proof", "not_allowed", { payload: { text: "x" } });
  });

  test("not_allowed: an action that needs a status or an executor it does not have", () => {
    failsWith(user("waiting_third_party"), "launch", "not_allowed", { readiness: "ready" });
    failsWith(user("running"), "attach_output", "not_allowed", { actor: "user", payload: attach });
    failsWith(ai("waiting_user"), "attach_output", "not_allowed", { actor: "ai", payload: attach });
    failsWith(user("running"), "answer", "not_allowed", { payload: { answers: [] } });
    failsWith(ai("waiting_user", { outputs: [out(1, "rejected")] }), "answer", "not_allowed", { payload: { answers: ["a", "b"] } });
    failsWith(ai("waiting_user"), "answer", "not_allowed", { payload: { answers: [] } });
    failsWith(user("running"), "confirm_output", "not_allowed");
    failsWith(ai("waiting_user", { outputs: [out(1, "rejected")] }), "reject_output", "not_allowed");
    failsWith(ai("running", { outputs: [out(1, "draft")] }), "reject_output", "not_allowed");
    failsWith(user("not_started"), "third_party_responded", "not_allowed");
    failsWith(third("waiting_third_party"), "third_party_responded", "not_allowed");
    failsWith(ai("running"), "submit_proof", "not_allowed", { payload: { text: "x" } });
  });

  test("wrong_actor: an AI or the system cannot deliver an output to a step that is not an AI step", () => {
    for (const step of [user("running"), third("waiting_third_party"), user("running", { outputs: [out(1, "rejected")] })]) {
      for (const actor of ["ai", "system"] as const) failsWith(step, "attach_output", "wrong_actor", { actor, payload: attach });
      failsWith(step, "attach_output", "not_allowed", { actor: "user", payload: attach });
    }
  });

  test("not_ready: launch needs the step to be ready", () => {
    failsWith(user("not_started"), "launch", "not_ready", { readiness: "blocked" });
    failsWith(user("not_started"), "launch", "not_ready", { readiness: "not_applicable" });
    failsWith(ai("not_started"), "launch", "not_ready", { readiness: "blocked" });
  });

  test("not_ready is only about launch", () => {
    assert.equal(succeeds(user("running"), "submit_proof", { readiness: "blocked", payload: { text: "x" } }).step.status, "done");
  });

  test("wrong_actor: the AI and the system can only attach an output", () => {
    const steps: Record<string, Step> = {
      launch: user("not_started"),
      answer: ai("waiting_user", { outputs: [out(1, "draft")] }),
      confirm_output: ai("waiting_user", { outputs: [out(1, "draft")] }),
      reject_output: ai("waiting_user", { outputs: [out(1, "draft")] }),
      submit_proof: user("running"),
      wait_third_party: user("running"),
      third_party_responded: user("waiting_third_party"),
      reopen: user("rejected"),
      change_executor: user("not_started"),
    };
    for (const actor of ["ai", "system"] as const) {
      for (const [action, step] of Object.entries(steps)) {
        failsWith(step, action as StepAction, "wrong_actor", { actor, readiness: "ready", payload: { answers: ["a", "b"], text: "x" } });
      }
    }
    for (const actor of ["ai", "system", "user"] as const) {
      assert.ok(run(ai("running"), "attach_output", { actor, payload: attach }).ok, actor);
    }
  });

  test("wrong_actor comes before any other check", () => {
    failsWith(user("done"), "launch", "wrong_actor", { actor: "ai", readiness: "blocked", payload: 42 });
  });

  test("rounds_exceeded: no more rounds once MAX_ROUNDS versions exist", () => {
    const versions = (count: number) =>
      Array.from({ length: count }, (_, i) => out(i + 1, i === count - 1 ? "draft" : "superseded"));
    failsWith(ai("waiting_user", { outputs: versions(MAX_ROUNDS), events: attempt(MAX_ROUNDS) }), "answer", "rounds_exceeded", { payload: { answers: ["a", "b"] } });
    failsWith(ai("waiting_user", { outputs: versions(MAX_ROUNDS + 1), events: attempt(MAX_ROUNDS + 1) }), "answer", "rounds_exceeded", { payload: { answers: ["a", "b"] } });
  });

  test("the failure chain: MAX_ROUNDS rejected rounds, reopen, and the step can be launched again", () => {
    let step = ai("not_started");
    const feed = { readiness: "ready" } as const;
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      step = succeeds(step, round === 1 ? "launch" : "answer", { ...feed, payload: round === 1 ? undefined : { answers: ["a", "b"] } }).step;
      step = succeeds(step, "attach_output", { actor: "ai", payload: { summary: `S${round}`, questions: ["Q1", "Q2"] } }).step;
    }
    failsWith(step, "answer", "rounds_exceeded", { payload: { answers: ["a", "b"] } });
    step = succeeds(succeeds(step, "reject_output").step, "reopen").step;
    assert.equal(step.outputs?.length, MAX_ROUNDS);
    step = succeeds(step, "launch", feed).step;
    step = succeeds(step, "attach_output", { actor: "ai", payload: { summary: "Again", questions: ["Q1", "Q2"] } }).step;
    // Versions keep counting over the whole life of the step; the rounds start again
    assert.deepEqual(step.outputs?.map((output) => output.version), Array.from({ length: MAX_ROUNDS + 1 }, (_, i) => i + 1));
    assert.deepEqual(stepProblems(step), []);
    // ...and the limit applies again inside the new attempt
    for (let round = 2; round <= MAX_ROUNDS; round += 1) {
      step = succeeds(step, "answer", { payload: { answers: ["a", "b"] } }).step;
      step = succeeds(step, "attach_output", { actor: "ai", payload: { summary: `T${round}`, questions: ["Q1", "Q2"] } }).step;
    }
    failsWith(step, "answer", "rounds_exceeded", { payload: { answers: ["a", "b"] } });
    assert.equal(succeeds(step, "confirm_output").step.status, "done");
  });

  test("a step whose attempt used all its rounds can be reopened, change executor and come back to AI to be launched", () => {
    let step = succeeds(succeeds(ai("waiting_user", { outputs: [out(1, "draft")], events: attempt(MAX_ROUNDS) }), "reject_output").step, "reopen").step;
    step = succeeds(step, "change_executor", { payload: { executor: "user", mode: "online" } }).step;
    step = succeeds(step, "change_executor", { payload: { executor: "ai" } }).step;
    assert.equal(succeeds(step, "launch", { readiness: "ready" }).step.status, "running");
  });

  test("rounds_exceeded does not stop the person from confirming or rejecting the last draft", () => {
    const step = ai("waiting_user", { outputs: Array.from({ length: MAX_ROUNDS }, (_, i) => out(i + 1, i === MAX_ROUNDS - 1 ? "draft" : "superseded")) });
    assert.equal(succeeds(step, "confirm_output").step.status, "done");
    assert.equal(succeeds(step, "reject_output").step.status, "rejected");
  });

  test("missing_proof: written confirmation and receipt need a proof to be done", () => {
    for (const kind of ["written_confirmation", "receipt"]) {
      const evidence = { kind };
      failsWith(ai("waiting_user", { evidence, outputs: [out(1, "draft")] }), "confirm_output", "missing_proof");
      assert.equal(
        succeeds(ai("waiting_user", { evidence, outputs: [out(1, "draft")], proof: proofOf }), "confirm_output").step.status,
        "done",
        kind,
      );
    }
  });

  test("output_not_confirmed: there is no draft output to confirm", () => {
    failsWith(ai("waiting_user"), "confirm_output", "output_not_confirmed");
    failsWith(ai("waiting_user", { outputs: [] }), "confirm_output", "output_not_confirmed");
    failsWith(ai("waiting_user", { outputs: [out(1, "rejected")] }), "confirm_output", "output_not_confirmed");
    failsWith(ai("waiting_user", { outputs: [out(1, "confirmed", { confirmedAt: T1 })] }), "confirm_output", "output_not_confirmed");
  });

  test("invalid_payload: what the action carries must have its shape", () => {
    const waiting = ai("waiting_user", { outputs: [out(1, "draft")] });
    const bad = (step: Step, action: StepAction, payload: unknown) => failsWith(step, action, "invalid_payload", { payload, readiness: "ready" });
    // attach_output
    for (const payload of [undefined, null, "text", {}, { summary: "S" }, { questions: [] }, { summary: " ", questions: [] }, { summary: "S", questions: "Q" }, { summary: "S", questions: [""] }, { summary: "S", questions: [1] }, { summary: "S", questions: [], extra: 1 }, { summary: "S", questions: [], documentRef: "Not An Id" }, { summary: "a".repeat(MAX_STEP_TEXT + 1), questions: [] }, { summary: "S", questions: Array(MAX_OUTPUT_QUESTIONS + 1).fill("Q") }]) {
      bad(ai("running"), "attach_output", payload);
    }
    // answer: one answer per question
    for (const payload of [undefined, {}, { answers: "a" }, { answers: ["a"] }, { answers: ["a", "b", "c"] }, { answers: ["a", " "] }, { answers: ["a", 2] }, { answers: ["a", "b"], extra: 1 }]) {
      bad(waiting, "answer", payload);
    }
    // submit_proof
    for (const payload of [undefined, {}, { text: "" }, { text: "  " }, { text: 5 }, { text: "x", at: NOW }, { text: "a".repeat(MAX_STEP_TEXT + 1) }]) {
      bad(user("running"), "submit_proof", payload);
    }
    // Actions with no payload take none
    for (const [step, action] of [
      [user("not_started"), "launch"],
      [waiting, "confirm_output"],
      [waiting, "reject_output"],
      [user("running"), "wait_third_party"],
      [user("waiting_third_party"), "third_party_responded"],
      [user("rejected"), "reopen"],
    ] as [Step, StepAction][]) {
      bad(step, action, { text: "x" });
      bad(step, action, {});
      bad(step, action, null);
    }
  });

  test("the limits of a payload are inclusive", () => {
    assert.ok(run(ai("running"), "attach_output", { actor: "ai", payload: { summary: "a".repeat(MAX_STEP_TEXT), questions: Array(MAX_OUTPUT_QUESTIONS).fill("Q") } }).ok);
    assert.ok(run(user("running"), "submit_proof", { payload: { text: "a".repeat(MAX_STEP_TEXT) } }).ok);
  });

  test("invalid_result: a result that breaks the schema is an error, not an exception", () => {
    // The clock went back: the event would come before the previous one
    failsWith(user("running"), "submit_proof", "invalid_result", { now: () => "2026-10-07T09:00:00Z", payload: { text: "x" } });
    // The clock does not give an ISO instant
    for (const now of ["yesterday", "", "2026-10-07"]) failsWith(user("not_started"), "launch", "invalid_result", { readiness: "ready", now: () => now });
    // The new output would not follow the versions already there
    failsWith(ai("running", { outputs: [out(2, "draft")] }), "attach_output", "invalid_result", { actor: "ai", payload: attach });
    failsWith(ai("running", { outputs: [out(1, "confirmed", { confirmedAt: T1 })] }), "attach_output", "invalid_result", { actor: "ai", payload: attach });
  });

  test("the same instant as the last event is fine", () => {
    assert.ok(run(user("running"), "submit_proof", { now: () => T1, payload: { text: "x" } }).ok);
  });
});

describe("what each action can do, for every executor and status", () => {
  // The table of transitions decides; the payloads and the draft are valid so only the rules are tested
  const payloads: Record<StepAction, unknown> = {
    launch: undefined,
    attach_output: attach,
    answer: { answers: ["a", "b"] },
    confirm_output: undefined,
    reject_output: undefined,
    submit_proof: { text: "x" },
    wait_third_party: undefined,
    third_party_responded: undefined,
    reopen: undefined,
    change_executor: undefined, // depends on the executor: see payloadOf
  };
  // Any executor can change to another one; the new one needs a mode only if it is "user"
  const payloadOf = (action: StepAction, executor: string) =>
    action === "change_executor" ? (executor === "ai" ? { executor: "user", mode: "online" } : { executor: "ai" }) : payloads[action];
  // An AI step has a draft only while it is running or waiting; before and after, its outputs are closed
  const sweepStep = (executor: string, status: string) =>
    make(executor, status, executor === "ai" ? { outputs: [out(1, status === "running" || status === "waiting_user" ? "draft" : "rejected")] } : {});
  const successes = (executor: string) =>
    STEP_STATUSES.flatMap((status) =>
      ACTIONS.filter((action) => {
        const step = sweepStep(executor, status);
        const actor = action === "attach_output" ? "ai" : "user";
        return run(step, action, { actor, readiness: "ready", payload: payloadOf(action, executor) }).ok;
      }).map((action) => `${status} ${action}`),
    );

  test("AI step", () => {
    assert.deepEqual(successes("ai"), [
      "not_started launch",
      "not_started change_executor",
      "running attach_output",
      "waiting_user answer",
      "waiting_user confirm_output",
      "waiting_user reject_output",
      "waiting_user submit_proof",
      "rejected reopen",
    ]);
  });

  test("user step", () => {
    assert.deepEqual(successes("user"), [
      "not_started launch",
      "not_started change_executor",
      "running reject_output",
      "running submit_proof",
      "running wait_third_party",
      "waiting_third_party reject_output",
      "waiting_third_party third_party_responded",
      "rejected reopen",
    ]);
  });

  test("third-party step", () => {
    assert.deepEqual(successes("third_party"), [
      "not_started wait_third_party",
      "not_started change_executor",
      "waiting_third_party reject_output",
      "waiting_third_party submit_proof",
      "rejected reopen",
    ]);
  });

  test("every successful change is in the table of transitions (an AI proof keeps its status)", () => {
    for (const executor of STEP_EXECUTORS) {
      for (const status of STEP_STATUSES) {
        for (const action of ACTIONS) {
          const step = sweepStep(executor, status);
          const result = run(step, action, { actor: action === "attach_output" ? "ai" : "user", readiness: "ready", payload: payloadOf(action, executor) });
          if (!result.ok || result.event.to === status) continue;
          assert.ok(TRANSITIONS[executor][status].includes(result.event.to), `${executor} ${status} ${action}`);
        }
      }
    }
  });
});

describe("change_executor", () => {
  const change = (payload: unknown, overrides: Partial<ActionContext> = {}) => ({ actor: "user" as const, payload, ...overrides });
  const make3 = (executor: string, overrides: Record<string, unknown> = {}) =>
    executor === "ai" ? ai("not_started", overrides) : executor === "user" ? user("not_started", overrides) : third("not_started", overrides);

  test("works between the three executors, in the six directions, and the status stays", () => {
    const combos: [string, string, Record<string, unknown>][] = [
      ["ai", "user", { executor: "user", mode: "in_person" }],
      ["ai", "third_party", { executor: "third_party" }],
      ["user", "ai", { executor: "ai" }],
      ["user", "third_party", { executor: "third_party" }],
      ["third_party", "ai", { executor: "ai" }],
      ["third_party", "user", { executor: "user", mode: "online" }],
    ];
    for (const [from, to, payload] of combos) {
      const step = make3(from);
      const result = succeeds(step, "change_executor", change(payload));
      const label = `${from} -> ${to}`;
      assert.equal(result.step.executor, to, label);
      assert.equal(result.step.status, "not_started", label);
      assert.equal(result.step.mode, to === "user" ? payload.mode : undefined, label);
      assert.equal("mode" in result.step, to === "user", label);
      assert.deepEqual(result.event, {
        at: NOW, actor: "user", action: "change_executor", from: "not_started", to: "not_started", executorFrom: from, executorTo: to,
      }, label);
      assert.deepEqual(result.step.events, [result.event], label);
      // Nothing else about the step changes
      const { executor: _a, mode: _b, events: _c, ...restBefore } = step;
      const { executor: _d, mode: _e, events: _f, ...restAfter } = result.step;
      assert.deepEqual(restAfter, restBefore, label);
      assert.deepEqual(stepProblems(result.step), [], label);
    }
  });

  test("the readiness of the step does not matter", () => {
    for (const readiness of ["ready", "blocked", "not_applicable"] as const) {
      assert.ok(run(user("not_started"), "change_executor", change({ executor: "ai" }, { readiness })).ok, readiness);
    }
  });

  test("the history records every change, in order, and the executors chain", () => {
    const first = succeeds(ai("not_started"), "change_executor", change({ executor: "user", mode: "online" }, { now: () => "2026-10-07T12:00:00Z" }));
    const second = succeeds(first.step, "change_executor", change({ executor: "third_party" }, { now: () => "2026-10-07T13:00:00Z" }));
    assert.deepEqual(
      second.step.events.map((e) => [e.at, e.action, e.executorFrom, e.executorTo]),
      [["2026-10-07T12:00:00Z", "change_executor", "ai", "user"], ["2026-10-07T13:00:00Z", "change_executor", "user", "third_party"]],
    );
    assert.equal(second.step.executor, "third_party");
    assert.deepEqual(stepProblems(second.step), []);
  });

  test("other events carry no executors", () => {
    const changed = succeeds(third("not_started"), "change_executor", change({ executor: "user", mode: "online" })).step;
    const launched = succeeds(changed, "launch", { readiness: "ready", now: () => "2026-10-07T13:00:00Z" });
    assert.equal(launched.step.status, "running");
    assert.equal("executorFrom" in launched.event, false);
    assert.equal("executorTo" in launched.event, false);
  });

  test("after the change the step follows the rules of its new executor", () => {
    // A third-party step turned into a user one can run and be closed by its owner
    let step = succeeds(third("not_started"), "change_executor", change({ executor: "user", mode: "online" })).step;
    step = succeeds(step, "launch", { readiness: "ready", now: () => "2026-10-07T13:00:00Z" }).step;
    assert.equal(succeeds(step, "submit_proof", { payload: { text: "x" }, now: () => "2026-10-07T14:00:00Z" }).step.status, "done");
    // An AI step turned into a third-party one waits for the third party instead of running
    const other = succeeds(ai("not_started"), "change_executor", change({ executor: "third_party" })).step;
    failsWith(other, "launch", "not_allowed", { readiness: "ready", now: () => "2026-10-07T13:00:00Z" });
    assert.equal(succeeds(other, "wait_third_party", { now: () => "2026-10-07T13:00:00Z" }).step.status, "waiting_third_party");
  });

  test("the mode of a user step is dropped when the executor stops being user", () => {
    for (const to of ["ai", "third_party"]) {
      const result = succeeds(user("not_started", { mode: "in_person" }), "change_executor", change({ executor: to }));
      assert.equal(result.step.mode, undefined, to);
      assert.equal("mode" in result.step, false, to);
    }
  });

  test("evidence: it can be replaced when it still fits", () => {
    const result = succeeds(user("not_started"), "change_executor", change({ executor: "third_party", evidence: { kind: "receipt" } }));
    assert.deepEqual(result.step.evidence, { kind: "receipt" });
    const keep = succeeds(user("not_started", { evidence: { kind: "written_confirmation" } }), "change_executor", change({ executor: "ai" }));
    assert.deepEqual(keep.step.evidence, { kind: "written_confirmation" });
    assert.deepEqual(succeeds(user("not_started"), "change_executor", change({ executor: "ai", evidence: { kind: "accepted_output" } })).step.evidence, { kind: "accepted_output" });
  });

  test("evidence: accepted_output must be replaced when the new executor is not an AI", () => {
    const step = ai("not_started", { evidence: { kind: "accepted_output" } });
    for (const to of [{ executor: "third_party" }, { executor: "user", mode: "online" }]) {
      failsWith(step, "change_executor", "invalid_executor_change", change(to));
      failsWith(step, "change_executor", "invalid_executor_change", change({ ...to, evidence: { kind: "accepted_output" } }));
      const fixed = succeeds(step, "change_executor", change({ ...to, evidence: { kind: "none" } }));
      assert.deepEqual(fixed.step.evidence, { kind: "none" });
    }
  });

  test("the outputs stay as a read-only history, and the proof too", () => {
    const outputs = [out(1, "superseded"), out(2, "rejected")];
    const step = ai("not_started", { outputs, proof: proofOf });
    const asUser = succeeds(step, "change_executor", change({ executor: "user", mode: "online" }));
    assert.deepEqual(asUser.step.outputs, outputs);
    assert.deepEqual(asUser.step.proof, proofOf);
    assert.deepEqual(stepProblems(asUser.step), []);
    // And they come back as they were when the step goes back to AI
    const back = succeeds(asUser.step, "change_executor", change({ executor: "ai" }, { now: () => "2026-10-07T13:00:00Z" }));
    assert.deepEqual(back.step.outputs, outputs);
  });

  test("a step with old outputs cannot get new ones unless it is an AI step", () => {
    const changed = succeeds(ai("not_started", { outputs: [out(1, "rejected")] }), "change_executor", change({ executor: "user", mode: "online" })).step;
    const running = succeeds(changed, "launch", { readiness: "ready", now: () => "2026-10-07T13:00:00Z" }).step;
    const at = { now: () => "2026-10-07T14:00:00Z", payload: attach };
    for (const actor of ["ai", "system"] as const) failsWith(running, "attach_output", "wrong_actor", { ...at, actor });
    failsWith(running, "attach_output", "not_allowed", { ...at, actor: "user" });
    // Nor can the old ones be confirmed or answered
    failsWith(running, "confirm_output", "not_allowed");
    failsWith(running, "answer", "not_allowed", { payload: { answers: [] } });
  });

  test("not_allowed: only before the step starts", () => {
    for (const executor of ["ai", "user", "third_party"]) {
      for (const status of STEP_STATUSES.filter((s) => s !== "not_started")) {
        const target = executor === "ai" ? { executor: "third_party" } : { executor: "ai" };
        failsWith(make(executor, status), "change_executor", "not_allowed", change(target));
      }
    }
  });

  test("wrong_actor: the AI and the system cannot change it, whatever else is true", () => {
    for (const actor of ["ai", "system"] as const) {
      failsWith(user("not_started"), "change_executor", "wrong_actor", { actor, payload: { executor: "ai" } });
      failsWith(user("running"), "change_executor", "wrong_actor", { actor, payload: "nonsense", feedsOthers: true });
    }
  });

  test("invalid_payload: the shape of what it carries", () => {
    const bad = (payload: unknown) => failsWith(user("not_started"), "change_executor", "invalid_payload", change(payload));
    for (const payload of [
      undefined, null, "ai", {}, { mode: "online" }, { executor: "robot" }, { executor: 5 }, { executor: "ai", mode: "phone" },
      { executor: "ai", extra: 1 }, { executor: "ai", evidence: { kind: "photo" } }, { executor: "ai", evidence: {} },
      { executor: "ai", evidence: { kind: "none", extra: 1 } }, { executor: "ai", evidence: "none" },
    ]) bad(payload);
  });

  test("invalid_executor_change: it must be a real change that makes sense", () => {
    const bad = (step: Step, payload: unknown) => failsWith(step, "change_executor", "invalid_executor_change", change(payload));
    // The same executor is not a change
    bad(ai("not_started"), { executor: "ai" });
    bad(user("not_started"), { executor: "user", mode: "online" });
    bad(third("not_started"), { executor: "third_party" });
    // A user step needs its mode
    bad(ai("not_started"), { executor: "user" });
    bad(third("not_started"), { executor: "user" });
    // Only a user step has one
    bad(user("not_started"), { executor: "ai", mode: "online" });
    bad(ai("not_started"), { executor: "third_party", mode: "in_person" });
  });

  test("executor_in_use: a step that feeds another must stay an AI step", () => {
    const feeding = { feedsOthers: true };
    failsWith(ai("not_started"), "change_executor", "executor_in_use", change({ executor: "user", mode: "online" }, feeding));
    failsWith(ai("not_started"), "change_executor", "executor_in_use", change({ executor: "third_party" }, feeding));
    // Without the relation the same change works
    assert.ok(run(ai("not_started"), "change_executor", change({ executor: "third_party" }, { feedsOthers: false })).ok);
    // Changing to AI is never blocked by it
    assert.ok(run(user("not_started"), "change_executor", change({ executor: "ai" }, feeding)).ok);
  });

  test("a request that makes no sense is refused as such before looking at the relations", () => {
    const feeding = { feedsOthers: true };
    failsWith(ai("not_started"), "change_executor", "invalid_executor_change", change({ executor: "ai" }, feeding));
    failsWith(ai("not_started"), "change_executor", "invalid_executor_change", change({ executor: "user" }, feeding));
    failsWith(ai("not_started", { evidence: { kind: "accepted_output" } }), "change_executor", "invalid_executor_change", change({ executor: "third_party" }, feeding));
  });

  test("invalid_result: a clock that goes back is an error, not an exception", () => {
    const step = user("not_started", { events: [{ at: T1, actor: "user", action: "reopen", from: "not_started", to: "not_started" }] });
    failsWith(step, "change_executor", "invalid_result", change({ executor: "ai" }, { now: () => "2026-10-07T09:00:00Z" }));
  });
});
