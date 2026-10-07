import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { STEP_STATUSES, type Plan, type Step } from "../../plan/plan-model.js";
import {
  blockersOf,
  dependentsOf,
  feedsAnyStep,
  feedersOf,
  predecessorsOf,
  readiness,
  topologicalOrder,
} from "../../plan/step-graph.js";

const T1 = "2026-10-07T10:00:00Z";
const T2 = "2026-10-07T11:00:00Z";
const step = (id: string, overrides: Record<string, unknown> = {}): Step =>
  ({
    id,
    taskId: "t1",
    departmentId: "legal",
    text: id,
    executor: "user",
    mode: "online",
    evidence: { kind: "none" },
    effortHours: 1,
    waitDays: 0,
    status: "not_started",
    events: [],
    origin: { kind: "rule" },
    confidence: 100,
    ...overrides,
  }) as Step;
const aiStep = (id: string, overrides: Record<string, unknown> = {}) =>
  step(id, { executor: "ai", mode: undefined, ...overrides });
const output = (state: string) => ({ version: 1, state, summary: "S", questions: [], createdAt: T1, ...(state === "confirmed" && { confirmedAt: T2 }) });
const rel = (type: string, from: string, to: string, level = "step") => ({ level, type, from, to }) as Plan["relations"][number];
const ids = (steps: Step[]) => steps.map((s) => s.id);

describe("blockersOf, dependentsOf, feedersOf, predecessorsOf", () => {
  const steps = [step("a"), step("b"), step("c"), step("d"), step("e")];
  const relations = [
    rel("blocks", "c", "e"),
    rel("blocks", "a", "e"),
    rel("blocks", "e", "d"),
    rel("feeds", "b", "e"),
    rel("follows", "e", "a"),
    rel("follows", "d", "e"),
    rel("blocks", "b", "a", "task"),
    rel("blocks", "d", "e", "phase"),
  ];
  const e = steps[4];

  test("blockers are the sources of blocks into the step, in the order of the steps", () => {
    assert.deepEqual(ids(blockersOf(e, steps, relations)), ["a", "c"]);
  });

  test("dependents are the targets of blocks out of the step", () => {
    assert.deepEqual(ids(dependentsOf(e, steps, relations)), ["d"]);
    assert.deepEqual(ids(dependentsOf(steps[0], steps, relations)), ["e"]);
  });

  test("feeders are the sources of feeds into the step", () => {
    assert.deepEqual(ids(feedersOf(e, steps, relations)), ["b"]);
    assert.deepEqual(ids(feedersOf(steps[0], steps, relations)), []);
  });

  test("predecessors are what the step follows: 'e follows a' makes a its predecessor", () => {
    assert.deepEqual(ids(predecessorsOf(e, steps, relations)), ["a"]);
    assert.deepEqual(ids(predecessorsOf(steps[3], steps, relations)), ["e"]);
    assert.deepEqual(ids(predecessorsOf(steps[0], steps, relations)), []);
  });

  test("each query reads only its own type and the step level", () => {
    // "b blocks a" is a task relation and "d blocks e" a phase one: neither counts
    assert.deepEqual(ids(blockersOf(steps[0], steps, relations)), []);
    assert.deepEqual(ids(blockersOf(e, steps, relations)), ["a", "c"]);
  });

  test("a step that is not in the list is left out, and a repeated relation counts once", () => {
    assert.deepEqual(ids(blockersOf(e, [steps[0], steps[2]], [...relations, rel("blocks", "ghost", "e")])), ["a", "c"]);
    assert.deepEqual(ids(blockersOf(e, steps, [rel("blocks", "a", "e"), rel("blocks", "a", "e")])), ["a"]);
  });
});

describe("feedsAnyStep", () => {
  const [a, b, c] = ["a", "b", "c"].map((id) => aiStep(id));

  test("is true for the source of a feeds relation and for no one else", () => {
    const relations = [rel("feeds", "a", "b")];
    assert.equal(feedsAnyStep(a, relations), true);
    assert.equal(feedsAnyStep(b, relations), false);
    assert.equal(feedsAnyStep(c, relations), false);
  });

  test("other types and other levels do not count", () => {
    const relations = [rel("blocks", "a", "b"), rel("follows", "a", "b"), rel("feeds", "a", "b", "task"), rel("feeds", "a", "b", "phase")];
    assert.equal(feedsAnyStep(a, relations), false);
  });

  test("with no relations it is false", () => {
    assert.equal(feedsAnyStep(a, []), false);
  });
});

describe("readiness", () => {
  const blocker = (status: string) => step("b", { status });
  const feeder = (outputs?: unknown[], status = "waiting_user") => aiStep("f", { status, outputs });
  const a = step("a");
  const blocks = [rel("blocks", "b", "a")];
  const feeds = [rel("feeds", "f", "a")];

  test("with nothing before it, a step that has not started is ready", () => {
    assert.equal(readiness(a, [a], []), "ready");
  });

  test("a blocker that is done lets it start; any other status keeps it blocked", () => {
    assert.equal(readiness(a, [a, blocker("done")], blocks), "ready");
    for (const status of STEP_STATUSES.filter((s) => s !== "done")) {
      assert.equal(readiness(a, [a, blocker(status)], blocks), "blocked", status);
    }
  });

  test("every blocker must be done", () => {
    const two = [rel("blocks", "b", "a"), rel("blocks", "c", "a")];
    const c = (status: string) => step("c", { status });
    assert.equal(readiness(a, [a, blocker("done"), c("done")], two), "ready");
    assert.equal(readiness(a, [a, blocker("done"), c("running")], two), "blocked");
  });

  test("a feeder with a confirmed current output lets it start", () => {
    assert.equal(readiness(a, [a, feeder([output("confirmed")], "done")], feeds), "ready");
  });

  test("a feeder with a draft, a rejected output, no output or an old confirmed one keeps it blocked", () => {
    assert.equal(readiness(a, [a, feeder([output("draft")])], feeds), "blocked");
    assert.equal(readiness(a, [a, feeder([output("rejected")])], feeds), "blocked");
    assert.equal(readiness(a, [a, feeder([])], feeds), "blocked");
    assert.equal(readiness(a, [a, feeder()], feeds), "blocked");
    const replaced = [{ ...output("confirmed"), state: "superseded" }, { ...output("draft"), version: 2 }];
    assert.equal(readiness(a, [a, feeder(replaced)], feeds), "blocked");
  });

  test("blockers and feeders both have to be met", () => {
    const relations = [...blocks, ...feeds];
    const confirmed = feeder([output("confirmed")]);
    assert.equal(readiness(a, [a, blocker("done"), confirmed], relations), "ready");
    assert.equal(readiness(a, [a, blocker("running"), confirmed], relations), "blocked");
    assert.equal(readiness(a, [a, blocker("done"), feeder([output("draft")])], relations), "blocked");
  });

  test("a predecessor (follows) never blocks, whatever its status", () => {
    const follows = [rel("follows", "a", "b")];
    for (const status of STEP_STATUSES) assert.equal(readiness(a, [a, blocker(status)], follows), "ready", status);
  });

  test("relations of other levels or of other steps do not matter", () => {
    const other = [rel("blocks", "b", "a", "task"), rel("blocks", "b", "a", "phase"), rel("blocks", "a", "b")];
    assert.equal(readiness(a, [a, blocker("running")], other), "ready");
  });

  test("a source that is not in the list counts as not met", () => {
    assert.equal(readiness(a, [a], blocks), "blocked");
    assert.equal(readiness(a, [a], feeds), "blocked");
  });

  test("any status other than not_started is not_applicable, even with open blockers", () => {
    for (const status of STEP_STATUSES.filter((s) => s !== "not_started")) {
      const started = step("a", { status });
      assert.equal(readiness(started, [started, blocker("running")], blocks), "not_applicable", status);
    }
  });
});

describe("topologicalOrder", () => {
  const order = (steps: Step[], relations: Plan["relations"]) => {
    const result = topologicalOrder(steps, relations);
    assert.ok(result.ok, "expected an order");
    return ids(result.order);
  };
  const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => step(id));

  test("with no relations it keeps the input order", () => {
    assert.deepEqual(order([c, a, d, b], []), ["c", "a", "d", "b"]);
    assert.deepEqual(order([], []), []);
  });

  test("blocks, feeds and follows all put the source first", () => {
    assert.deepEqual(order([b, a], [rel("blocks", "a", "b")]), ["a", "b"]);
    assert.deepEqual(order([b, a], [rel("feeds", "a", "b")]), ["a", "b"]);
    assert.deepEqual(order([a, b], [rel("follows", "a", "b")]), ["b", "a"]);
  });

  test("ties go to the step that comes first in the input", () => {
    // After a, both b and c are free: the input has c before b
    assert.deepEqual(order([a, c, b, d], [rel("blocks", "a", "b"), rel("blocks", "a", "c"), rel("blocks", "b", "d"), rel("blocks", "c", "d")]), ["a", "c", "b", "d"]);
  });

  test("a step that becomes free early is chosen over later ones that were already free", () => {
    // Input c, b, a, d with a before c: b and a are free, then c (index 0) beats d (index 3)
    assert.deepEqual(order([c, b, a, d], [rel("blocks", "a", "c")]), ["b", "a", "c", "d"]);
  });

  test("the result is the same for the same input, and does not touch it", () => {
    const input = [c, b, a, d];
    const relations = [rel("blocks", "a", "c")];
    assert.deepEqual(order(input, relations), order(input, relations));
    assert.deepEqual(ids(input), ["c", "b", "a", "d"]);
  });

  test("a repeated relation does not break the count", () => {
    assert.deepEqual(order([b, a], [rel("blocks", "a", "b"), rel("blocks", "a", "b")]), ["a", "b"]);
  });

  test("relations of other levels and with unknown steps are ignored", () => {
    assert.deepEqual(order([a, b], [rel("blocks", "b", "a", "task"), rel("blocks", "ghost", "a"), rel("blocks", "b", "ghost")]), ["a", "b"]);
    // A cycle among steps that are not in the list is not a cycle of this list
    assert.deepEqual(order([a, b], [rel("blocks", "x", "y"), rel("blocks", "y", "x")]), ["a", "b"]);
  });

  test("a cycle gives its ids in order instead of an order", () => {
    assert.deepEqual(topologicalOrder([a, b, c], [rel("blocks", "a", "b"), rel("blocks", "b", "c"), rel("blocks", "c", "a")]), {
      ok: false,
      code: "cycle",
      ids: ["a", "b", "c"],
    });
  });

  test("blocks, follows and feeds count together for the cycle", () => {
    const result = topologicalOrder([a, b, c], [rel("blocks", "a", "b"), rel("feeds", "b", "c"), rel("follows", "a", "c")]);
    assert.deepEqual(result, { ok: false, code: "cycle", ids: ["a", "b", "c"] });
  });

  test("a cycle that does not include every step names only its steps", () => {
    const result = topologicalOrder([a, b, c, d], [rel("blocks", "a", "b"), rel("blocks", "c", "d"), rel("blocks", "d", "c")]);
    assert.deepEqual(result, { ok: false, code: "cycle", ids: ["c", "d"] });
  });

  test("every step appears exactly once in a long chain given in reverse", () => {
    const count = 500;
    const steps = Array.from({ length: count }, (_, i) => step(`n${count - 1 - i}`));
    const relations = Array.from({ length: count - 1 }, (_, i) => rel("blocks", `n${i}`, `n${i + 1}`));
    assert.deepEqual(order(steps, relations), Array.from({ length: count }, (_, i) => `n${i}`));
  });
});
