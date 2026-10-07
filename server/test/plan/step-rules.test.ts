import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ROUNDS, parsePlan, STEP_EXECUTORS, STEP_STATUSES, type Plan, type Step, type StepStatus } from "../../plan/plan-model.js";
import {
  TRANSITIONS,
  canTransition,
  feedsFromNonAi,
  findStepCycle,
  readableOutput,
  STEP_PROBLEMS,
  stepProblems,
  cycleIn,
  orderEdges,
  type StepContext,
} from "../../plan/step-rules.js";

const origin = { kind: "rule" } as const;
const T1 = "2026-10-07T10:00:00Z";
const T2 = "2026-10-07T11:00:00Z";
const step = (overrides: Record<string, unknown> = {}): Step => ({
  id: "s1",
  taskId: "t1",
  departmentId: "legal",
  text: "A step",
  executor: "user",
  mode: "online",
  evidence: { kind: "none" },
  effortHours: 1,
  waitDays: 0,
  status: "not_started",
  events: [],
  origin,
  confidence: 100,
  ...overrides,
}) as Step;
const aiStep = (overrides: Record<string, unknown> = {}) =>
  step({ executor: "ai", mode: undefined, ...overrides });
const thirdStep = (overrides: Record<string, unknown> = {}) =>
  step({ executor: "third_party", mode: undefined, ...overrides });
const output = (version: number, state: string, overrides: Record<string, unknown> = {}) => ({
  version,
  state,
  summary: "S",
  questions: [],
  createdAt: T1,
  ...overrides,
});
/** Events of an attempt with n rounds: a launch, then attach_output, and for each more round an answer and attach_output */
const attempt = (rounds: number) =>
  Array.from({ length: rounds }, (_, i) => [
    ...(i === 0
      ? [{ at: T1, actor: "user", action: "launch", from: "not_started", to: "running" }]
      : [{ at: T1, actor: "user", action: "answer", from: "waiting_user", to: "running" }]),
    { at: T1, actor: "ai", action: "attach_output", from: "running", to: "waiting_user" },
  ]).flat();
const ev2 = (action: string, from: string, to: string) => ({ at: T1, actor: "user", action, from, to });
const proof = { text: "Receipt no. 42", at: T1, by: "user" };

const check = (from: StepStatus, to: StepStatus, s: Step, launchedByUser = true) =>
  canTransition(from, to, { step: s, launchedByUser } satisfies StepContext);
const ok = { allowed: true };
const refused = (reason: string) => ({ allowed: false, reason });

describe("transition table", () => {
  // Written out in full on purpose: it is the contract, so it is not derived from the code
  const expected: Record<string, Record<string, string[]>> = {
    ai: {
      not_started: ["running"],
      running: ["waiting_user"],
      waiting_user: ["running", "done", "rejected"],
      waiting_third_party: [],
      done: [],
      rejected: ["not_started"],
    },
    user: {
      not_started: ["running"],
      running: ["done", "waiting_third_party", "rejected"],
      waiting_user: [],
      waiting_third_party: ["running", "rejected"],
      done: [],
      rejected: ["not_started"],
    },
    third_party: {
      not_started: ["waiting_third_party"],
      running: [],
      waiting_user: [],
      waiting_third_party: ["done", "rejected"],
      done: [],
      rejected: ["not_started"],
    },
  };

  test("is exactly the agreed one, for every executor and status", () => {
    assert.deepEqual(TRANSITIONS, expected);
  });

  test("stored statuses are the six of the life cycle", () => {
    assert.deepEqual([...STEP_STATUSES], ["not_started", "running", "waiting_user", "waiting_third_party", "done", "rejected"]);
  });

  // The agreed list, one entry per allowed change and written by hand. It is not read from the
  // code: the 108 pairs (3 executors x 6 x 6) are checked against it, in both directions.
  const ALLOWED = new Set([
    "ai not_started->running",
    "ai running->waiting_user",
    "ai waiting_user->running",
    "ai waiting_user->done",
    "ai waiting_user->rejected",
    "ai rejected->not_started",
    "user not_started->running",
    "user running->done",
    "user running->waiting_third_party",
    "user running->rejected",
    "user waiting_third_party->running",
    "user waiting_third_party->rejected",
    "user rejected->not_started",
    "third_party not_started->waiting_third_party",
    "third_party waiting_third_party->done",
    "third_party waiting_third_party->rejected",
    "third_party rejected->not_started",
  ]);
  const EXECUTORS = ["ai", "user", "third_party"] as const;
  const STATUSES = ["not_started", "running", "waiting_user", "waiting_third_party", "done", "rejected"] as const;

  test("the list has the agreed size and the lists of the code have the same", () => {
    assert.equal(ALLOWED.size, 17);
    assert.equal(Object.values(TRANSITIONS).flatMap(Object.values).flat().length, 17);
  });

  test("all 108 pairs are allowed if and only if they are in the list", () => {
    // A step and context that satisfy every other rule, so only the table decides
    const free: Record<string, Step> = {
      ai: aiStep({ outputs: [output(1, "confirmed", { confirmedAt: T2 })] }),
      user: step({ proof }),
      third_party: thirdStep({ proof }),
    };
    let checked = 0;
    for (const executor of EXECUTORS) {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          const label = `${executor} ${from}->${to}`;
          const allowed = check(from, to, free[executor]);
          if (ALLOWED.has(label)) assert.deepEqual(allowed, ok, label);
          else assert.deepEqual(allowed, refused("not_allowed"), label);
          checked += 1;
        }
      }
    }
    assert.equal(checked, 108);
  });

  test("done is final for every executor", () => {
    for (const s of [aiStep(), step(), thirdStep()]) {
      for (const to of STEP_STATUSES) assert.equal(check("done", to, s).allowed, false, `${s.executor} -> ${to}`);
    }
  });

  test("a step that was rejected can be reopened by any executor", () => {
    for (const s of [aiStep(), step(), thirdStep()]) assert.deepEqual(check("rejected", "not_started", s), ok, s.executor);
  });
});

describe("AI step to running", () => {
  test("the first launch needs the person", () => {
    assert.deepEqual(check("not_started", "running", aiStep(), false), refused("not_launched_by_user"));
    assert.deepEqual(check("not_started", "running", aiStep(), true), ok);
  });

  test("another round needs the person too", () => {
    const s = aiStep({ outputs: [output(1, "draft")] });
    assert.deepEqual(check("waiting_user", "running", s, false), refused("not_launched_by_user"));
    assert.deepEqual(check("waiting_user", "running", s, true), ok);
  });

  test("another round is allowed while the versions are below MAX_ROUNDS", () => {
    const versions = (count: number) =>
      aiStep({
        events: attempt(count),
        outputs: Array.from({ length: count }, (_, i) => output(i + 1, i === count - 1 ? "draft" : "superseded")),
      });
    assert.deepEqual(check("waiting_user", "running", versions(MAX_ROUNDS - 1)), ok);
    assert.deepEqual(check("waiting_user", "running", versions(MAX_ROUNDS)), refused("rounds_exceeded"));
    assert.deepEqual(check("waiting_user", "running", versions(MAX_ROUNDS + 1)), refused("rounds_exceeded"));
  });

  test("a reopened step starts a new attempt: its old rounds do not count", () => {
    const reopened = (count: number) =>
      aiStep({
        events: [...attempt(count), ev2("reject_output", "waiting_user", "rejected"), ev2("reopen", "rejected", "not_started")],
        outputs: Array.from({ length: count }, (_, i) => output(i + 1, "rejected")),
      });
    for (const count of [MAX_ROUNDS - 1, MAX_ROUNDS, MAX_ROUNDS + 2]) assert.deepEqual(check("not_started", "running", reopened(count)), ok, String(count));
  });

  test("the limit still applies inside the new attempt", () => {
    const events = (count: number) => [
      ...attempt(MAX_ROUNDS),
      ev2("reject_output", "waiting_user", "rejected"),
      ev2("reopen", "rejected", "not_started"),
      ...attempt(count),
    ];
    assert.deepEqual(check("waiting_user", "running", aiStep({ events: events(MAX_ROUNDS - 1) })), ok);
    assert.deepEqual(check("waiting_user", "running", aiStep({ events: events(MAX_ROUNDS) })), refused("rounds_exceeded"));
  });

  test("a change of executor starts a new attempt too", () => {
    const events = [...attempt(MAX_ROUNDS), ev2("change_executor", "not_started", "not_started")];
    assert.deepEqual(check("not_started", "running", aiStep({ events })), ok);
    assert.deepEqual(check("not_started", "running", aiStep({ events: attempt(MAX_ROUNDS) })), refused("rounds_exceeded"));
  });

  test("the rounds are counted from the events, not from the outputs or the dates", () => {
    const outputs = Array.from({ length: MAX_ROUNDS }, (_, i) => output(i + 1, "superseded"));
    assert.deepEqual(check("not_started", "running", aiStep({ outputs, events: [] })), ok);
    const late = attempt(MAX_ROUNDS).map((event) => ({ ...event, at: "2030-01-01T00:00:00Z" }));
    assert.deepEqual(check("waiting_user", "running", aiStep({ events: [...late, { ...ev2("reopen", "rejected", "not_started"), at: T1 }] })), ok);
  });

  test("the person is asked before the round limit", () => {
    const full = aiStep({ outputs: Array.from({ length: MAX_ROUNDS }, (_, i) => output(i + 1, "draft")) });
    assert.deepEqual(check("waiting_user", "running", full, false), refused("not_launched_by_user"));
  });

  test("the AI delivering a draft needs no launch", () => {
    assert.deepEqual(check("running", "waiting_user", aiStep(), false), ok);
  });
});

describe("user and third-party steps to running", () => {
  test("need no launch", () => {
    assert.deepEqual(check("not_started", "running", step(), false), ok);
    assert.deepEqual(check("waiting_third_party", "running", step(), false), ok);
  });
});

describe("to done: the evidence", () => {
  test("evidence none asks for nothing, for every executor", () => {
    assert.deepEqual(check("waiting_user", "done", aiStep()), ok);
    assert.deepEqual(check("running", "done", step()), ok);
    assert.deepEqual(check("waiting_third_party", "done", thirdStep()), ok);
  });

  test("written confirmation and receipt need the proof, with its text", () => {
    for (const kind of ["written_confirmation", "receipt"]) {
      const evidence = { kind };
      assert.deepEqual(check("running", "done", step({ evidence })), refused("evidence_missing"), kind);
      assert.deepEqual(check("running", "done", step({ evidence, proof })), ok, kind);
      assert.deepEqual(check("waiting_third_party", "done", thirdStep({ evidence })), refused("evidence_missing"), kind);
      assert.deepEqual(check("waiting_third_party", "done", thirdStep({ evidence, proof })), ok, kind);
      assert.deepEqual(check("waiting_user", "done", aiStep({ evidence })), refused("evidence_missing"), kind);
      assert.deepEqual(check("waiting_user", "done", aiStep({ evidence, proof })), ok, kind);
    }
  });

  test("accepted output needs the current output confirmed with its date", () => {
    const evidence = { kind: "accepted_output" };
    const done = (outputs?: unknown[]) => check("waiting_user", "done", aiStep({ evidence, outputs }));
    assert.deepEqual(done(), refused("evidence_missing"));
    assert.deepEqual(done([]), refused("evidence_missing"));
    assert.deepEqual(done([output(1, "draft")]), refused("evidence_missing"));
    assert.deepEqual(done([output(1, "rejected")]), refused("evidence_missing"));
    assert.deepEqual(done([output(1, "confirmed")]), refused("evidence_missing"));
    assert.deepEqual(done([output(1, "confirmed", { confirmedAt: T2 })]), ok);
  });

  test("accepted output looks at the latest version, not at an old confirmed one", () => {
    const evidence = { kind: "accepted_output" };
    const outputs = [output(1, "superseded", { confirmedAt: T1 }), output(2, "draft")];
    assert.deepEqual(check("waiting_user", "done", aiStep({ evidence, outputs })), refused("evidence_missing"));
  });

  test("a proof does not replace a confirmed output", () => {
    const evidence = { kind: "accepted_output" };
    assert.deepEqual(check("waiting_user", "done", aiStep({ evidence, proof })), refused("evidence_missing"));
  });

  test("the table is checked before the evidence", () => {
    assert.deepEqual(check("not_started", "done", step({ evidence: { kind: "receipt" } })), refused("not_allowed"));
  });
});

describe("readableOutput", () => {
  test("the confirmed current output of an AI step is returned as is", () => {
    const confirmed = output(2, "confirmed", { confirmedAt: T2, documentRef: "doc1", questions: [{ question: "Q?", answer: "A" }] });
    assert.deepEqual(readableOutput(aiStep({ outputs: [output(1, "superseded"), confirmed] })), confirmed);
  });

  test("a draft, a rejected output, no output and a non-AI step give undefined", () => {
    assert.equal(readableOutput(aiStep({ outputs: [output(1, "draft")] })), undefined);
    assert.equal(readableOutput(aiStep({ outputs: [output(1, "rejected")] })), undefined);
    assert.equal(readableOutput(aiStep({ outputs: [] })), undefined);
    assert.equal(readableOutput(aiStep()), undefined);
    // Not valid in a plan, but the rule must not depend on the schema having run
    assert.equal(readableOutput(step({ outputs: [output(1, "confirmed")] })), undefined);
  });

  test("an old confirmed version that was replaced is not readable", () => {
    assert.equal(readableOutput(aiStep({ outputs: [output(1, "confirmed"), output(2, "draft")] })), undefined);
  });
});

describe("orderEdges", () => {
  const rel = (level: string, type: string, from: string, to: string) => ({ level, type, from, to }) as Plan["relations"][number];

  test("blocks and feeds keep their direction, follows is reversed, other levels are left out", () => {
    assert.deepEqual(
      orderEdges([
        rel("step", "blocks", "a", "b"),
        rel("step", "feeds", "c", "d"),
        rel("step", "follows", "e", "f"),
        rel("task", "blocks", "g", "h"),
        rel("phase", "follows", "i", "j"),
      ]),
      [["a", "b"], ["c", "d"], ["f", "e"]],
    );
  });
});

describe("cycleIn", () => {
  test("works on plain edges", () => {
    assert.equal(cycleIn([]), undefined);
    assert.equal(cycleIn([["a", "b"], ["b", "c"]]), undefined);
    assert.deepEqual(cycleIn([["a", "b"], ["b", "a"]]), ["a", "b"]);
  });
});

describe("feedsFromNonAi", () => {
  const base = (relations: unknown[]) =>
    ({
      steps: [step({ id: "u" }), aiStep({ id: "ai" }), step({ id: "t", executor: "third_party", mode: undefined })],
      relations,
    }) as unknown as Plan;
  const feeds = (from: string) => ({ level: "step", from, to: "x", type: "feeds" });

  test("accepts an AI source and flags user, third-party and unknown sources by index", () => {
    assert.deepEqual(feedsFromNonAi(base([feeds("ai")])), []);
    assert.deepEqual(feedsFromNonAi(base([feeds("ai"), feeds("u"), feeds("t"), feeds("ghost")])), [1, 2, 3]);
  });

  test("only feeds is checked: blocks from a user step is fine", () => {
    assert.deepEqual(feedsFromNonAi(base([{ level: "step", from: "u", to: "x", type: "blocks" }])), []);
  });
});

describe("findStepCycle", () => {
  const rel = (from: string, to: string, type = "blocks", level = "step") =>
    ({ level, from, to, type }) as Plan["relations"][number];

  test("no relations and a chain have no cycle", () => {
    assert.equal(findStepCycle([]), undefined);
    assert.equal(findStepCycle([rel("a", "b"), rel("b", "c")]), undefined);
  });

  test("a diamond is not a cycle", () => {
    assert.equal(findStepCycle([rel("a", "b"), rel("a", "c"), rel("b", "d"), rel("c", "d")]), undefined);
  });

  test("finds a cycle and returns its ids in order", () => {
    assert.deepEqual(findStepCycle([rel("a", "b"), rel("b", "c"), rel("c", "a")]), ["a", "b", "c"]);
    assert.deepEqual(findStepCycle([rel("x", "a"), rel("a", "b"), rel("b", "a")]), ["a", "b"]);
  });

  test("blocks, follows and feeds count together", () => {
    assert.deepEqual(findStepCycle([rel("a", "b", "blocks"), rel("b", "c", "feeds"), rel("a", "c", "follows")]), ["a", "b", "c"]);
  });

  test("follows reads the other way: 'a follows b' is b before a", () => {
    assert.equal(findStepCycle([rel("a", "b", "blocks"), rel("b", "a", "follows")]), undefined);
    assert.deepEqual(findStepCycle([rel("a", "b", "blocks"), rel("a", "b", "follows")]), ["a", "b"]);
  });

  test("ignores relations of other levels", () => {
    assert.equal(findStepCycle([rel("a", "b", "blocks", "task"), rel("b", "a", "blocks", "task")]), undefined);
    assert.equal(findStepCycle([rel("a", "b"), rel("b", "a", "blocks", "phase")]), undefined);
  });

  test("does not revisit finished steps: stacked diamonds stay fast", () => {
    // Without remembering finished steps this walks 2^LAYERS paths (seconds); with it, milliseconds
    const LAYERS = 26;
    const MAX_MS = 1000;
    const relations = Array.from({ length: LAYERS }, (_, i) =>
      ["x", "y"].flatMap((from) => ["x", "y"].map((to) => rel(`${from}${i}`, `${to}${i + 1}`))),
    ).flat();
    const started = performance.now();
    assert.equal(findStepCycle(relations), undefined);
    assert.ok(performance.now() - started < MAX_MS);
  });

  test("works on a long chain closed into a cycle", () => {
    const length = 2000;
    const chain = Array.from({ length }, (_, i) => rel(`n${i}`, `n${(i + 1) % length}`));
    assert.equal(findStepCycle(chain)?.length, length);
    assert.equal(findStepCycle(chain.slice(0, -1)), undefined);
  });
});

describe("stepProblems", () => {
  const valid = (overrides: Record<string, unknown> = {}) =>
    aiStep({
      status: "waiting_user",
      events: [
        { at: T1, actor: "user", action: "launch", from: "not_started", to: "running" },
        { at: T2, actor: "ai", action: "attach_output", from: "running", to: "waiting_user" },
      ],
      outputs: [output(1, "draft")],
      ...overrides,
    });
  const ev = (at: string, from: string, to: string) => ({ at, actor: "user", action: "launch", from, to });
  const T3 = "2026-10-07T12:00:00Z";

  test("a valid step has no problems, whatever its executor", () => {
    assert.deepEqual(stepProblems(valid()), []);
    assert.deepEqual(stepProblems(step()), []);
    assert.deepEqual(stepProblems(thirdStep()), []);
    assert.deepEqual(stepProblems(aiStep()), []);
  });

  test("the list of codes is the agreed one", () => {
    assert.deepEqual(
      [...STEP_PROBLEMS],
      [
        "done_without_evidence", "multiple_drafts", "draft_not_last", "versions_not_consecutive", "events_go_back",
        "events_not_chained", "status_not_last_event", "too_many_rounds", "live_output_on_non_ai", "mode_on_non_user", "user_without_mode",
        "executor_history_broken",
      ],
    );
  });

  test("done_without_evidence: done needs the evidence of the step", () => {
    const doneAt = (overrides: Record<string, unknown>) =>
      step({ status: "done", events: [ev(T1, "not_started", "done")], ...overrides });
    assert.deepEqual(stepProblems(doneAt({})), []);
    for (const kind of ["written_confirmation", "receipt"]) {
      assert.deepEqual(stepProblems(doneAt({ evidence: { kind } })), ["done_without_evidence"], kind);
      assert.deepEqual(stepProblems(doneAt({ evidence: { kind }, proof })), [], kind);
    }
    const aiDone = (outputs: unknown[]) =>
      aiStep({ status: "done", events: [ev(T1, "not_started", "done")], evidence: { kind: "accepted_output" }, outputs });
    assert.deepEqual(stepProblems(aiDone([output(1, "draft")])), ["done_without_evidence"]);
    assert.deepEqual(stepProblems(aiDone([output(1, "confirmed")])), ["done_without_evidence"]);
    assert.deepEqual(stepProblems(aiDone([output(1, "confirmed", { confirmedAt: T2 })])), []);
    // Evidence is only asked of a step that is done
    assert.deepEqual(stepProblems(step({ evidence: { kind: "receipt" } })), []);
  });

  test("multiple_drafts and draft_not_last are told apart", () => {
    assert.deepEqual(stepProblems(valid({ outputs: [output(1, "draft"), output(2, "draft")] })), ["multiple_drafts", "draft_not_last"]);
    assert.deepEqual(stepProblems(valid({ outputs: [output(1, "draft"), output(2, "rejected")] })), ["draft_not_last"]);
    assert.deepEqual(stepProblems(valid({ outputs: [output(1, "superseded"), output(2, "draft")] })), []);
    assert.deepEqual(stepProblems(valid({ outputs: [output(1, "rejected"), output(2, "draft")] })), []);
  });

  test("versions_not_consecutive: they count 1, 2, 3 in order", () => {
    assert.deepEqual(stepProblems(valid({ outputs: [output(2, "draft")] })), ["versions_not_consecutive"]);
    assert.deepEqual(stepProblems(valid({ outputs: [output(1, "superseded"), output(3, "draft")] })), ["versions_not_consecutive"]);
    assert.deepEqual(stepProblems(valid({ outputs: [output(1, "superseded"), output(1, "draft")] })), ["versions_not_consecutive"]);
    assert.deepEqual(stepProblems(valid({ outputs: [output(1, "superseded"), output(2, "draft")] })), []);
  });

  test("events_go_back: dates never go back, but may repeat", () => {
    const events = (second: string) => [ev(T2, "not_started", "running"), { ...ev(second, "running", "waiting_user"), actor: "ai" }];
    assert.deepEqual(stepProblems(valid({ events: events(T1) })), ["events_go_back"]);
    assert.deepEqual(stepProblems(valid({ events: events(T2) })), []);
    assert.deepEqual(stepProblems(valid({ events: events("2026-10-07T10:59:59.999Z") })), ["events_go_back"]);
  });

  test("events_not_chained: the first starts at the beginning and each one where the last ended", () => {
    assert.deepEqual(stepProblems(valid({ events: [ev(T1, "running", "waiting_user")] })), ["events_not_chained"]);
    assert.deepEqual(stepProblems(valid({ events: [ev(T1, "not_started", "running"), ev(T2, "waiting_user", "waiting_user")] })), ["events_not_chained"]);
    assert.deepEqual(stepProblems(valid({ events: [ev(T1, "not_started", "running"), ev(T2, "running", "rejected"), ev(T3, "running", "waiting_user")] })), ["events_not_chained"]);
  });

  test("status_not_last_event: the status is where the last event ended", () => {
    assert.deepEqual(stepProblems(valid({ status: "running" })), ["status_not_last_event"]);
    assert.deepEqual(stepProblems(step({ status: "running" })), ["status_not_last_event"]);
    assert.deepEqual(stepProblems(step({ events: [ev(T1, "not_started", "running")] })), ["status_not_last_event"]);
    assert.deepEqual(stepProblems(step({ status: "running", events: [ev(T1, "not_started", "running")] })), []);
  });

  test("too_many_rounds: more than MAX_ROUNDS rounds in one attempt", () => {
    const versions = (count: number) => Array.from({ length: count }, (_, i) => output(i + 1, i === count - 1 ? "draft" : "superseded"));
    assert.deepEqual(stepProblems(valid({ events: attempt(MAX_ROUNDS), outputs: versions(MAX_ROUNDS) })), []);
    assert.deepEqual(stepProblems(valid({ events: attempt(MAX_ROUNDS + 1), outputs: versions(MAX_ROUNDS + 1) })), ["too_many_rounds"]);
  });

  test("too_many_rounds: MAX_ROUNDS in each of two attempts is fine, and so is a change of executor in between", () => {
    const total = 2 * MAX_ROUNDS;
    const outputs = Array.from({ length: total }, (_, i) => output(i + 1, i === total - 1 ? "draft" : "rejected"));
    const first = attempt(MAX_ROUNDS);
    const between = [ev2("reject_output", "waiting_user", "rejected"), ev2("reopen", "rejected", "not_started")];
    assert.deepEqual(stepProblems(valid({ events: [...first, ...between, ...attempt(MAX_ROUNDS)], outputs })), []);
    const changed = [ev2("reject_output", "waiting_user", "rejected"), ev2("reopen", "rejected", "not_started"), { ...ev2("change_executor", "not_started", "not_started"), executorFrom: "ai", executorTo: "user" }, { ...ev2("change_executor", "not_started", "not_started"), executorFrom: "user", executorTo: "ai" }];
    assert.deepEqual(stepProblems(valid({ events: [...first, ...changed, ...attempt(MAX_ROUNDS)], outputs })), []);
  });

  test("live_output_on_non_ai: old outputs may stay, but none open or accepted", () => {
    // A step that is not AI keeps the outputs it had, closed
    assert.deepEqual(stepProblems(step({ outputs: [] })), []);
    assert.deepEqual(stepProblems(step({ outputs: [output(1, "superseded"), output(2, "rejected")] })), []);
    assert.deepEqual(stepProblems(thirdStep({ outputs: [output(1, "rejected")] })), []);
    for (const state of ["draft", "confirmed"]) {
      assert.deepEqual(stepProblems(step({ outputs: [output(1, state)] })), ["live_output_on_non_ai"], state);
      assert.deepEqual(stepProblems(thirdStep({ outputs: [output(1, state)] })), ["live_output_on_non_ai"], state);
    }
    // An AI step may have them
    assert.deepEqual(stepProblems(aiStep({ outputs: [output(1, "draft")] })), []);
  });

  test("executor_history_broken: changes are recorded only by change_executor and chain up to the executor", () => {
    const change = (from: string, to: string, overrides: Record<string, unknown> = {}) => ({
      at: T1, actor: "user", action: "change_executor", from: "not_started", to: "not_started", executorFrom: from, executorTo: to, ...overrides,
    });
    const withEvents = (executor: string, events: unknown[]) => make(executor, events);
    const make = (executor: string, events: unknown[]) => step({ executor, mode: executor === "user" ? "online" : undefined, events });
    // Valid: no change, one change, two chained changes
    assert.deepEqual(stepProblems(withEvents("ai", [])), []);
    assert.deepEqual(stepProblems(withEvents("user", [change("ai", "user")])), []);
    assert.deepEqual(stepProblems(withEvents("third_party", [change("ai", "user"), change("user", "third_party")])), []);
    // The current executor is not where the last change ended
    assert.deepEqual(stepProblems(withEvents("ai", [change("ai", "user")])), ["executor_history_broken"]);
    assert.deepEqual(stepProblems(withEvents("user", [change("ai", "user"), change("user", "third_party")])), ["executor_history_broken"]);
    // The chain breaks
    assert.deepEqual(stepProblems(withEvents("ai", [change("ai", "user"), change("third_party", "ai")])), ["executor_history_broken"]);
    // Not a change
    assert.deepEqual(stepProblems(withEvents("user", [change("user", "user")])), ["executor_history_broken"]);
    // Fields missing
    assert.deepEqual(stepProblems(withEvents("user", [change("ai", "user", { executorFrom: undefined })])), ["executor_history_broken"]);
    assert.deepEqual(stepProblems(withEvents("user", [change("ai", "user", { executorTo: undefined })])), ["executor_history_broken"]);
    // It must not move the status
    assert.deepEqual(stepProblems(step({ status: "running", events: [change("ai", "user", { from: "not_started", to: "running" })] })), ["executor_history_broken"]);
    assert.deepEqual(
      stepProblems(step({ status: "running", events: [{ at: T1, actor: "user", action: "launch", from: "not_started", to: "running" }, change("ai", "user", { from: "running", to: "running" })] })),
      ["executor_history_broken"],
    );
    // It must also start where the step starts, not only end there
    assert.deepEqual(
      stepProblems(step({ events: [ev(T1, "not_started", "rejected"), change("ai", "user", { from: "rejected", to: "not_started" })] })),
      ["executor_history_broken"],
    );
    // Other events carry no executors
    const launch = { at: T1, actor: "user", action: "launch", from: "not_started", to: "running" };
    assert.deepEqual(stepProblems(step({ status: "running", events: [{ ...launch, executorFrom: "ai" }] })), ["executor_history_broken"]);
    assert.deepEqual(stepProblems(step({ status: "running", events: [{ ...launch, executorTo: "ai" }] })), ["executor_history_broken"]);
  });

  test("mode_on_non_user and user_without_mode: a mode belongs to user steps and only to them", () => {
    assert.deepEqual(stepProblems(aiStep({ mode: "online" })), ["mode_on_non_user"]);
    assert.deepEqual(stepProblems(thirdStep({ mode: "in_person" })), ["mode_on_non_user"]);
    assert.deepEqual(stepProblems(step({ mode: undefined })), ["user_without_mode"]);
    assert.deepEqual(stepProblems(step({ mode: "in_person" })), []);
  });

  test("several broken rules are all reported, once each and in the fixed order", () => {
    const broken = stepProblems(
      aiStep({ mode: "online", status: "done", events: [], outputs: [output(2, "draft"), output(2, "draft")] }),
    );
    assert.deepEqual(broken, ["multiple_drafts", "draft_not_last", "versions_not_consecutive", "status_not_last_event", "mode_on_non_user"]);
  });

  test("the answer is only codes: no content of the step is ever in it", () => {
    const secret = "SECRET-TEXT-FROM-THE-USER";
    const result = stepProblems(aiStep({ text: secret, mode: "online", outputs: [output(5, "draft", { summary: secret })], proof: { text: secret, at: T1, by: "user" } }));
    assert.ok(result.length > 0);
    assert.ok(result.every((code) => (STEP_PROBLEMS as readonly string[]).includes(code)));
    assert.ok(!JSON.stringify(result).includes(secret));
  });
});
