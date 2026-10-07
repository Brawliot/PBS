import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Plan, Step, Task } from "../../plan/plan-model.js";
import { applyStepAction } from "../../plan/step-actions.js";
import {
  WORKDAY_HOURS,
  summarizeTask,
  taskAutomation,
  taskDepartments,
  taskEffortHours,
  taskElapsedDays,
  taskStatus,
} from "../../plan/task-rules.js";

const T1 = "2026-10-07T10:00:00Z";
const origin = { kind: "rule" } as const;
const day = (days: number) => days * WORKDAY_HOURS; // hours that take this many working days
const step = (id: string, overrides: Record<string, unknown> = {}): Step =>
  ({
    id,
    taskId: "t1",
    departmentId: "legal",
    text: id,
    executor: "user",
    mode: "online",
    evidence: { kind: "none" },
    effortHours: 0,
    waitDays: 0,
    status: "not_started",
    events: [],
    origin,
    confidence: 100,
    ...overrides,
  }) as Step;
const ai = (id: string, overrides: Record<string, unknown> = {}) => step(id, { executor: "ai", mode: undefined, ...overrides });
const third = (id: string, overrides: Record<string, unknown> = {}) => step(id, { executor: "third_party", mode: undefined, ...overrides });
const rel = (type: "blocks" | "follows" | "feeds", from: string, to: string) => ({ level: "step", type, from, to }) as Plan["relations"][number];
const task = { id: "t1", phaseId: "f1", primaryDepartmentId: "legal", title: "A task", origin, confidence: 100 } as Task;
const confirmed = { version: 1, state: "confirmed", summary: "S", questions: [], createdAt: T1, confirmedAt: T1 };

describe("taskStatus: the precedence, branch by branch", () => {
  test("1. no steps: not started, whatever the relations", () => {
    assert.equal(taskStatus([], []), "not_started");
    assert.equal(taskStatus([], [rel("blocks", "a", "b")]), "not_started");
  });

  test("2. all done: done", () => {
    assert.equal(taskStatus([step("a", { status: "done" })], []), "done");
    assert.equal(taskStatus([step("a", { status: "done" }), ai("b", { status: "done" })], [rel("blocks", "a", "b")]), "done");
  });

  test("3. any active step: in progress, even with a rejected or blocked step beside it", () => {
    for (const status of ["running", "waiting_user", "waiting_third_party"]) {
      assert.equal(taskStatus([step("a", { status })], []), "in_progress", status);
      assert.equal(taskStatus([step("a", { status }), step("b", { status: "rejected" })], []), "in_progress", status);
      assert.equal(taskStatus([step("a", { status }), step("b")], [rel("blocks", "a", "b")]), "in_progress", status);
    }
  });

  test("3. a done step with others unfinished: in progress, whatever the others are", () => {
    for (const other of ["not_started", "rejected"]) {
      assert.equal(taskStatus([step("a", { status: "done" }), step("b", { status: other })], []), "in_progress", other);
    }
    // not started and still blocked by a step that is not in the task's way of being done
    assert.equal(taskStatus([step("a", { status: "done" }), step("b"), step("c", { status: "rejected" })], [rel("blocks", "c", "b")]), "in_progress");
  });

  test("4. nothing active and no step ready to start: blocked", () => {
    // a rejected step that was not reopened blocks what depends on it
    assert.equal(taskStatus([step("a", { status: "rejected" }), step("b")], [rel("blocks", "a", "b")]), "blocked");
    // only rejected steps: nothing can start
    assert.equal(taskStatus([step("a", { status: "rejected" })], []), "blocked");
    assert.equal(taskStatus([step("a", { status: "rejected" }), step("b", { status: "rejected" })], []), "blocked");
    // a cycle leaves every step with an unmet blocker
    assert.equal(taskStatus([step("a"), step("b")], [rel("blocks", "a", "b"), rel("blocks", "b", "a")]), "blocked");
    // a feeder without a confirmed output
    assert.equal(taskStatus([ai("a", { status: "rejected" }), step("b")], [rel("feeds", "a", "b")]), "blocked");
  });

  test("5. otherwise not started: some step that has not started is ready", () => {
    assert.equal(taskStatus([step("a")], []), "not_started");
    assert.equal(taskStatus([step("a"), step("b")], [rel("blocks", "a", "b")]), "not_started"); // a is ready
    assert.equal(taskStatus([step("a", { status: "rejected" }), step("b")], []), "not_started"); // b is ready
    assert.equal(taskStatus([step("a"), step("b")], [rel("follows", "b", "a")]), "not_started"); // follows never blocks
  });

  test("a feeder with a confirmed output does not block", () => {
    const feeder = ai("a", { status: "rejected", outputs: [confirmed] });
    assert.equal(taskStatus([feeder, step("b")], [rel("feeds", "a", "b")]), "not_started");
  });

  test("relations that do not join two steps of the task are ignored", () => {
    assert.equal(taskStatus([step("a")], [rel("blocks", "x", "a")]), "not_started"); // x belongs to another task
    assert.equal(taskStatus([step("a")], [rel("blocks", "a", "x")]), "not_started");
    assert.equal(taskStatus([step("a")], [rel("blocks", "x", "y"), rel("blocks", "y", "x")]), "not_started");
    assert.equal(taskStatus([step("a", { status: "rejected" }), step("b")], [rel("blocks", "x", "b"), rel("blocks", "a", "b")]), "blocked");
  });

  test("task and department relations are not step relations", () => {
    const relations = [{ level: "task", type: "blocks", from: "a", to: "b" }] as Plan["relations"];
    assert.equal(taskStatus([step("a"), step("b")], relations), "not_started");
  });
});

describe("taskAutomation", () => {
  test("no steps: undefined", () => {
    assert.equal(taskAutomation([]), undefined);
  });

  test("only AI steps: automatic", () => {
    assert.equal(taskAutomation([ai("a")]), "automatic");
    assert.equal(taskAutomation([ai("a"), ai("b")]), "automatic");
  });

  test("no AI step: manual, and a third party counts as not AI", () => {
    assert.equal(taskAutomation([step("a")]), "manual");
    assert.equal(taskAutomation([third("a")]), "manual");
    assert.equal(taskAutomation([step("a"), third("b")]), "manual");
  });

  test("a mix: hybrid, with a user or a third party", () => {
    assert.equal(taskAutomation([ai("a"), step("b")]), "hybrid");
    assert.equal(taskAutomation([third("a"), ai("b")]), "hybrid");
    assert.equal(taskAutomation([ai("a"), step("b"), third("c")]), "hybrid");
  });

  test("changing the executor of a step changes the mode of the task", () => {
    const toAi = (s: Step) => {
      const result = applyStepAction(s, "change_executor", { now: () => T1, actor: "user", readiness: "not_applicable", feedsOthers: false, payload: { executor: "ai" } });
      assert.ok(result.ok);
      return result.step;
    };
    const toUser = (s: Step) => {
      const result = applyStepAction(s, "change_executor", { now: () => T1, actor: "user", readiness: "not_applicable", feedsOthers: false, payload: { executor: "user", mode: "online" } });
      assert.ok(result.ok);
      return result.step;
    };
    const a = step("a");
    const b = ai("b");
    assert.equal(taskAutomation([a]), "manual");
    assert.equal(taskAutomation([toAi(a)]), "automatic");
    assert.equal(taskAutomation([toAi(a), b]), "automatic");
    assert.equal(taskAutomation([a, b]), "hybrid");
    assert.equal(taskAutomation([a, toUser(b)]), "manual");
    // the step changed is the one that counts, not the original
    assert.equal(taskAutomation([toAi(a), toUser(b)]), "hybrid");
  });
});

describe("taskEffortHours", () => {
  test("no steps: 0", () => {
    assert.equal(taskEffortHours([]), 0);
  });

  test("the sum of the efforts, whatever the relations, status or executor", () => {
    assert.equal(taskEffortHours([step("a", { effortHours: 2 })]), 2);
    assert.equal(taskEffortHours([step("a", { effortHours: 2 }), ai("b", { effortHours: 3, status: "done" }), third("c", { effortHours: 0.5, waitDays: 9 })]), 5.5);
  });
});

describe("taskElapsedDays", () => {
  const days = (steps: Step[], relations: Plan["relations"] = []) => taskElapsedDays(steps, relations);

  test("no steps: 0", () => {
    assert.deepEqual(days([]), { ok: true, days: 0 });
  });

  test("one step: its work in working days plus its wait", () => {
    assert.deepEqual(days([step("a")]), { ok: true, days: 0 });
    assert.deepEqual(days([step("a", { effortHours: WORKDAY_HOURS })]), { ok: true, days: 1 });
    assert.deepEqual(days([step("a", { effortHours: WORKDAY_HOURS / 2 })]), { ok: true, days: 0.5 });
    assert.deepEqual(days([step("a", { waitDays: 3 })]), { ok: true, days: 3 });
    assert.deepEqual(days([step("a", { effortHours: day(2), waitDays: 3 })]), { ok: true, days: 5 });
  });

  test("independent steps are not added: the longest counts", () => {
    assert.deepEqual(days([step("a", { effortHours: day(1) }), step("b", { effortHours: day(2) }), step("c", { waitDays: 1.5 })]), { ok: true, days: 2 });
  });

  test("a chain adds up, with blocks and with feeds", () => {
    const steps = [step("a", { effortHours: day(1) }), step("b", { effortHours: day(2) }), step("c", { waitDays: 4 })];
    assert.deepEqual(days(steps, [rel("blocks", "a", "b"), rel("blocks", "b", "c")]), { ok: true, days: 7 });
    assert.deepEqual(days(steps, [rel("blocks", "a", "b"), rel("blocks", "b", "c")].reverse()), { ok: true, days: 7 });
    const [a, b, c] = [ai("a", { effortHours: day(1) }), step("b", { effortHours: day(2) }), step("c", { waitDays: 4 })];
    assert.deepEqual(days([a, b, c], [rel("feeds", "a", "b"), rel("blocks", "b", "c")]), { ok: true, days: 7 });
  });

  test("a chain given in the opposite order of the list still adds up", () => {
    const steps = [step("c", { waitDays: 4 }), step("b", { effortHours: day(2) }), step("a", { effortHours: day(1) })];
    assert.deepEqual(days(steps, [rel("blocks", "a", "b"), rel("blocks", "b", "c")]), { ok: true, days: 7 });
  });

  test("a diamond takes its longest side", () => {
    const build = (b: number, c: number) => [step("a", { effortHours: day(1) }), step("b", { effortHours: day(b) }), step("c", { effortHours: day(c) }), step("d", { effortHours: day(1) })];
    const diamond = [rel("blocks", "a", "b"), rel("blocks", "a", "c"), rel("blocks", "b", "d"), rel("blocks", "c", "d")];
    assert.deepEqual(days(build(2, 5), diamond), { ok: true, days: 7 });
    assert.deepEqual(days(build(5, 2), diamond), { ok: true, days: 7 });
    assert.deepEqual(days(build(3, 3), diamond), { ok: true, days: 5 });
  });

  test("follows sets an order but adds no time", () => {
    const steps = [step("a", { effortHours: day(1) }), step("b", { effortHours: day(2) })];
    assert.deepEqual(days(steps, [rel("follows", "b", "a")]), { ok: true, days: 2 });
    assert.deepEqual(days(steps, [rel("blocks", "a", "b")]), { ok: true, days: 3 });
  });

  test("the Permisos case: 2h + 3h + 21 days of waiting + 1h, in a chain", () => {
    const steps = [step("a", { effortHours: 2 }), step("b", { effortHours: 3 }), third("c", { waitDays: 21 }), step("d", { effortHours: 1 })];
    const chain = [rel("blocks", "a", "b"), rel("blocks", "b", "c"), rel("blocks", "c", "d")];
    assert.equal(WORKDAY_HOURS, 8);
    assert.deepEqual(days(steps, chain), { ok: true, days: 21.75 });
    assert.deepEqual(days(steps, chain), { ok: true, days: 6 / WORKDAY_HOURS + 21 });
    // the same steps with nothing between them do not add: the 21 days alone
    assert.deepEqual(days(steps), { ok: true, days: 21 });
  });

  test("a cycle is an error result with its ids, not an exception", () => {
    const steps = [step("a"), step("b"), step("c")];
    assert.deepEqual(days(steps, [rel("blocks", "a", "b"), rel("blocks", "b", "a")]), { ok: false, code: "cycle", ids: ["a", "b"] });
    // a cycle through follows is still a cycle
    assert.deepEqual(days(steps, [rel("blocks", "b", "c"), rel("follows", "b", "c")]), { ok: false, code: "cycle", ids: ["b", "c"] });
  });

  test("relations that do not join two steps of the task are ignored, cycles among them too", () => {
    const steps = [step("a", { effortHours: day(1) }), step("b", { effortHours: day(2) })];
    assert.deepEqual(days(steps, [rel("blocks", "x", "a"), rel("blocks", "b", "y"), rel("blocks", "x", "y"), rel("blocks", "y", "x")]), { ok: true, days: 2 });
  });

  test("the status of the steps does not change the time", () => {
    assert.deepEqual(days([step("a", { effortHours: day(1), status: "done" })]), { ok: true, days: 1 });
  });
});

describe("taskDepartments", () => {
  test("the primary one, and the others of the steps in order of first appearance, without repeats", () => {
    const steps = [
      step("a", { departmentId: "finance" }),
      step("b", { departmentId: "legal" }),
      step("c", { departmentId: "hr" }),
      step("d", { departmentId: "finance" }),
      step("e", { departmentId: "product" }),
      step("f", { departmentId: "hr" }),
    ];
    assert.deepEqual(taskDepartments(task, steps), { primary: "legal", secondary: ["finance", "hr", "product"] });
  });

  test("the primary department is never secondary, and steps only of it give no secondary", () => {
    assert.deepEqual(taskDepartments(task, [step("a"), step("b")]), { primary: "legal", secondary: [] });
  });

  test("no steps: the primary one alone", () => {
    assert.deepEqual(taskDepartments(task, []), { primary: "legal", secondary: [] });
  });

  test("the primary department stays even when none of the steps is its own", () => {
    assert.deepEqual(taskDepartments(task, [step("a", { departmentId: "finance" })]), { primary: "legal", secondary: ["finance"] });
  });
});

describe("summarizeTask", () => {
  test("gives everything together (the Permisos case)", () => {
    const steps = [
      step("a", { effortHours: 2, status: "done" }),
      ai("b", { effortHours: 3, departmentId: "finance", status: "running" }),
      third("c", { waitDays: 21 }),
      step("d", { effortHours: 1 }),
    ];
    const relations = [rel("blocks", "a", "b"), rel("blocks", "b", "c"), rel("blocks", "c", "d"), rel("blocks", "x", "y")];
    assert.deepEqual(summarizeTask(task, steps, relations), {
      status: "in_progress",
      automation: "hybrid",
      effortHours: 6,
      elapsed: { ok: true, days: 21.75 },
      departments: { primary: "legal", secondary: ["finance"] },
    });
  });

  test("a task without steps", () => {
    assert.deepEqual(summarizeTask(task, [], []), {
      status: "not_started",
      automation: undefined,
      effortHours: 0,
      elapsed: { ok: true, days: 0 },
      departments: { primary: "legal", secondary: [] },
    });
  });

  test("a cycle shows in the elapsed time and nowhere else", () => {
    const summary = summarizeTask(task, [step("a", { effortHours: 2 }), step("b")], [rel("blocks", "a", "b"), rel("blocks", "b", "a")]);
    assert.deepEqual(summary.elapsed, { ok: false, code: "cycle", ids: ["a", "b"] });
    assert.equal(summary.status, "blocked");
    assert.equal(summary.effortHours, 2);
  });

  test("does not change what it receives", () => {
    const steps = [step("a", { effortHours: 2 }), ai("b")];
    const relations = [rel("blocks", "a", "b")];
    const before = structuredClone({ steps, relations });
    summarizeTask(task, steps, relations);
    assert.deepEqual({ steps, relations }, before);
  });
});
