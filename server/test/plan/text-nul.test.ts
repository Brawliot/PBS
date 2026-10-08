/** The NUL character is refused by the text of the plan and of the report: PostgreSQL cannot store it in jsonb */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PlanSchema } from "../../plan/plan-model.js";
import { parseReport } from "../../plan/report.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { reportWith } from "./report-fixtures.js";

const NUL_TEXT = "Mesa\u0000junto a la ventana";

describe("the plan refuses NUL in its text", () => {
  test("the restaurant plan is valid, as the baseline", () => {
    assert.ok(PlanSchema.safeParse(restaurantPlan()).success);
  });

  test("a NUL in a step text is refused", () => {
    const plan = restaurantPlan();
    plan.steps[0] = { ...plan.steps[0], text: NUL_TEXT };
    assert.equal(PlanSchema.safeParse(plan).success, false);
  });

  test("a NUL in a task title and in a department name is refused", () => {
    const plan = restaurantPlan();
    plan.tasks[0] = { ...plan.tasks[0], title: `Permiso${"\u0000"}local` };
    assert.equal(PlanSchema.safeParse(plan).success, false);
    const other = restaurantPlan();
    other.departments[0] = { ...other.departments[0], name: `Legal${"\u0000"}` };
    assert.equal(PlanSchema.safeParse(other).success, false);
  });

  test("the same text without NUL is accepted", () => {
    const plan = restaurantPlan();
    plan.steps[0] = { ...plan.steps[0], text: NUL_TEXT.replace("\u0000", " ") };
    assert.ok(PlanSchema.safeParse(plan).success);
  });
});

describe("the report refuses NUL in its text", () => {
  const withText = (text: string) => {
    const report = reportWith() as Record<string, unknown>;
    report.phase2 = {
      maturity: "vague",
      subsector: { value: text, source: "stated", confidence: 80 },
      location: { value: "Madrid", source: "stated", confidence: 80 },
      target_customer: { value: "Households", source: "stated", confidence: 80 },
      value_proposition: { value: "Bread", source: "stated", confidence: 80 },
      revenue_model: { value: "", source: "unknown", confidence: 0 },
      stage: { value: "Idea only", source: "stated", confidence: 80 },
      competition: { value: "Bakeries", source: "stated", confidence: 80 },
      constraints: {
        budget: { min: null, max: null, currency: "EUR", fits: "Enough" },
        exclusions: [],
        risks: [text],
        assumptions: [],
      },
      questions: [],
    };
    return JSON.stringify(report);
  };

  test("a report with NUL in a phase 2 text is not valid", () => {
    assert.equal(parseReport(withText(NUL_TEXT)).ok, false);
  });

  test("the same report without NUL is valid", () => {
    assert.equal(parseReport(withText(NUL_TEXT.replace("\u0000", " "))).ok, true);
  });

  test("a NUL in the report's answers and in the idea is refused too", () => {
    const report = reportWith() as unknown as { answers: unknown[]; input: { idea: string } };
    report.answers = [{ topic: "a", question: "b", answer: `c${"\u0000"}` }];
    assert.equal(parseReport(JSON.stringify(report)).ok, false);
    const withIdea = reportWith() as unknown as { input: { idea: string } };
    withIdea.input.idea = `Pan${"\u0000"}`;
    assert.equal(parseReport(JSON.stringify(withIdea)).ok, false);
  });
});
