import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  intrinsicPhaseStatus,
  phaseOrderProblems,
  phaseProgress,
  phaseRelationProblems,
  phaseSpanProblems,
  phaseStatus,
  phaseTaskStatuses,
  timelineUnit,
} from "../../plan/phase-rules.js";
import type { Plan, Relation, Step, Task } from "../../plan/plan-model.js";

// Only the fields the rules read. Status comes from the steps, so a step is just its status here.
const step = (id: string, taskId: string, status: Step["status"]) => ({ id, taskId, status, events: [] }) as unknown as Step;
const task = (id: string, phaseId: string) => ({ id, phaseId, primaryDepartmentId: "legal" }) as Task;
const phase = (id: string, order: number, placement: { startUnit?: number; lengthUnits?: number } = {}) =>
  ({ id, name: id, order, ...placement }) as Plan["phases"][number];
const rel = (from: string, to: string, type: "blocks" | "follows"): Relation => ({ level: "phase", from, to, type }) as Relation;
const planOf = (parts: Partial<Plan>): Plan =>
  ({ departments: [], phases: [], tasks: [], steps: [], relations: [], ...parts }) as Plan;

// The Japanese restaurant: the timeline is in weeks, and the phases are placed on it
const RESTAURANT_TIMELINE = { unit: "week" } as const;
const restaurant = (parts: { relations?: Relation[]; steps?: Step[] } = {}) =>
  planOf({
    timeline: RESTAURANT_TIMELINE,
    phases: [phase("f1", 0, { startUnit: 0, lengthUnits: 8 }), phase("f2", 1, { startUnit: 6, lengthUnits: 10 }), phase("f3", 2, { startUnit: 16, lengthUnits: 8 })],
    tasks: [
      task("t-menu", "f1"),
      task("t-viability", "f1"),
      task("t-equipment", "f1"),
      task("t-permits", "f2"),
      task("t-premises", "f2"),
      task("t-opening", "f3"),
    ],
    steps: parts.steps ?? [
      step("s1", "t-menu", "done"),
      step("s2", "t-viability", "running"),
      step("s3", "t-equipment", "not_started"),
      step("s4", "t-permits", "not_started"),
      step("s5", "t-premises", "not_started"),
      step("s6", "t-opening", "not_started"),
    ],
    relations: parts.relations ?? [rel("f2", "f1", "follows"), rel("f2", "f3", "blocks")],
  });

describe("timelineUnit", () => {
  test("each answer of the timeline question has its unit", () => {
    assert.equal(timelineUnit("Ultra-fast (0-3m)"), "day");
    assert.equal(timelineUnit("Fast (3-6m)"), "week");
    assert.equal(timelineUnit("Normal (6-12m)"), "week");
    assert.equal(timelineUnit("Long (12-18m)"), "month");
    assert.equal(timelineUnit("Very long (18+m)"), "month");
    assert.equal(timelineUnit("Not specified"), "week");
  });

  test("an answer that is not in the table is a week, it never throws", () => {
    assert.equal(timelineUnit("Someday"), "week");
    assert.equal(timelineUnit(""), "week");
    assert.equal(timelineUnit("constructor"), "week");
    assert.equal(timelineUnit("__proto__"), "week");
  });

  test("an answer that differs in case or spacing is unknown", () => {
    assert.equal(timelineUnit("fast (3-6m)"), "week");
    assert.equal(timelineUnit("Ultra-fast (0-3m) "), "week");
  });
});

describe("phase status from its tasks", () => {
  test("a phase with no tasks is not started", () => {
    assert.equal(intrinsicPhaseStatus(planOf({ phases: [phase("f1", 0)] }), "f1"), "not_started");
    assert.equal(phaseStatus(planOf({ phases: [phase("f1", 0)] }), "f1"), "not_started");
  });

  test("all tasks done is done", () => {
    const plan = planOf({
      phases: [phase("f1", 0)],
      tasks: [task("a", "f1"), task("b", "f1")],
      steps: [step("s1", "a", "done"), step("s2", "b", "done")],
    });
    assert.equal(intrinsicPhaseStatus(plan, "f1"), "done");
  });

  test("a task in progress makes the phase in progress", () => {
    const plan = planOf({ phases: [phase("f1", 0)], tasks: [task("a", "f1")], steps: [step("s1", "a", "running")] });
    assert.equal(intrinsicPhaseStatus(plan, "f1"), "in_progress");
  });

  test("a done task with the rest unfinished is in progress", () => {
    const plan = planOf({
      phases: [phase("f1", 0)],
      tasks: [task("a", "f1"), task("b", "f1")],
      steps: [step("s1", "a", "done"), step("s2", "b", "not_started")],
    });
    assert.equal(intrinsicPhaseStatus(plan, "f1"), "in_progress");
  });

  test("only not started tasks, or only blocked ones, leave the phase not started", () => {
    const plan = planOf({
      phases: [phase("f1", 0)],
      tasks: [task("a", "f1"), task("b", "f1")],
      steps: [step("s1", "a", "not_started"), step("s2", "b", "rejected")],
    });
    assert.deepEqual(phaseTaskStatuses(plan, "f1"), ["not_started", "blocked"]);
    assert.equal(intrinsicPhaseStatus(plan, "f1"), "not_started");
  });

  test("only the tasks of the phase count", () => {
    const plan = planOf({
      phases: [phase("f1", 0), phase("f2", 1)],
      tasks: [task("a", "f1"), task("b", "f2")],
      steps: [step("s1", "a", "not_started"), step("s2", "b", "done")],
    });
    assert.equal(intrinsicPhaseStatus(plan, "f1"), "not_started");
    assert.equal(intrinsicPhaseStatus(plan, "f2"), "done");
  });
});

describe("phaseStatus: blocked", () => {
  const twoPhases = (relations: Relation[], startedStatus: Step["status"] | undefined = undefined) =>
    planOf({
      phases: [phase("f1", 0), phase("f2", 1)],
      tasks: [task("a", "f1"), task("b", "f2")],
      steps: [step("s1", "a", startedStatus ?? "not_started"), step("s2", "b", "not_started")],
      relations,
    });

  test("a phase not started is blocked while a phase that blocks it is not done", () => {
    assert.equal(phaseStatus(twoPhases([rel("f1", "f2", "blocks")]), "f2"), "blocked");
  });

  test("the blocking phase counts as done only when it is done", () => {
    assert.equal(phaseStatus(twoPhases([rel("f1", "f2", "blocks")], "done"), "f2"), "not_started");
  });

  test("a blocking phase that is in progress still blocks", () => {
    assert.equal(phaseStatus(twoPhases([rel("f1", "f2", "blocks")], "running"), "f2"), "blocked");
  });

  test("a phase already started is never blocked", () => {
    const plan = planOf({
      phases: [phase("f1", 0), phase("f2", 1)],
      tasks: [task("a", "f1"), task("b", "f2")],
      steps: [step("s1", "a", "not_started"), step("s2", "b", "running")],
      relations: [rel("f1", "f2", "blocks")],
    });
    assert.equal(phaseStatus(plan, "f2"), "in_progress");
  });

  test("a phase done is never blocked", () => {
    const plan = planOf({
      phases: [phase("f1", 0), phase("f2", 1)],
      tasks: [task("a", "f1"), task("b", "f2")],
      steps: [step("s1", "a", "not_started"), step("s2", "b", "done")],
      relations: [rel("f1", "f2", "blocks")],
    });
    assert.equal(phaseStatus(plan, "f2"), "done");
  });

  test("follows never blocks, in either direction", () => {
    assert.equal(phaseStatus(twoPhases([rel("f2", "f1", "follows")]), "f1"), "not_started");
    assert.equal(phaseStatus(twoPhases([rel("f1", "f2", "follows")]), "f2"), "not_started");
  });

  test("a blocking phase that does not exist counts as not done", () => {
    assert.equal(phaseStatus(twoPhases([rel("ghost", "f2", "blocks")]), "f2"), "blocked");
  });

  test("a phase without tasks that blocks another is not done, so it blocks it", () => {
    const plan = planOf({
      phases: [phase("f1", 0), phase("f2", 1)],
      tasks: [task("b", "f2")],
      steps: [step("s2", "b", "not_started")],
      relations: [rel("f1", "f2", "blocks")],
    });
    assert.equal(phaseStatus(plan, "f2"), "blocked");
  });
});

describe("phaseProgress", () => {
  test("a phase with no tasks has total 0 and percent 0", () => {
    assert.deepEqual(phaseProgress(planOf({ phases: [phase("f1", 0)] }), "f1"), { total: 0, done: 0, percent: 0 });
  });

  test("progress counts tasks, not steps or effort", () => {
    const plan = planOf({
      phases: [phase("f1", 0)],
      tasks: [task("a", "f1"), task("b", "f1"), task("c", "f1")],
      steps: [step("s1", "a", "done"), step("s2", "b", "running"), step("s3", "c", "not_started"), step("s4", "c", "done")],
    });
    assert.deepEqual(phaseProgress(plan, "f1"), { total: 3, done: 1, percent: 33 });
  });

  test("the percent is rounded to the nearest whole number", () => {
    const tasks = [task("a", "f1"), task("b", "f1"), task("c", "f1")];
    const two = planOf({
      phases: [phase("f1", 0)],
      tasks,
      steps: [step("s1", "a", "done"), step("s2", "b", "done"), step("s3", "c", "running")],
    });
    assert.deepEqual(phaseProgress(two, "f1"), { total: 3, done: 2, percent: 67 });
    const half = planOf({ phases: [phase("f1", 0)], tasks: [task("a", "f1"), task("b", "f1")], steps: [step("s1", "a", "done"), step("s2", "b", "not_started")] });
    assert.deepEqual(phaseProgress(half, "f1"), { total: 2, done: 1, percent: 50 });
  });

  test("all done is 100 percent", () => {
    const plan = planOf({ phases: [phase("f1", 0)], tasks: [task("a", "f1")], steps: [step("s1", "a", "done")] });
    assert.deepEqual(phaseProgress(plan, "f1"), { total: 1, done: 1, percent: 100 });
  });
});

describe("the Japanese restaurant", () => {
  test("the timeline is in weeks: Fast (3-6m)", () => {
    assert.equal(timelineUnit("Fast (3-6m)"), RESTAURANT_TIMELINE.unit);
  });

  test("f2 follows f1 and overlaps it, and that is valid", () => {
    assert.deepEqual(phaseSpanProblems(restaurant()), []);
  });

  test("f2 blocks f3 and f3 starts exactly when f2 ends, and that is valid", () => {
    // f2 starts at 6 with length 10, so it ends at 16, and f3 starts at 16
    assert.deepEqual(phaseSpanProblems(restaurant()), []);
    assert.deepEqual(phaseRelationProblems(restaurant().relations, restaurant().phases), []);
    assert.deepEqual(phaseOrderProblems(restaurant()), []);
  });

  test("the mix: menu done, viability in progress at 33 percent, the rest not started, f3 blocked", () => {
    const plan = restaurant();
    assert.deepEqual(phaseTaskStatuses(plan, "f1"), ["done", "in_progress", "not_started"]);
    assert.equal(phaseStatus(plan, "f1"), "in_progress");
    assert.deepEqual(phaseProgress(plan, "f1"), { total: 3, done: 1, percent: 33 });
    assert.equal(phaseStatus(plan, "f2"), "not_started");
    assert.deepEqual(phaseProgress(plan, "f2"), { total: 2, done: 0, percent: 0 });
    assert.equal(phaseStatus(plan, "f3"), "blocked");
    assert.deepEqual(phaseProgress(plan, "f3"), { total: 1, done: 0, percent: 0 });
  });

  test("when f2 is done, f3 is no longer blocked", () => {
    const plan = restaurant({
      steps: [
        step("s1", "t-menu", "done"),
        step("s2", "t-viability", "done"),
        step("s3", "t-equipment", "done"),
        step("s4", "t-permits", "done"),
        step("s5", "t-premises", "done"),
        step("s6", "t-opening", "not_started"),
      ],
    });
    assert.equal(phaseStatus(plan, "f2"), "done");
    assert.equal(phaseStatus(plan, "f3"), "not_started");
  });

  test("f3 starting one week before f2 ends is too early, and it names the relation", () => {
    const plan = restaurant();
    plan.phases[2] = phase("f3", 2, { startUnit: 15, lengthUnits: 8 });
    assert.deepEqual(phaseSpanProblems(plan), [{ code: "blocked_phase_starts_too_early", index: 1 }]);
  });

  test("f2 starting before f1 makes it follow its predecessor too early", () => {
    const plan = restaurant();
    plan.phases[1] = phase("f2", 1, { startUnit: 0, lengthUnits: 10 });
    plan.phases[0] = phase("f1", 0, { startUnit: 1, lengthUnits: 8 });
    assert.deepEqual(phaseSpanProblems(plan), [{ code: "follows_before_predecessor", index: 0 }]);
  });
});

describe("phaseRelationProblems", () => {
  const ids = (names: string[]) => names.map((id) => ({ id }));

  test("no relations means no problems", () => {
    assert.deepEqual(phaseRelationProblems([], ids(["f1"])), []);
  });

  test("a relation from or to an unknown phase is reported, with its position", () => {
    const relations = [rel("f1", "f2", "blocks"), rel("ghost", "f2", "blocks"), rel("f1", "phantom", "follows")];
    assert.deepEqual(phaseRelationProblems(relations, ids(["f1", "f2"])), [
      { code: "unknown_phase_from", index: 1 },
      { code: "unknown_phase_to", index: 2 },
    ]);
  });

  test("the same from, to and type twice is a duplicate, and only the second one is reported", () => {
    const relations = [rel("f1", "f2", "blocks"), rel("f1", "f2", "blocks")];
    assert.deepEqual(phaseRelationProblems(relations, ids(["f1", "f2"])), [{ code: "duplicate_relation", index: 1 }]);
  });

  test("the same pair with another type is not a duplicate (but follows against blocks is a cycle)", () => {
    const relations = [rel("f1", "f2", "blocks"), rel("f1", "f2", "follows")];
    assert.deepEqual(
      phaseRelationProblems(relations, ids(["f1", "f2"])).map((problem) => problem.code),
      ["cycle"],
    );
  });

  test("a cycle is reported once, with its ids", () => {
    const relations = [rel("f1", "f2", "blocks"), rel("f2", "f3", "blocks"), rel("f3", "f1", "blocks")];
    const problems = phaseRelationProblems(relations, ids(["f1", "f2", "f3"]));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].code, "cycle");
    assert.deepEqual([...(problems[0] as { ids: string[] }).ids].sort(), ["f1", "f2", "f3"]);
  });

  test("follows is read backwards: a follows b and a blocks b make a cycle", () => {
    const relations = [rel("f1", "f2", "follows"), rel("f1", "f2", "blocks")];
    const problems = phaseRelationProblems(relations, ids(["f1", "f2"]));
    assert.deepEqual(problems.map((problem) => problem.code), ["cycle"]);
  });

  test("a follows and a blocks that agree on the direction are not a cycle; one that disagrees is", () => {
    // f2 follows f1 puts f1 first, and f1 blocks f2 puts f1 first too: they agree
    assert.deepEqual(phaseRelationProblems([rel("f2", "f1", "follows"), rel("f1", "f2", "blocks")], ids(["f1", "f2"])), []);
    // f2 follows f1 puts f1 first, and f2 blocks f1 puts f2 first: they disagree
    assert.deepEqual(
      phaseRelationProblems([rel("f2", "f1", "follows"), rel("f2", "f1", "blocks")], ids(["f1", "f2"])).map((problem) => problem.code),
      ["cycle"],
    );
  });

  test("relations of other levels are skipped but still counted in the position", () => {
    const other = { level: "task", from: "a", to: "b", type: "blocks" } as Relation;
    const relations = [other, rel("ghost", "f1", "blocks")];
    assert.deepEqual(phaseRelationProblems(relations, ids(["f1"])), [{ code: "unknown_phase_from", index: 1 }]);
  });

  test("a problem never carries the content of the relation", () => {
    const problems = phaseRelationProblems([rel("secret-phase", "f1", "blocks")], ids(["f1"]));
    assert.equal(JSON.stringify(problems).includes("secret-phase"), false);
  });
});

describe("phaseOrderProblems", () => {
  test("two phases with the same order are reported at the second one", () => {
    const plan = planOf({ phases: [phase("f1", 0), phase("f2", 0)] });
    assert.deepEqual(phaseOrderProblems(plan), [{ code: "duplicate_order", index: 1 }]);
  });

  test("a blocks relation whose blocker comes after the blocked phase contradicts the order", () => {
    const plan = planOf({ phases: [phase("f1", 2), phase("f2", 1)], relations: [rel("f1", "f2", "blocks")] });
    assert.deepEqual(phaseOrderProblems(plan), [{ code: "order_contradicts_relation", index: 0 }]);
  });

  test("a follows relation reads backwards: a phase that follows another must come after it", () => {
    const ok = planOf({ phases: [phase("f1", 0), phase("f2", 1)], relations: [rel("f2", "f1", "follows")] });
    assert.deepEqual(phaseOrderProblems(ok), []);
    const broken = planOf({ phases: [phase("f1", 2), phase("f2", 1)], relations: [rel("f2", "f1", "follows")] });
    assert.deepEqual(phaseOrderProblems(broken), [{ code: "order_contradicts_relation", index: 0 }]);
  });

  test("equal orders do not contradict a relation: they are already a duplicate", () => {
    const plan = planOf({ phases: [phase("f1", 1), phase("f2", 1)], relations: [rel("f1", "f2", "blocks")] });
    assert.deepEqual(phaseOrderProblems(plan), [{ code: "duplicate_order", index: 1 }]);
  });
});

describe("phaseSpanProblems", () => {
  test("phases without a place on the timeline are not checked", () => {
    const plan = planOf({ phases: [phase("f1", 0), phase("f2", 1, { startUnit: 0 })], relations: [rel("f1", "f2", "blocks")] });
    assert.deepEqual(phaseSpanProblems(plan), []);
  });

  test("a blocked phase may start later than the end of its blocker", () => {
    const plan = planOf({
      phases: [phase("f1", 0, { startUnit: 0, lengthUnits: 4 }), phase("f2", 1, { startUnit: 9, lengthUnits: 4 })],
      relations: [rel("f1", "f2", "blocks")],
    });
    assert.deepEqual(phaseSpanProblems(plan), []);
  });

  test("a blocked phase that starts before its blocker ends is reported", () => {
    const plan = planOf({
      phases: [phase("f1", 0, { startUnit: 0, lengthUnits: 4 }), phase("f2", 1, { startUnit: 3, lengthUnits: 4 })],
      relations: [rel("f1", "f2", "blocks")],
    });
    assert.deepEqual(phaseSpanProblems(plan), [{ code: "blocked_phase_starts_too_early", index: 0 }]);
  });

  test("a phase that follows another may start at the same unit and overlap it", () => {
    const plan = planOf({
      phases: [phase("f1", 0, { startUnit: 2, lengthUnits: 4 }), phase("f2", 1, { startUnit: 2, lengthUnits: 4 })],
      relations: [rel("f2", "f1", "follows")],
    });
    assert.deepEqual(phaseSpanProblems(plan), []);
  });

  test("a phase with only a start and no length is not checked", () => {
    const plan = planOf({
      phases: [phase("f1", 0, { startUnit: 2 }), phase("f2", 1, { startUnit: 1 })],
      relations: [rel("f2", "f1", "follows")],
    });
    assert.deepEqual(phaseSpanProblems(plan), []);
  });

  test("a follower that starts before its predecessor is reported", () => {
    const plan = planOf({
      phases: [phase("f1", 0, { startUnit: 2, lengthUnits: 4 }), phase("f2", 1, { startUnit: 1, lengthUnits: 4 })],
      relations: [rel("f2", "f1", "follows")],
    });
    assert.deepEqual(phaseSpanProblems(plan), [{ code: "follows_before_predecessor", index: 0 }]);
  });
});
