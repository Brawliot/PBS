import { USER } from "../user-ids.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { glanceOf, runPlanner } from "../../planner/planner-run.js";
import type { Phase2Response } from "../../planner/planner-phase2-handler.js";
import type { Glance } from "../../plan/glance.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { REASONLESS_EXPLANATIONS, isExplanationCall, mockFetch, jsonResponse } from "./helpers.js";
import "./helpers.js";

// The glance of a run: a final request keeps the glance the browser sends (checked by the request parser), and a
// first round builds its own from its phase 2. The browser's glance is never used by a first round.

const input = { idea: "Bakery delivery", budget: 10_000, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const};
const answers = [{ topic: "existing_customers", question: "Do you already have customers?", answer: "Yes, ten people" }];

const jevReply = {
  model: "test",
  answers: {
    sector: { type: "choice", choice: "Hospitality/Food service" },
    geographic_scope: { type: "choice", choice: "Local" },
    timeline: { type: "choice", choice: "Fast (3-6m)" },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
};

const section = (value: string, source: "stated" | "inferred" | "unknown" = "stated", confidence = 80) => ({ value, source, confidence });
const phase2Reply = (budget: Phase2Response["constraints"]["budget"]) => ({
  maturity: "developing",
  subsector: section("Bakery"),
  location: section("Madrid", "inferred"),
  target_customer: section("Households", "inferred", 60),
  value_proposition: section("Fresh bread at home"),
  revenue_model: section("Commission per order", "unknown", 0),
  stage: section("Idea only"),
  competition: section("Local bakeries with delivery apps"),
  constraints: { budget, exclusions: [], risks: ["Competition"], assumptions: ["Ovens are available"] },
  questions: [],
});

const budget = { min: 5_000, max: 9_000, currency: "EUR", fits: "Enough for a first version" };
const serverGlance: Glance = {
  maturity: "developing",
  subsectorSource: "stated",
  location: { value: "Madrid", source: "inferred" },
  budget,
  sources: { target_customer: "inferred", value_proposition: "stated", revenue_model: "unknown", stage: "stated", competition: "stated" },
};

/** Mocks every outside call: Jev, the explanations, and phase 2 with the given budget */
function mockOutside(options: { budget?: Phase2Response["constraints"]["budget"]; questions?: unknown[] } = {}) {
  return mockFetch((request) => {
    if (request.url.includes("typesafe.ai")) return jsonResponse(200, jevReply);
    const content = isExplanationCall(request)
      ? REASONLESS_EXPLANATIONS
      : { ...phase2Reply(options.budget ?? budget), questions: options.questions ?? [] };
    return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
  });
}

// What the browser sends, from its own copy of the first round: a different maturity, to show it is not used
const browserGlance: Glance = { ...serverGlance, maturity: "vague", location: { value: "Lisbon", source: "stated" } };

describe("runPlanner: the glance of a final request", () => {
  test("the glance the browser sends is returned and kept in the report", async () => {
    mockOutside();
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, true, {}, { reports, owner: USER }, browserGlance)) as Record<string, any>;

    assert.deepEqual(result.glance, browserGlance);
    const stored = await reports.get(result.reportId, USER);
    assert.deepEqual(stored?.report.glance, browserGlance);
    assert.equal("phase2" in (stored?.report ?? {}), false, "the final report still has no phase 2");
  });

  test("a final request without a glance returns and keeps none", async () => {
    mockOutside();
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, true, {}, { reports, owner: USER })) as Record<string, unknown>;

    assert.equal("glance" in result, false);
    const stored = await reports.get(result.reportId as string, USER);
    assert.equal("glance" in (stored?.report ?? {}), false);
  });
});

describe("runPlanner: the glance of a first round", () => {
  test("a first round without questions builds its glance from its own phase 2", async () => {
    mockOutside();
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, [], false, {}, { reports, owner: USER })) as Record<string, any>;

    assert.deepEqual(result.glance, serverGlance);
    const stored = await reports.get(result.reportId, USER);
    assert.deepEqual(stored?.report.glance, serverGlance);
  });

  test("a first round never takes a glance from the browser", async () => {
    mockOutside();
    const result = (await runPlanner(input, [], false, {}, { owner: USER }, browserGlance)) as Record<string, any>;

    assert.deepEqual(result.glance, serverGlance);
  });

  test("a first round with questions carries the server's own glance, never the browser's", async () => {
    mockOutside({ questions: [{ topic: "existing_customers", question: "Do you already have customers?", options: ["Yes", "No"] }] });
    const result = (await runPlanner(input, [], false, {}, { owner: USER }, browserGlance)) as Record<string, any>;

    assert.ok(result.glance, "the browser sends it back with the final request");
    assert.notDeepEqual(result.glance, browserGlance);
    assert.equal(result.glance.maturity, "developing");
  });

  test("a phase 2 budget that does not pass the glance schema leaves it out, and the report is still kept", async () => {
    mockOutside({ budget: { min: 9_000, max: 5_000, currency: "EUR", fits: "Not enough" } });
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, [], false, {}, { reports, owner: USER })) as Record<string, unknown>;

    assert.equal("glance" in result, false);
    assert.equal(typeof result.reportId, "string");
    const stored = await reports.get(result.reportId as string, USER);
    assert.equal("glance" in (stored?.report ?? {}), false);
  });
});

describe("glanceOf", () => {
  test("is built from the phase 2 of the run, with its fields only", () => {
    const phase2 = phase2Reply(budget) as unknown as Phase2Response;
    assert.deepEqual(glanceOf(phase2), serverGlance);
  });
});
