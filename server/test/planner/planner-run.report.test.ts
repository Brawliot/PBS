import { USER } from "../user-ids.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanner } from "../../planner/planner-run.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { DEFAULT_WHY } from "../../plan/checks.js";
import { ReportStoreError, type ReportRepository } from "../../plan/report-repository.js";
import { EMPTY_EXPLANATIONS, isExplanationCall, mockFetch, jsonResponse, silenceConsoleError } from "./helpers.js";
import "./helpers.js";

// The reports a run keeps: built from its own values, checked by parseReport, and linked by reportId

const input = { idea: "Bakery delivery", budget: 10_000, experience: 1, team: 1, hours: 1 };
const question = { topic: "validation", question: "Have you tested it with customers?", options: ["Yes", "No"] };
const answers = [{ topic: "validation", question: question.question, answer: "Yes, ten people" }];
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
    const content = isExplanationCall(request) ? EMPTY_EXPLANATIONS : phase2Reply(questions);
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
      explanations: { warningReasons: [], areaReasons: [] },
      diagnosis: {
        idea: input.idea,
        // Jev's reply has no answer for the four checks, so they are watch; money has no range (no glance): watch
        checks: [
          { key: "concept", status: "watch", why: DEFAULT_WHY.watch, estimated: true, decidedBy: "jev" },
          { key: "location", status: "watch", why: DEFAULT_WHY.watch, estimated: true, decidedBy: "jev" },
          { key: "money", status: "watch", why: DEFAULT_WHY.watch, estimated: true, decidedBy: "rule" },
          { key: "experience", status: "strong", why: DEFAULT_WHY.strong, estimated: false, decidedBy: "rule" },
          { key: "competition", status: "watch", why: DEFAULT_WHY.watch, estimated: true, decidedBy: "jev" },
        ],
        risks: ["Risks are not analysed yet."],
        split: { mando: [], you: [], outsource: [] },
      },
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

  test("the final request's checks come from Jev's answers and the range of the glance", async () => {
    const judging = { ...jevReply, answers: { ...jevReply.answers, concept: { type: "choice", choice: "Strong" }, competition: { type: "choice", choice: "Risk" } } };
    mockFetch((request) => {
      if (request.url.includes("typesafe.ai")) return jsonResponse(200, judging);
      return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(EMPTY_EXPLANATIONS) } }] });
    });
    const reports = new InMemoryReportRepository();
    const glance = {
      maturity: "developing" as const,
      subsectorSource: "stated" as const,
      location: { value: "Madrid", source: "stated" as const },
      budget: { min: 10_000, max: null, currency: "EUR", fits: "Enough" },
    };
    const result = (await runPlanner(input, answers, true, claims, { reports, owner: USER }, glance)) as Record<string, any>;
    const checks = (await reports.get(result.reportId, USER))?.report.diagnosis?.checks;
    const byKey = Object.fromEntries((checks ?? []).map((c: { key: string; status: string }) => [c.key, c.status]));
    // input.budget 10_000 is the minimum of the glance: strong. Experience 1 year: strong. Jev: concept strong, competition risk.
    assert.equal(byKey.money, "strong");
    assert.equal(byKey.experience, "strong");
    assert.equal(byKey.concept, "strong");
    assert.equal(byKey.competition, "risk");
    assert.equal(byKey.location, "watch");
  });

  test("the first round without questions keeps no diagnosis: the diagnosis is for the final request", async () => {
    mockOutside([]);
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, [], false, claims, { reports, owner: USER })) as Record<string, any>;
    const stored = await reports.get(result.reportId, USER);
    assert.equal("diagnosis" in (stored?.report ?? {}), false);
  });
});
