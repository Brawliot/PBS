import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { departmentProgress, departmentRelationProblems } from "../../plan/department-rules.js";
import type { DepartmentNode, TaskNode } from "../../plan/plan-tree.js";
import type { Plan, Step, Task } from "../../plan/plan-model.js";

const DEPARTMENTS = [{ id: "legal" }, { id: "finance" }, { id: "marketing" }];
type Relation = Plan["relations"][number];

const dep = (from: string, to: string, aspect: Extract<Relation, { level: "department" }>["aspect"], type: "blocks" | "follows" = "blocks"): Relation =>
  ({ level: "department", from, to, type, aspect }) as Relation;
const catalog = (id: string) => ({ kind: "catalog", id }) as const;

describe("departmentRelationProblems", () => {
  test("no relations means no problems", () => {
    assert.deepEqual(departmentRelationProblems([], DEPARTMENTS), []);
  });

  test("a cross pair with different aspects, and a cycle, are valid", () => {
    const relations = [
      dep("legal", "finance", catalog("contracts")),
      dep("finance", "legal", catalog("pricing")),
      dep("legal", "marketing", catalog("brand")),
      dep("marketing", "legal", catalog("data-protection")),
      dep("legal", "finance", catalog("budget")),
    ];
    assert.deepEqual(departmentRelationProblems(relations, DEPARTMENTS), []);
  });

  test("an aspect 'other' is accepted without being in the catalog", () => {
    const relations = [dep("legal", "finance", { kind: "other", note: "Tax residency rules" })];
    assert.deepEqual(departmentRelationProblems(relations, DEPARTMENTS), []);
  });

  test("a catalog aspect that does not exist is reported with its position among department relations", () => {
    const relations = [dep("legal", "finance", catalog("contracts")), dep("legal", "marketing", catalog("gossip"))];
    assert.deepEqual(departmentRelationProblems(relations, DEPARTMENTS), [{ code: "unknown_aspect", index: 1 }]);
  });

  test("a from or to that is not a department of the plan is reported", () => {
    const relations = [dep("ghost", "finance", catalog("contracts")), dep("legal", "phantom", catalog("contracts"))];
    assert.deepEqual(departmentRelationProblems(relations, DEPARTMENTS), [
      { code: "unknown_department_from", index: 0 },
      { code: "unknown_department_to", index: 1 },
    ]);
  });

  test("two identical relations are a duplicate, and only the second one is reported", () => {
    const relations = [dep("legal", "finance", catalog("contracts")), dep("legal", "finance", catalog("contracts"))];
    assert.deepEqual(departmentRelationProblems(relations, DEPARTMENTS), [{ code: "duplicate_relation", index: 1 }]);
  });

  test("the same pair with another type or another aspect is not a duplicate", () => {
    const relations = [
      dep("legal", "finance", catalog("contracts"), "blocks"),
      dep("legal", "finance", catalog("contracts"), "follows"),
      dep("legal", "finance", catalog("pricing"), "blocks"),
      dep("legal", "finance", { kind: "other", note: "contracts" }, "blocks"),
    ];
    assert.deepEqual(departmentRelationProblems(relations, DEPARTMENTS), []);
  });

  test("task, phase and step relations are not checked here", () => {
    const relations = [
      { level: "task", from: "ghost", to: "phantom", type: "blocks" },
      { level: "phase", from: "a", to: "b", type: "follows" },
    ] as Relation[];
    assert.deepEqual(departmentRelationProblems(relations, DEPARTMENTS), []);
  });

  test("a problem never carries the content of the relation, only its code and position", () => {
    const problems = departmentRelationProblems([dep("ghost", "finance", catalog("secret-aspect"))], DEPARTMENTS);
    assert.deepEqual(problems, [
      { code: "unknown_aspect", index: 0 },
      { code: "unknown_department_from", index: 0 },
    ]);
    assert.equal(JSON.stringify(problems).includes("secret-aspect"), false);
  });
});

// Builds a task node directly: departmentProgress reads only the steps and their statuses
const step = (id: string, status: Step["status"]) => ({ id, status, events: [] }) as unknown as Step;
const taskNode = (id: string, steps: Step[]): TaskNode => ({ task: { id } as Task, steps });
const departmentNode = (responsible: TaskNode[], participates: TaskNode[] = []): DepartmentNode => ({
  department: { id: "legal", name: "Legal & Compliance", tier: "core" },
  responsible,
  participates,
});

describe("departmentProgress", () => {
  test("a department with no responsible tasks has all counts at zero", () => {
    assert.deepEqual(departmentProgress(departmentNode([]), []), { total: 0, notStarted: 0, inProgress: 0, blocked: 0, done: 0 });
  });

  test("counts each responsible task once by its status", () => {
    const node = departmentNode([
      taskNode("t-empty", []), // no steps: not started
      taskNode("t-new", [step("a", "not_started"), step("b", "not_started")]), // not started
      taskNode("t-running", [step("c", "running")]), // in progress
      taskNode("t-waiting", [step("d", "done"), step("e", "waiting_user")]), // in progress
      taskNode("t-rejected", [step("f", "rejected")]), // blocked: nothing left that can start
      taskNode("t-done", [step("g", "done"), step("h", "done")]), // done
    ]);
    assert.deepEqual(departmentProgress(node, []), {
      total: 6,
      notStarted: 2,
      inProgress: 2,
      blocked: 1,
      done: 1,
    });
  });

  test("tasks where the department only participates do not count", () => {
    const node = departmentNode(
      [taskNode("t-done", [step("a", "done")])],
      [taskNode("t-other", [step("b", "running")]), taskNode("t-other-2", [step("c", "rejected")])],
    );
    assert.deepEqual(departmentProgress(node, []), { total: 1, notStarted: 0, inProgress: 0, blocked: 0, done: 1 });
  });

  test("the counts always add up to the total", () => {
    const node = departmentNode([
      taskNode("x", [step("a", "running")]),
      taskNode("y", [step("b", "rejected")]),
      taskNode("z", []),
    ]);
    const progress = departmentProgress(node, []);
    assert.equal(progress.notStarted + progress.inProgress + progress.blocked + progress.done, progress.total);
  });
});
