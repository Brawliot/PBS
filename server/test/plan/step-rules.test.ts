import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, STEP_STATUSES, type Plan, type Step, type StepStatus } from "../../plan/plan-model.js";
import {
  TRANSITIONS,
  canTransition,
  feedsFromNonAi,
  findStepCycle,
  readableOutput,
  stepContext,
  type StepContext,
} from "../../plan/step-rules.js";

const origin = { kind: "rule" } as const;
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
  status: "pending",
  origin,
  confidence: 100,
  ...overrides,
}) as Step;
const aiStep = (overrides: Record<string, unknown> = {}) =>
  step({ executor: "ai", mode: undefined, ...overrides });
const output = (state: "draft" | "confirmed") => ({ state, summary: "S", questions: [] });

const context = (overrides: Partial<StepContext> = {}): StepContext => ({
  step: step(),
  blockers: [],
  feeders: [],
  launchedByUser: false,
  evidenceProvided: false,
  ...overrides,
});
const check = (from: StepStatus, to: StepStatus, ctx: Partial<StepContext> = {}) =>
  canTransition(from, to, context(ctx));

describe("transition table", () => {
  const expected: Record<string, string[]> = {
    pending: ["ready", "blocked", "rejected"],
    ready: ["running", "waiting_user", "waiting_third_party", "blocked", "done", "rejected"],
    running: ["waiting_user", "waiting_third_party", "blocked", "done", "rejected"],
    waiting_user: ["running", "blocked", "done", "rejected"],
    waiting_third_party: ["running", "blocked", "done", "rejected"],
    blocked: ["ready", "rejected"],
    done: [],
    rejected: [],
  };

  test("lists every status exactly once", () => {
    assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...STEP_STATUSES].sort());
  });

  test("every pair is allowed or refused exactly as the table says", () => {
    // A context that satisfies every other rule, so only the table decides
    const free = context({ launchedByUser: true, evidenceProvided: true });
    for (const from of STEP_STATUSES) {
      for (const to of STEP_STATUSES) {
        const result = canTransition(from, to, free);
        if (expected[from].includes(to)) {
          assert.deepEqual(result, { allowed: true }, `${from} -> ${to}`);
        } else {
          assert.deepEqual(result, { allowed: false, reason: "not_allowed" }, `${from} -> ${to}`);
        }
      }
    }
  });

  test("done and rejected are final", () => {
    for (const to of STEP_STATUSES) {
      assert.equal(check("done", to).allowed, false, `done -> ${to}`);
      assert.equal(check("rejected", to).allowed, false, `rejected -> ${to}`);
    }
  });
});

describe("to ready", () => {
  const blocker = (status: StepStatus) => step({ id: "b", status });
  const feeder = (state: "draft" | "confirmed" | undefined) =>
    aiStep({ id: "f", output: state && output(state) });

  test("with no blockers and no feeders it is allowed", () => {
    assert.deepEqual(check("pending", "ready"), { allowed: true });
  });

  test("needs every blocker done: one that is not done refuses", () => {
    assert.deepEqual(check("pending", "ready", { blockers: [blocker("done"), blocker("done")] }), { allowed: true });
    for (const status of STEP_STATUSES.filter((s) => s !== "done")) {
      assert.deepEqual(
        check("pending", "ready", { blockers: [blocker("done"), blocker(status)] }),
        { allowed: false, reason: "blockers_not_done" },
        status,
      );
    }
  });

  test("needs every feeder to have a confirmed output", () => {
    assert.deepEqual(check("pending", "ready", { feeders: [feeder("confirmed"), feeder("confirmed")] }), { allowed: true });
    for (const state of ["draft", undefined] as const) {
      assert.deepEqual(
        check("pending", "ready", { feeders: [feeder("confirmed"), feeder(state)] }),
        { allowed: false, reason: "feeders_not_confirmed" },
        String(state),
      );
    }
  });

  test("blocked steps coming back to ready follow the same rules", () => {
    assert.deepEqual(check("blocked", "ready", { blockers: [blocker("running")] }), { allowed: false, reason: "blockers_not_done" });
    assert.deepEqual(check("blocked", "ready", { blockers: [blocker("done")] }), { allowed: true });
  });

  test("the blockers and feeders do not matter for other targets", () => {
    const open = { blockers: [blocker("pending")], feeders: [feeder("draft")] };
    assert.deepEqual(check("pending", "blocked", open), { allowed: true });
    assert.deepEqual(check("ready", "waiting_user", open), { allowed: true });
  });
});

describe("to running", () => {
  test("an AI step runs only when the person launched it", () => {
    const ai = aiStep();
    assert.deepEqual(check("ready", "running", { step: ai, launchedByUser: false }), { allowed: false, reason: "not_launched_by_user" });
    assert.deepEqual(check("ready", "running", { step: ai, launchedByUser: true }), { allowed: true });
  });

  test("resuming an AI step from a waiting status needs the launch too", () => {
    const ai = aiStep();
    assert.deepEqual(check("waiting_user", "running", { step: ai }), { allowed: false, reason: "not_launched_by_user" });
    assert.deepEqual(check("waiting_user", "running", { step: ai, launchedByUser: true }), { allowed: true });
  });

  test("user and third-party steps do not need a launch", () => {
    assert.deepEqual(check("ready", "running", { step: step() }), { allowed: true });
    assert.deepEqual(check("ready", "running", { step: step({ executor: "third_party", mode: undefined }) }), { allowed: true });
  });
});

describe("to done", () => {
  test("evidence none: done is allowed without anything", () => {
    assert.deepEqual(check("running", "done", { step: step({ evidence: { kind: "none" } }) }), { allowed: true });
  });

  test("written confirmation and receipt need the person to have provided it", () => {
    for (const kind of ["written_confirmation", "receipt"]) {
      const s = step({ evidence: { kind } });
      assert.deepEqual(check("running", "done", { step: s, evidenceProvided: false }), { allowed: false, reason: "evidence_missing" }, kind);
      assert.deepEqual(check("running", "done", { step: s, evidenceProvided: true }), { allowed: true }, kind);
    }
  });

  test("accepted output needs a confirmed output, and the provided flag does not replace it", () => {
    const evidence = { kind: "accepted_output" };
    const missing = { reason: "evidence_missing", allowed: false };
    assert.deepEqual(check("running", "done", { step: aiStep({ evidence }), evidenceProvided: true }), missing);
    assert.deepEqual(check("running", "done", { step: aiStep({ evidence, output: output("draft") }), evidenceProvided: true }), missing);
    assert.deepEqual(check("running", "done", { step: aiStep({ evidence, output: output("confirmed") }) }), { allowed: true });
  });

  test("the table is checked before the evidence", () => {
    assert.deepEqual(
      check("pending", "done", { step: step({ evidence: { kind: "receipt" } }) }),
      { allowed: false, reason: "not_allowed" },
    );
  });
});

describe("readableOutput", () => {
  test("a confirmed output of an AI step is returned as is", () => {
    const confirmed = { state: "confirmed", summary: "S", questions: ["Q?"], documentRef: "doc1" } as const;
    assert.deepEqual(readableOutput(aiStep({ output: confirmed })), confirmed);
  });

  test("a draft, a missing output and a non-AI step give undefined", () => {
    assert.equal(readableOutput(aiStep({ output: output("draft") })), undefined);
    assert.equal(readableOutput(aiStep()), undefined);
    // Not valid in a plan, but the rule must not depend on the schema having run
    assert.equal(readableOutput(step({ output: output("confirmed") })), undefined);
  });
});

describe("stepContext", () => {
  const plan: Plan = parsePlan({
    departments: [{ id: "legal", name: "Legal", tier: "core" }],
    phases: [{ id: "f1", name: "Set up", order: 0 }],
    tasks: [{ id: "t1", phaseId: "f1", primaryDepartmentId: "legal", secondaryDepartmentIds: [], title: "T", status: "todo", origin, confidence: 100 }],
    steps: [
      step({ id: "a" }),
      step({ id: "b" }),
      aiStep({ id: "c" }),
      step({ id: "d" }),
    ],
    relations: [
      { level: "step", from: "a", to: "d", type: "blocks" },
      { level: "step", from: "b", to: "d", type: "follows" },
      { level: "step", from: "c", to: "d", type: "feeds" },
      { level: "step", from: "d", to: "a", type: "follows" },
      { level: "task", from: "b", to: "d", type: "blocks" },
    ],
  });
  const d = plan.steps[3];
  const flags = { launchedByUser: true, evidenceProvided: false };

  test("blockers are the sources of blocks into the step; feeders those of feeds", () => {
    const ctx = stepContext(plan, d, flags);
    assert.deepEqual(ctx.blockers.map((x) => x.id), ["a"]);
    assert.deepEqual(ctx.feeders.map((x) => x.id), ["c"]);
    assert.equal(ctx.step, d);
    assert.equal(ctx.launchedByUser, true);
    assert.equal(ctx.evidenceProvided, false);
  });

  test("the direction matters: a step blocking others has no blockers of its own", () => {
    const ctx = stepContext(plan, plan.steps[0], flags);
    assert.deepEqual(ctx.blockers, []);
    assert.deepEqual(ctx.feeders, []);
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
