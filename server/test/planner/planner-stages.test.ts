import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanner } from "../../planner/planner-run.js";
import type { PlannerStage } from "../../planner/stages.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { REASONLESS_EXPLANATIONS, isExplanationCall, mockFetch, jsonResponse, type CapturedRequest } from "./helpers.js";
import { USER } from "../user-ids.js";
import "./helpers.js";

const input = { idea: "Bakery delivery", budget: 10_000, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const };
const jevReply = jsonResponse(200, {
  answers: {
    sector: { type: "choice", choice: "Hospitality/Food service" },
    geographic_scope: { type: "choice", choice: "Local" },
    timeline: { type: "choice", choice: "Not specified" },
  },
});
const isJev = (call: CapturedRequest) => call.url.includes("typesafe");
const section = (value: string) => ({ value, source: "stated", confidence: 80 });
/** A phase 2 reply with one question, so a first request stops after phase 2 */
const phase2 = () => ({
  maturity: "developing",
  subsector: section("Bakery"),
  location: section("Madrid"),
  target_customer: section("Households"),
  value_proposition: section("Fresh bread"),
  revenue_model: { value: "unknown", source: "unknown", confidence: 0 },
  stage: section("Idea only"),
  competition: section("Bakeries"),
  constraints: { budget: { min: null, max: null, currency: "EUR", fits: "" }, exclusions: [], risks: [], assumptions: [] },
  questions: [{ topic: "partners", question: "Will you have partners?", options: [] }],
  execution: [],
});

/** Every step the run reported, in order */
function run(final: boolean, options: { jev?: unknown } = {}) {
  mockFetch((request) => {
    if (isJev(request)) return jevReply.clone();
    const content = isExplanationCall(request) ? REASONLESS_EXPLANATIONS : phase2();
    return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
  });
  const steps: PlannerStage[] = [];
  const reports = new InMemoryReportRepository();
  return {
    steps,
    result: runPlanner(input as never, [], final, {} as never, { reports, owner: USER, report: (stage: PlannerStage) => steps.push(stage), ...options } as never, undefined),
  };
}

describe("runPlanner: the steps it reports", () => {
  test("a final request reports reading, costs, explaining and saving, in that order", async () => {
    const { steps, result } = run(true);
    await result;
    assert.deepEqual(steps, ["reading", "costs", "explaining", "saving"]);
  });

  test("a first request reports reading only: it asks the questions and nothing else is built", async () => {
    const { steps, result } = run(false);
    await result;
    assert.deepEqual(steps, ["reading"]);
  });

  test("a reused Jev result is still the reading step, without asking Jev again", async () => {
    const calls: CapturedRequest[] = [];
    mockFetch((request) => {
      calls.push(request);
      return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ error: "not used" }) } }] });
    });
    const steps: PlannerStage[] = [];
    const jev = { answers: { sector: { type: "choice" as const, choice: "Other" } } };
    await runPlanner(input as never, [], false, {} as never, { owner: USER, jev, report: (stage: PlannerStage) => steps.push(stage) } as never, undefined)
      .catch(() => undefined);
    assert.deepEqual(steps, ["reading"]);
    assert.equal(calls.filter(isJev).length, 0);
  });
});
