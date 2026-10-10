import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildDepartmentInput } from "../../../plan/agents/department-input.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import { proposeFact } from "../../../plan/fact-actions.js";
import { parsePlan, type Plan } from "../../../plan/plan-model.js";
import { NOW, now, planWithFact } from "./fakes.js";

const IDEA = "A Japanese restaurant with a bar";
const output = (version: number, state: "draft" | "confirmed", summary: string) => ({
  version,
  state,
  summary,
  questions: [],
  createdAt: NOW,
  ...(state === "confirmed" ? { confirmedAt: NOW } : {}),
});

/**
 * The restaurant plan with two AI steps of finance that feed legal's permits step: s-viability has a confirmed
 * output, and s-draft (a copy) has only a draft, which must never be sent
 */
function withOutputs(plan: Plan): Plan {
  const viability = plan.steps.find((step) => step.id === "s-viability")!;
  const draft = { ...viability, id: "s-draft", outputs: [output(1, "draft", "Unchecked draft")] };
  return parsePlan({
    ...plan,
    steps: [
      ...plan.steps.map((step) => (step.id === "s-viability" ? { ...step, outputs: [output(1, "confirmed", "Viable at 40 covers")] } : step)),
      draft,
    ],
    relations: [...plan.relations, { level: "step", from: "s-draft", to: "s-permits", type: "feeds" }],
  });
}

describe("the input of one department", () => {
  test("an unknown department has no input", () => {
    assert.equal(buildDepartmentInput(restaurantPlan(), "nobody", IDEA), undefined);
  });

  test("the context has the idea and only the confirmed facts, never a proposed one", () => {
    const { plan } = planWithFact();
    const proposed = proposeFact(plan, { key: { kind: "other", text: "Parking" }, value: { kind: "other", text: "Yes" } }, { now, actor: "user" });
    if (!proposed.ok) throw new Error(proposed.code);
    const input = buildDepartmentInput(proposed.plan, "legal", IDEA)!;
    assert.equal(input.context.idea, IDEA);
    assert.deepEqual(
      input.context.facts.map((fact) => fact.key),
      [{ kind: "catalog", id: "product_type" }],
    );
  });

  test("own tasks are the department's only, and the phases are all of the plan's", () => {
    const input = buildDepartmentInput(restaurantPlan(), "legal", IDEA)!;
    assert.deepEqual(input.ownTasks.map((task) => task.id), ["t-menu", "t-permits"]);
    assert.deepEqual(input.phases.map((phase) => phase.id), ["f1", "f2", "f3"]);
    assert.equal(input.department.name, "Legal & Compliance");
  });

  test("the confirmed output of an AI step of another department that feeds this one is sent, never a draft", () => {
    const plan = withOutputs(restaurantPlan());
    const legal = buildDepartmentInput(plan, "legal", IDEA)!;
    assert.deepEqual(legal.confirmedOutputs, [{ stepId: "s-viability", departmentId: "finance", summary: "Viable at 40 covers" }]);
    assert.equal(JSON.stringify(legal).includes("Unchecked draft"), false);
  });

  test("a department gets no outputs from departments it does not depend on", () => {
    const input = buildDepartmentInput(withOutputs(restaurantPlan()), "finance", IDEA)!;
    assert.deepEqual(input.confirmedOutputs, []);
  });

  test("the order relations that touch the department come with their aspect text", () => {
    const plan = restaurantPlan();
    assert.deepEqual(buildDepartmentInput(plan, "legal", IDEA)!.aspects, [{ from: "legal", to: "finance", type: "blocks", aspect: "budget" }]);
    assert.deepEqual(buildDepartmentInput(plan, "finance", IDEA)!.aspects, [{ from: "legal", to: "finance", type: "blocks", aspect: "budget" }]);
  });

  test("a pending proposal of another department is never in the input", () => {
    const { plan, factId } = planWithFact();
    const withOther = parsePlan({
      ...plan,
      proposals: [
        {
          id: "agent-finance",
          status: "pending",
          reason: { factId },
          add: {
            tasks: [{ id: "finance-secret", phaseId: "f1", primaryDepartmentId: "finance", title: "Secret plan", origin: { kind: "ai" }, confidence: 50, derivedFrom: [factId] }],
            steps: [],
            relations: [],
          },
          createdAt: NOW,
        },
      ],
    });
    const input = buildDepartmentInput(withOther, "legal", IDEA)!;
    assert.equal(JSON.stringify(input).includes("Secret plan"), false);
  });
});
