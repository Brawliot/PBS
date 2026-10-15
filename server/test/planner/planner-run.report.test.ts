import { USER } from "../user-ids.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanner } from "../../planner/planner-run.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { ReportStoreError, type ReportRepository } from "../../plan/report-repository.js";
import { REASONLESS_EXPLANATIONS, isExplanationCall, mockFetch, jsonResponse, silenceConsoleError } from "./helpers.js";
import "./helpers.js";

// The reports a run keeps: built from its own values, checked by parseReport, and linked by reportId

const input = { idea: "Bakery delivery", budget: 10_000, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const};
const question = { topic: "existing_customers", question: "Do you already have customers?", options: ["Yes", "No"] };
const answers = [{ topic: "existing_customers", question: question.question, answer: "Yes, ten people" }];
const claims = { subsector: "Bakery" };

const jevReply = {
  model: "test",
  answers: {
    sector: { type: "choice", choice: "Hospitality/Food service" },
    geographic_scope: { type: "choice", choice: "Local" },
    timeline: { type: "choice", choice: "Fast (3-6m)" },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
};
const section = (value: string, source = "stated", confidence = 80) => ({ value, source, confidence });
const phase2Reply = (questions: unknown[]) => ({
  maturity: "developing",
  subsector: section("Bakery"),
  location: section("Madrid"),
  target_customer: section("Households", "inferred", 60),
  value_proposition: section("Fresh bread at home"),
  revenue_model: section("Commission per order", "unknown", 0),
  stage: section("Idea only"),
  competition: section("Local bakeries with delivery apps"),
  constraints: {
    budget: { min: 5_000, max: null, currency: "EUR", fits: "Enough for a first version" },
    exclusions: [],
    risks: ["Competition"],
    assumptions: ["Ovens are available"],
  },
  questions,
});
function mockOutside(questions: unknown[]) {
  mockFetch((request) => {
    if (request.url.includes("typesafe.ai")) return jsonResponse(200, jevReply);
    const content = isExplanationCall(request) ? REASONLESS_EXPLANATIONS : phase2Reply(questions);
    return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
  });
}

describe("runPlanner keeps the report of the runs that end with one", () => {
  test("the final request keeps a report from its own values, with no phase 2, and returns the reportId", async () => {
    mockOutside([]);
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, true, claims, { reports, owner: USER })) as Record<string, unknown>;
    assert.equal(typeof result.reportId, "string");
    const stored = await reports.get(result.reportId as string, USER);
    assert.deepEqual(stored?.report, {
      input,
      answers,
      jev: result.jev,
      profile: result.profile,
      validation: result.validation,
      explanations: REASONLESS_EXPLANATIONS,
    });
    assert.equal("phase2" in (stored?.report ?? {}), false);
  });

  test("the first round without questions keeps a report that includes phase 2 with no questions", async () => {
    mockOutside([]);
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, [], false, claims, { reports, owner: USER })) as Record<string, any>;
    const stored = await reports.get(result.reportId, USER);
    assert.deepEqual(stored?.report.phase2, { ...phase2Reply([]), questions: [] });
    assert.deepEqual(stored?.report.input, input);
    assert.deepEqual(stored?.report.answers, []);
    assert.deepEqual(stored?.report.profile, result.profile);
  });

  test("the first round with questions keeps no report and returns no reportId", async () => {
    mockOutside([question]);
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, [], false, claims, { reports, owner: USER })) as Record<string, unknown>;
    assert.equal("reportId" in result, false);
    assert.equal(reports.rows.size, 0);
  });

  test("without a repository the run works as before, with no reportId", async () => {
    mockOutside([]);
    const result = (await runPlanner(input, [], false, claims, { owner: USER })) as Record<string, unknown>;
    assert.equal("reportId" in result, false);
    assert.ok(result.profile);
  });

  test("a report that cannot be kept does not fail the run: no reportId, and only the code is logged", async () => {
    mockOutside([]);
    const secret = "SECRET-CONTENT-41c9";
    const failing: ReportRepository = {
      create: async () => {
        throw Object.assign(new Error(`insert failed for ${secret}`), { code: "23505" });
      },
      get: async () => undefined,
      getByPlanId: async () => undefined,
      attachPlan: async () => ({ ok: false, code: "not_found" }),
    };
    const log = silenceConsoleError();
    const result = (await runPlanner(input, [], false, claims, { reports: failing, owner: USER })) as Record<string, unknown>;
    assert.equal("reportId" in result, false);
    assert.ok(result.profile, "the run still returns its report");
    assert.deepEqual(log.mock.calls.map((call) => call.arguments), [["Report not kept:", "23505"]]);
    assert.equal(JSON.stringify(log.mock.calls).includes(secret), false);
  });

  test("a report the store refuses (not parseReport) is not kept and the run still answers", async () => {
    mockOutside([]);
    const refusing: ReportRepository = {
      create: async () => {
        throw new ReportStoreError("invalid_report");
      },
      get: async () => undefined,
      getByPlanId: async () => undefined,
      attachPlan: async () => ({ ok: false, code: "not_found" }),
    };
    const log = silenceConsoleError();
    const result = (await runPlanner(input, [], false, claims, { reports: refusing, owner: USER })) as Record<string, unknown>;
    assert.equal("reportId" in result, false);
    assert.deepEqual(log.mock.calls.map((call) => call.arguments), [["Report not kept:", "invalid_report"]]);
  });
});
