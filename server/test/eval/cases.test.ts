import { test } from "node:test";
import assert from "node:assert/strict";
import { DIMENSION_KEYS, DIMENSION_OPTIONS } from "../../planner/planner-profile-handler.js";
import { isAllowedFact } from "../../plan/fact-catalog.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { evaluateExpectations, tasksByDepartment } from "../../eval/checks.js";
import { CASES, type EvalCase } from "../../eval/cases.js";
import type { Plan, Task } from "../../plan/plan-model.js";

test("every case has an idea, a report that builds a plan, and values that the profile accepts", () => {
  assert.equal(CASES.length, 4);
  for (const evalCase of CASES) {
    const report = evalCase.report();
    assert.ok(report.input.idea.length > 0);
    for (const key of DIMENSION_KEYS) {
      const value = report.profile.values[key];
      assert.ok(value === "Not specified" || DIMENSION_OPTIONS[key][value] !== undefined, `${evalCase.id}: ${key} = ${value} is not an option`);
    }
    assert.ok(buildPlanSkeleton(report).ok, `${evalCase.id} builds a skeleton`);
  }
});

test("every case confirms product_type, and each fact is one the catalogue allows", () => {
  for (const evalCase of CASES) {
    assert.ok(evalCase.facts.some((fact) => fact.key.kind === "catalog" && fact.key.id === "product_type"), `${evalCase.id} has product_type`);
    for (const fact of evalCase.facts) assert.equal(isAllowedFact(fact.key, fact.value), true, `${evalCase.id}: ${JSON.stringify(fact)}`);
  }
});

/** A task the agents proposed (origin ai), as the plan holds it */
function aiTask(id: string, title: string, departmentId: string): Task {
  return { id, phaseId: "prepare", primaryDepartmentId: departmentId, title, origin: { kind: "ai" }, confidence: 50, derivedFrom: ["fact-product-type"] } as Task;
}

function planWith(tasks: Task[]): Plan {
  const base = buildPlanSkeleton(CASES[0].report());
  if (!base.ok) throw new Error("no skeleton");
  return { ...base.plan, tasks: [...base.plan.tasks, ...tasks] };
}

test("an expectation passes when an AI task of an allowed department matches, and fails otherwise", () => {
  const restaurant = CASES[0] as EvalCase;
  const hit = planWith([aiTask("legal-a", "Solicitar la licencia de actividad", "legal")]);
  assert.equal(evaluateExpectations(restaurant.expectations, hit)[0].passed, true);

  const otherDepartment = planWith([aiTask("marketing-a", "Solicitar la licencia de actividad", "marketing")]);
  assert.equal(evaluateExpectations(restaurant.expectations, otherDepartment)[0].passed, false, "the department must be one of the allowed ones");

  const unrelated = planWith([aiTask("legal-b", "Contratar a un abogado de empresa", "legal")]);
  assert.equal(evaluateExpectations(restaurant.expectations, unrelated)[0].passed, false);
});

test("a rule task of the skeleton never meets an expectation: only the agents' tasks count", () => {
  const restaurant = CASES[0] as EvalCase;
  const base = buildPlanSkeleton(restaurant.report());
  if (!base.ok) throw new Error("no skeleton");
  const ruleTask = base.plan.tasks.find((task) => /licen/i.test(task.title) && task.primaryDepartmentId === "legal");
  assert.ok(ruleTask, "the skeleton has a licence task, so the test means something");
  assert.equal(evaluateExpectations(restaurant.expectations, base.plan)[0].passed, false);
});

test("the marketplace expectation reads the payments, and a non-payment title fails", () => {
  const marketplace = CASES.find((item) => item.id === "marketplace") as EvalCase;
  const pays = planWith([aiTask("finance-a", "Revisar los cobros y los pagos a los profesionales", "finance")]);
  assert.equal(evaluateExpectations(marketplace.expectations, pays)[0].passed, true);
  const design = planWith([aiTask("finance-b", "Presupuestar el diseño del logotipo", "finance")]);
  assert.equal(evaluateExpectations(marketplace.expectations, design)[0].passed, false);
});

test("the titles per department are the first three AI titles, in plan order", () => {
  const plan = planWith([
    aiTask("legal-a", "Uno", "legal"),
    aiTask("legal-b", "Dos", "legal"),
    aiTask("legal-c", "Tres", "legal"),
    aiTask("legal-d", "Cuatro", "legal"),
  ]);
  const legal = tasksByDepartment(plan)["Legal & Compliance"];
  assert.deepEqual(legal, ["Uno", "Dos", "Tres"]);
});
