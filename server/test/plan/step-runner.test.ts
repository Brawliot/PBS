import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROUNDS, MAX_OUTPUT_QUESTIONS, MAX_STEP_TEXT, type Plan, type Step } from "../../plan/plan-model.js";
import {
  MAX_DOCUMENT_TEXT,
  MAX_QUESTIONS_PER_ROUND,
  MAX_QUESTION_LENGTH,
  RunnerOutputSchema,
  buildRunnerInput,
  runStep,
  type StepRunner,
} from "../../plan/step-runner.js";
import { applyStepAction } from "../../plan/step-actions.js";
import { stepProblems } from "../../plan/step-rules.js";
import { FakeStepRunner } from "./fake-step-runner.js";
import { prng } from "./prng.js";

const T1 = "2026-10-07T10:00:00Z";
const T2 = "2026-10-07T11:00:00Z";
const step = (id: string, overrides: Record<string, unknown> = {}): Step =>
  ({
    id,
    taskId: "t1",
    departmentId: "legal",
    text: `Text of ${id}`,
    executor: "ai",
    evidence: { kind: "none" },
    effortHours: 1,
    waitDays: 0,
    status: "not_started",
    events: [],
    origin: { kind: "rule" },
    confidence: 100,
    ...overrides,
  }) as Step;
const out = (version: number, state: string, overrides: Record<string, unknown> = {}) => ({
  version,
  state,
  summary: `Summary v${version} ${state}`,
  questions: [],
  createdAt: T1,
  ...(state === "confirmed" && { confirmedAt: T2 }),
  ...overrides,
});
/** Events of an attempt with n rounds: a launch, then attach_output, and for each more round an answer and attach_output */
const attempt = (rounds: number) =>
  Array.from({ length: rounds }, (_, i) => [
    i === 0
      ? { at: T1, actor: "user", action: "launch", from: "not_started", to: "running" }
      : { at: T1, actor: "user", action: "answer", from: "waiting_user", to: "running" },
    { at: T1, actor: "ai", action: "attach_output", from: "running", to: "waiting_user" },
  ]).flat();
const feeds = (from: string, to: string) => ({ level: "step", type: "feeds", from, to }) as Plan["relations"][number];
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe("limits of the runner output", () => {
  test("fit what a step can store, so any valid output can be attached", () => {
    assert.ok(MAX_QUESTIONS_PER_ROUND <= MAX_OUTPUT_QUESTIONS);
    assert.ok(MAX_QUESTION_LENGTH <= MAX_STEP_TEXT);
  });
});

describe("RunnerOutputSchema", () => {
  const valid = { summary: "A summary", document: "The document", questions: ["Which city?"] };
  const bad = (value: unknown) => assert.equal(RunnerOutputSchema.safeParse(value).success, false, String(JSON.stringify(value)).slice(0, 80));
  const good = (value: unknown) => assert.equal(RunnerOutputSchema.safeParse(value).success, true, String(JSON.stringify(value)).slice(0, 80));

  test("accepts a complete output and keeps it as given", () => {
    assert.deepEqual(RunnerOutputSchema.parse(valid), valid);
    good({ ...valid, questions: [] });
  });

  test("summary is required, trimmed and bounded by MAX_STEP_TEXT", () => {
    good({ ...valid, summary: "a".repeat(MAX_STEP_TEXT) });
    bad({ ...valid, summary: "a".repeat(MAX_STEP_TEXT + 1) });
    bad({ ...valid, summary: "  " });
    bad({ ...valid, summary: undefined });
    assert.equal(RunnerOutputSchema.parse({ ...valid, summary: "  S  " }).summary, "S");
  });

  test("document is required, trimmed and bounded by MAX_DOCUMENT_TEXT", () => {
    good({ ...valid, document: "a".repeat(MAX_DOCUMENT_TEXT) });
    bad({ ...valid, document: "a".repeat(MAX_DOCUMENT_TEXT + 1) });
    bad({ ...valid, document: "" });
    bad({ ...valid, document: undefined });
  });

  test("questions go from 0 to MAX_QUESTIONS_PER_ROUND", () => {
    good({ ...valid, questions: [] });
    good({ ...valid, questions: Array(MAX_QUESTIONS_PER_ROUND).fill("Q") });
    bad({ ...valid, questions: Array(MAX_QUESTIONS_PER_ROUND + 1).fill("Q") });
    bad({ ...valid, questions: undefined });
    bad({ ...valid, questions: "Q" });
  });

  test("each question is non-empty text of at most MAX_QUESTION_LENGTH", () => {
    good({ ...valid, questions: ["a".repeat(MAX_QUESTION_LENGTH)] });
    bad({ ...valid, questions: ["a".repeat(MAX_QUESTION_LENGTH + 1)] });
    bad({ ...valid, questions: [" "] });
    bad({ ...valid, questions: [1] });
    bad({ ...valid, questions: [{ question: "Q" }] });
  });

  test("unknown keys and anything that is not an object are rejected", () => {
    bad({ ...valid, documentRef: "doc1" });
    for (const value of [null, undefined, "text", 5, [], [valid]]) bad(value);
  });
});

describe("buildRunnerInput", () => {
  test("only an AI step has an input", () => {
    for (const executor of ["user", "third_party"]) {
      assert.equal(buildRunnerInput(step("a", { executor }), [], []), undefined, executor);
    }
  });

  test("the step data, round one and nothing else when there is nothing yet", () => {
    const a = step("a");
    assert.deepEqual(buildRunnerInput(a, [a], []), {
      step: { id: "a", text: "Text of a", taskId: "t1", departmentId: "legal" },
      round: 1,
      answers: [],
      feeds: [],
    });
  });

  test("the round is the rounds used in the current attempt plus one", () => {
    for (let versions = 0; versions < MAX_ROUNDS; versions += 1) {
      const outputs = Array.from({ length: versions }, (_, i) => out(i + 1, "superseded"));
      const a = step("a", { outputs, events: attempt(versions) });
      assert.equal(buildRunnerInput(a, [a], [])?.round, versions + 1, String(versions));
    }
  });

  test("after a reopen the round starts again at 1, versions go on, and the answers of every attempt are kept (assumption)", () => {
    const answered = (version: number) => out(version, "rejected", { questions: [{ question: `Q${version}`, answer: `A${version}`, answeredAt: T1 }] });
    const outputs = Array.from({ length: MAX_ROUNDS }, (_, i) => answered(i + 1));
    const reopened = step("a", {
      outputs,
      events: [
        ...attempt(MAX_ROUNDS),
        { at: T1, actor: "user", action: "reject_output", from: "waiting_user", to: "rejected" },
        { at: T1, actor: "user", action: "reopen", from: "rejected", to: "not_started" },
      ],
    });
    const input = buildRunnerInput(reopened, [reopened], [])!;
    assert.equal(input.round, 1);
    assert.deepEqual(input.answers.map((a) => a.version), outputs.map((o) => o.version));
    const second = step("a", { outputs: [...outputs, out(MAX_ROUNDS + 1, "draft")], events: [...reopened.events, ...attempt(1)] });
    assert.equal(buildRunnerInput(second, [second], [])!.round, 2);
  });

  test("the answers already given, from every version and in order; unanswered questions are left out", () => {
    const a = step("a", {
      outputs: [
        out(1, "superseded", { questions: [{ question: "Q1", answer: "A1", answeredAt: T1 }, { question: "Q2" }] }),
        out(2, "draft", { questions: [{ question: "Q3", answer: "A3", answeredAt: T2 }, { question: "Q4" }] }),
      ],
    });
    assert.deepEqual(buildRunnerInput(a, [a], [])?.answers, [
      { version: 1, question: "Q1", answer: "A1" },
      { version: 2, question: "Q3", answer: "A3" },
    ]);
  });

  test("the confirmed output of a feeder is included with where it comes from", () => {
    const f = step("f", { status: "done", outputs: [out(1, "confirmed", { documentRef: "doc1" })] });
    const a = step("a");
    assert.deepEqual(buildRunnerInput(a, [a, f], [feeds("f", "a")])?.feeds, [
      { stepId: "f", stepText: "Text of f", version: 1, summary: "Summary v1 confirmed", documentRef: "doc1" },
    ]);
    const plain = step("g", { outputs: [out(1, "confirmed")] });
    assert.deepEqual(buildRunnerInput(a, [a, plain], [feeds("g", "a")])?.feeds, [
      { stepId: "g", stepText: "Text of g", version: 1, summary: "Summary v1 confirmed" },
    ]);
  });

  test("a feeder with a draft, a rejected output, a replaced one or none gives nothing", () => {
    const a = step("a");
    const cases: Record<string, unknown[] | undefined> = {
      draft: [out(1, "draft")],
      rejected: [out(1, "rejected")],
      replaced: [out(1, "confirmed"), out(2, "draft")],
      "confirmed then superseded": [out(1, "superseded"), out(2, "rejected")],
      empty: [],
      none: undefined,
    };
    for (const [name, outputs] of Object.entries(cases)) {
      const f = step("f", { outputs });
      assert.deepEqual(buildRunnerInput(a, [a, f], [feeds("f", "a")])?.feeds, [], name);
    }
  });

  test("only the confirmed current version of a feeder with several versions", () => {
    const f = step("f", { outputs: [out(1, "superseded"), out(2, "superseded"), out(3, "confirmed")] });
    const a = step("a");
    const input = buildRunnerInput(a, [a, f], [feeds("f", "a")])!;
    assert.deepEqual(input.feeds.map((x) => [x.version, x.summary]), [[3, "Summary v3 confirmed"]]);
    assert.ok(!JSON.stringify(input).includes("v1"));
    assert.ok(!JSON.stringify(input).includes("v2"));
  });

  test("only steps that feed this one: not blockers, predecessors, dependents or other levels", () => {
    const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map((id) => step(id, { outputs: [out(1, "confirmed")] }));
    const relations = [
      { level: "step", type: "blocks", from: "b", to: "a" },
      { level: "step", type: "follows", from: "a", to: "c" },
      { level: "step", type: "feeds", from: "a", to: "d" },
      { level: "task", type: "blocks", from: "e", to: "a" },
      { level: "step", type: "feeds", from: "e", to: "d" },
    ] as Plan["relations"];
    assert.deepEqual(buildRunnerInput(a, [a, b, c, d, e], relations)?.feeds, []);
    assert.deepEqual(buildRunnerInput(d, [a, b, c, d, e], relations)?.feeds.map((x) => x.stepId), ["a", "e"]);
  });

  test("the step's own outputs are not shown, only the answers", () => {
    const a = step("a", { outputs: [out(1, "confirmed", { summary: "OWN-SUMMARY", documentRef: "own-doc" })] });
    const json = JSON.stringify(buildRunnerInput(a, [a], []));
    assert.ok(!json.includes("OWN-SUMMARY"));
    assert.ok(!json.includes("own-doc"));
  });

  test("it does not change the steps and shares nothing with them", () => {
    const f = step("f", { outputs: [out(1, "confirmed", { documentRef: "doc1" })] });
    const a = step("a", { outputs: [out(1, "draft", { questions: [{ question: "Q", answer: "A", answeredAt: T1 }] })] });
    const before = structuredClone([a, f]);
    deepFreeze([a, f]);
    const input = buildRunnerInput(a, [a, f], [feeds("f", "a")])!;
    assert.deepEqual([a, f], before);
    // The input is plain data: changing it cannot reach the plan
    assert.notEqual(input.answers, a.outputs![0].questions);
    assert.notEqual(input.feeds[0], f.outputs![0]);
  });

  test("never includes an output that is not confirmed: random plans, fixed seed", () => {
    const random = prng(20261007);
    const STATES = ["draft", "confirmed", "rejected", "superseded"];
    for (let round = 0; round < 300; round += 1) {
      const count = 2 + random.int(7);
      const marker = (i: number, v: number, field: string) => `<${field}-${String(i).padStart(2, "0")}-v${v}>`;
      const steps = Array.from({ length: count }, (_, i) => {
        if (random.chance(0.15)) return step(`s${i}`, { executor: random.pick(["user", "third_party"]) });
        const versions = random.int(MAX_ROUNDS + 1);
        const outputs = Array.from({ length: versions }, (_, v) => {
          const last = v === versions - 1;
          const state = last ? random.pick(STATES) : random.pick(["superseded", "rejected"]);
          return out(v + 1, state, {
            summary: marker(i, v + 1, `${state}-S`),
            documentRef: `d${i}v${v + 1}`,
            questions: [{ question: marker(i, v + 1, "Q"), answer: marker(i, v + 1, "A"), answeredAt: T1 }],
          });
        });
        return step(`s${i}`, { outputs });
      });
      const relations = Array.from({ length: random.int(count * 2) }, () =>
        ({ level: "step", type: random.pick(["feeds", "blocks", "follows"]), from: `s${random.int(count)}`, to: `s${random.int(count)}` }) as Plan["relations"][number],
      ).filter((r) => r.from !== r.to);

      const target = steps.findIndex((s) => s.executor === "ai");
      if (target < 0) continue;
      const input = buildRunnerInput(steps[target], steps, relations)!;
      const json = JSON.stringify(input);

      // Every summary in the input is the confirmed current output of a step that feeds the target
      const fedBy = new Set(relations.filter((r) => r.type === "feeds" && r.to === `s${target}`).map((r) => r.from));
      const expected = steps.flatMap((s, i) => {
        const last = s.outputs?.at(-1);
        return fedBy.has(s.id) && s.executor === "ai" && last?.state === "confirmed" ? [last.summary] : [];
      });
      assert.deepEqual(input.feeds.map((f) => f.summary).sort(), [...expected].sort(), `round ${round}`);

      // And no summary of any other output, of any step, appears anywhere
      for (const s of steps) {
        for (const o of s.outputs ?? []) {
          if (expected.includes(o.summary)) continue;
          assert.ok(!json.includes(o.summary), `round ${round}: ${o.summary} leaked`);
          if (o.documentRef && !input.feeds.some((f) => f.documentRef === o.documentRef)) {
            assert.ok(!json.includes(`"${o.documentRef}"`), `round ${round}: ${o.documentRef} leaked`);
          }
        }
      }
    }
  });
});

describe("runStep", () => {
  const input = buildRunnerInput(step("a"), [step("a")], [])!;

  test("accepts a valid output and gives it trimmed", async () => {
    const runner = new FakeStepRunner({ script: () => ({ summary: " S ", document: " D ", questions: [" Q "] }) });
    assert.deepEqual(await runStep(runner, input), { ok: true, output: { summary: "S", document: "D", questions: ["Q"] } });
  });

  test("rejects an output that does not fit the schema, with a code and nothing else", async () => {
    const secret = "SECRET-TEXT-FROM-THE-MODEL";
    const outputs: unknown[] = [
      undefined,
      null,
      "text",
      {},
      { summary: secret, document: "D" },
      { summary: secret, document: "D", questions: Array(MAX_QUESTIONS_PER_ROUND + 1).fill(secret) },
      { summary: secret, document: "D", questions: [secret.repeat(100)] },
      { summary: secret, document: "D", questions: [], extra: secret },
    ];
    for (const raw of outputs) {
      const result = await runStep(new FakeStepRunner({ script: () => raw }), input);
      assert.deepEqual(result, { ok: false, code: "invalid_output" });
      assert.ok(!JSON.stringify(result).includes(secret));
    }
  });

  test("a runner that fails, in any way, gives runner_failed without its message", async () => {
    const secret = "SECRET-ERROR-TEXT";
    const throwing = new FakeStepRunner({ script: () => { throw new Error(secret); } });
    const rejecting: StepRunner = { run: () => Promise.reject(new Error(secret)) };
    const rejectingString: StepRunner = { run: () => Promise.reject(secret) };
    for (const runner of [throwing, rejecting, rejectingString]) {
      const result = await runStep(runner, input);
      assert.deepEqual(result, { ok: false, code: "runner_failed" });
      assert.ok(!JSON.stringify(result).includes(secret));
    }
  });
});

describe("FakeStepRunner", () => {
  test("is deterministic: the same input gives the same output, and the calls are kept", async () => {
    const f = step("f", { outputs: [out(1, "confirmed")] });
    const a = step("a", { events: attempt(1), outputs: [out(1, "draft", { questions: [{ question: "Q", answer: "A", answeredAt: T1 }] })] });
    const runnerInput = buildRunnerInput(a, [a, f], [feeds("f", "a")])!;
    const runner = new FakeStepRunner({ questionsByRound: [["First?"], ["Second?", "Third?"]] });
    const first = await runner.run(runnerInput);
    assert.deepEqual(await runner.run(runnerInput), first);
    assert.deepEqual(first, {
      summary: "Round 2: Text of a",
      document: "Text of a\nQ -> A\nText of f: Summary v1 confirmed",
      questions: ["Second?", "Third?"],
    });
    assert.equal(runner.calls.length, 2);
    assert.deepEqual(runner.calls[0], runnerInput);
  });

  test("asks nothing on a round it has no questions for", async () => {
    const a = step("a");
    assert.deepEqual((await new FakeStepRunner().run(buildRunnerInput(a, [a], [])!)).questions, []);
  });
});

describe("the whole loop with a fake runner", () => {
  test("launch, draft with questions, answers, refined draft, confirmation", async () => {
    const runner = new FakeStepRunner({ questionsByRound: [["Which city?", "Open on Sundays?"], []] });
    let current = step("a", { evidence: { kind: "accepted_output" } });
    const steps = () => [current];
    let clock = 0;
    const now = () => `2026-10-07T${String(12 + clock++).padStart(2, "0")}:00:00Z`;
    const apply = (action: Parameters<typeof applyStepAction>[1], actor: "user" | "ai", payload?: unknown, readiness: "ready" | "not_applicable" = "not_applicable") => {
      const result = applyStepAction(current, action, { now, actor, readiness, feedsOthers: false, payload });
      assert.ok(result.ok, `${action}: ${JSON.stringify(result)}`);
      assert.deepEqual(stepProblems(result.step), [], action);
      current = result.step;
    };
    const deliver = async () => {
      const result = await runStep(runner, buildRunnerInput(current, steps(), [])!);
      assert.ok(result.ok);
      apply("attach_output", "ai", { summary: result.output.summary, questions: result.output.questions });
    };

    apply("launch", "user", undefined, "ready");
    await deliver();
    assert.equal(current.status, "waiting_user");
    assert.deepEqual(current.outputs?.[0].questions.map((q) => q.question), ["Which city?", "Open on Sundays?"]);

    apply("answer", "user", { answers: ["Madrid", "Yes"] });
    await deliver();
    // The second run saw the answers, and the first draft was replaced
    assert.deepEqual(runner.calls[1].answers.map((a) => a.answer), ["Madrid", "Yes"]);
    assert.equal(runner.calls[1].round, 2);
    assert.deepEqual(current.outputs?.map((o) => [o.version, o.state]), [[1, "superseded"], [2, "draft"]]);

    apply("confirm_output", "user");
    assert.equal(current.status, "done");
    assert.equal(current.outputs?.[1].state, "confirmed");
  });

  test("the largest valid runner output can always be attached", async () => {
    const big = { summary: "s".repeat(MAX_STEP_TEXT), document: "d".repeat(MAX_DOCUMENT_TEXT), questions: Array(MAX_QUESTIONS_PER_ROUND).fill("q".repeat(MAX_QUESTION_LENGTH)) };
    const result = await runStep(new FakeStepRunner({ script: () => big }), buildRunnerInput(step("a"), [step("a")], [])!);
    assert.ok(result.ok);
    const running = step("a", { status: "running", events: [{ at: T1, actor: "user", action: "launch", from: "not_started", to: "running" }] });
    const attached = applyStepAction(running, "attach_output", { now: () => T2, actor: "ai", readiness: "not_applicable", feedsOthers: false, payload: { summary: result.output.summary, questions: result.output.questions } });
    assert.ok(attached.ok);
  });
});
