import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, type Plan } from "../../plan/plan-model.js";
import { departmentNode, phaseNode, taskNode } from "../../plan/plan-tree.js";

const origin = { kind: "rule" } as const;
const t = (id: string, phaseId: string, primary: string) => ({
  id, phaseId, primaryDepartmentId: primary, title: id, origin, confidence: 100,
});
const s = (id: string, taskId: string, departmentId: string) => ({
  id, taskId, departmentId, text: id, executor: "third_party", evidence: { kind: "none" }, effortHours: 1, waitDays: 0,
  status: "not_started", events: [], origin, confidence: 100,
});

// legal: t1 (f1), t3 (f2) | product: t2 (f1), t4 (f1) | finance: no task of its own
// A department participates in a task through its steps: t1 involves product and finance (s3, s6),
// t2 involves legal (s4); t3 has no steps
const plan: Plan = parsePlan({
  departments: [
    { id: "legal", name: "Legal", tier: "core" },
    { id: "product", name: "Product", tier: "important" },
    { id: "finance", name: "Finance", tier: "light" },
  ],
  phases: [
    { id: "f1", name: "Set up", order: 0 },
    { id: "f2", name: "Launch", order: 1 },
    { id: "f3", name: "Empty", order: 2 },
  ],
  tasks: [
    t("t1", "f1", "legal"),
    t("t2", "f1", "product"),
    t("t3", "f2", "legal"),
    t("t4", "f1", "product"),
  ],
  steps: [
    s("s1", "t1", "legal"),
    s("s2", "t2", "product"),
    s("s3", "t1", "product"),
    s("s4", "t2", "legal"),
    s("s5", "t4", "product"),
    s("s6", "t1", "finance"),
  ],
  relations: [],
});

const ids = (nodes: { task: { id: string } }[]) => nodes.map((n) => n.task.id);
const stepIds = (nodes: { steps: { id: string }[] }[]) => nodes.map((n) => n.steps.map((x) => x.id));

describe("taskNode", () => {
  test("returns the task with all its steps, whatever their department, in plan order", () => {
    const result = taskNode(plan, "t1");
    assert.equal(result?.task.id, "t1");
    assert.deepEqual(result?.steps.map((x) => x.id), ["s1", "s3", "s6"]);
  });

  test("a task without steps has an empty list", () => {
    assert.deepEqual(taskNode(plan, "t3")?.steps, []);
  });

  test("an unknown id gives undefined", () => {
    assert.equal(taskNode(plan, "nope"), undefined);
  });
});

describe("departmentNode", () => {
  test("separates the tasks it is responsible for from those it takes part in", () => {
    const legal = departmentNode(plan, "legal");
    assert.equal(legal?.department.name, "Legal");
    assert.deepEqual(ids(legal!.responsible), ["t1", "t3"]);
    assert.deepEqual(ids(legal!.participates), ["t2"]);
  });

  test("every task carries all its steps, not only the ones of that department", () => {
    const legal = departmentNode(plan, "legal")!;
    assert.deepEqual(stepIds(legal.responsible), [["s1", "s3", "s6"], []]);
    assert.deepEqual(stepIds(legal.participates), [["s2", "s4"]]);
  });

  test("a department with no tasks of its own only participates", () => {
    const finance = departmentNode(plan, "finance")!;
    assert.deepEqual(ids(finance.responsible), []);
    assert.deepEqual(ids(finance.participates), ["t1"]);
  });

  test("a department with several steps in a task takes part once", () => {
    const more = parsePlan({ ...plan, steps: [...plan.steps, s("s7", "t1", "finance"), s("s8", "t1", "finance")] });
    assert.deepEqual(ids(departmentNode(more, "finance")!.participates), ["t1"]);
  });

  test("a department does not participate in a task it is responsible for, even with steps there", () => {
    const legal = departmentNode(plan, "legal")!;
    assert.ok(plan.steps.some((x) => x.taskId === "t1" && x.departmentId === "legal"));
    assert.ok(!ids(legal.participates).includes("t1"));
  });

  test("a task is never both responsible and participating", () => {
    for (const { id } of plan.departments) {
      const node = departmentNode(plan, id)!;
      const both = ids(node.responsible).filter((task) => ids(node.participates).includes(task));
      assert.deepEqual(both, [], id);
    }
  });

  test("an unknown id gives undefined", () => {
    assert.equal(departmentNode(plan, "nope"), undefined);
  });
});

describe("phaseNode", () => {
  test("groups the tasks by primary department, in the order of the departments", () => {
    const f1 = phaseNode(plan, "f1")!;
    assert.equal(f1.phase.name, "Set up");
    assert.deepEqual(f1.groups.map((g) => g.department.id), ["legal", "product"]);
    assert.deepEqual(f1.groups.map((g) => ids(g.tasks)), [["t1"], ["t2", "t4"]]);
  });

  test("each task carries its steps", () => {
    const f1 = phaseNode(plan, "f1")!;
    assert.deepEqual(f1.groups.map((g) => stepIds(g.tasks)), [[["s1", "s3", "s6"]], [["s2", "s4"], ["s5"]]]);
  });

  test("leaves out the tasks of other phases and the departments with none", () => {
    const f2 = phaseNode(plan, "f2")!;
    assert.deepEqual(f2.groups.map((g) => g.department.id), ["legal"]);
    assert.deepEqual(f2.groups.map((g) => ids(g.tasks)), [["t3"]]);
  });

  test("a phase without tasks has no groups", () => {
    assert.deepEqual(phaseNode(plan, "f3")?.groups, []);
  });

  test("every task appears exactly once across the groups", () => {
    const seen = plan.phases.flatMap(({ id }) => phaseNode(plan, id)!.groups.flatMap((g) => ids(g.tasks)));
    assert.deepEqual(seen.sort(), ["t1", "t2", "t3", "t4"]);
  });

  test("an unknown id gives undefined", () => {
    assert.equal(phaseNode(plan, "nope"), undefined);
  });
});
