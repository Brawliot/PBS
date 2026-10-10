import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRelations } from "../../eval/checks.js";
import { parsePlan, type Plan } from "../../plan/plan-model.js";
import { planWithFact } from "../plan/agents/fakes.js";

/**
 * The restaurant plan with an AI task of legal ("Register the business") that comes before "Obtain the licences",
 * a task the department already has (not proposed by the AI). The report must print both titles, never an id.
 */
function planWithRelationToExisting(): Plan {
  const { plan } = planWithFact();
  const phaseId = plan.phases[0].id;
  return parsePlan({
    ...plan,
    tasks: [
      ...plan.tasks,
      { id: "obtain-licences", phaseId, primaryDepartmentId: plan.departments[0].id, title: "Obtain the licences", origin: { kind: "rule" }, confidence: 100 },
      {
        id: "legal-register-business",
        phaseId,
        primaryDepartmentId: plan.departments[0].id,
        title: "Register the business",
        origin: { kind: "ai" },
        confidence: 50,
        derivedFrom: [plan.facts![0].id],
      },
    ],
    relations: [...plan.relations, { level: "task", from: "legal-register-business", to: "obtain-licences", type: "blocks" }],
  });
}

test("a relation between a proposed task and an existing one is printed with both titles", () => {
  const { tasks } = describeRelations(planWithRelationToExisting());
  assert.ok(tasks.includes("«Register the business» debe estar lista antes que «Obtain the licences»"), tasks.join("\n"));
});

test("the same relation written as 'follows' is printed in the right direction", () => {
  const plan = planWithRelationToExisting();
  const reversed: Plan = {
    ...plan,
    relations: plan.relations.map((relation) =>
      relation.level === "task" && relation.from === "legal-register-business" ? { ...relation, from: "obtain-licences", to: "legal-register-business", type: "follows" } : relation,
    ),
  };
  const { tasks } = describeRelations(reversed);
  assert.ok(tasks.includes("«Register the business» debe estar lista antes que «Obtain the licences»"), tasks.join("\n"));
});

test("no sentence ever shows a raw id or 'undefined' for a task that is in the plan", () => {
  const { tasks } = describeRelations(planWithRelationToExisting());
  for (const text of tasks) {
    assert.ok(!text.includes("legal-register-business"), text);
    assert.ok(!text.includes("obtain-licences"), text);
    assert.ok(!text.includes("undefined"), text);
  }
});
