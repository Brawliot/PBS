import { USER } from "../user-ids.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanner } from "../../planner/planner-run.js";
import type { PlannerInput } from "../../planner/planner-handler.js";
import type { Glance } from "../../plan/glance.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { REASONLESS_EXPLANATIONS, isExplanationCall, mockFetch, jsonResponse, type CapturedRequest } from "./helpers.js";
import "./helpers.js";

// The clarity of a run: computed from the glance (the sources of phase 2), the profile, the fixed questions and
// the topics answered. The first round and the final request give the same clarity for the same data, a final
// glance without sources gives none, and an "I don't know" is no signal for the models.

const input: PlannerInput = { idea: "Bakery delivery", budget: 10_000, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const};
const answers = [{ topic: "own_skills", question: "Can you bake?", answer: "Yes, for ten years" }];

const jevReply = {
  model: "test",
  answers: {
    sector: { type: "choice", choice: "Hospitality/Food service" },
    geographic_scope: { type: "choice", choice: "Local" },
    timeline: { type: "choice", choice: "Fast (3-6m)" },
    customer_segment: { type: "choice", choice: "Consumers" },
    founder_profile: { type: "choice", choice: "Sector expert" },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
};

const section = (value: string, source: "stated" | "inferred" | "unknown" = "stated", confidence = 80) => ({ value, source, confidence });
const phase2Reply = {
  maturity: "developing",
  subsector: section("Bakery"),
  location: section("Madrid", "inferred"),
  target_customer: section("Households", "inferred", 60),
  value_proposition: section("Fresh bread at home"),
  revenue_model: section("unknown", "unknown", 0),
  stage: section("Idea only"),
  competition: section("Local bakeries"),
  constraints: { budget: { min: 5_000, max: 9_000, currency: "EUR", fits: "Enough for a first version" }, exclusions: [], risks: [], assumptions: [] },
  questions: [],
};

function mockOutside(): CapturedRequest[] {
  return mockFetch((request) => {
    if (request.url.includes("typesafe.ai")) return jsonResponse(200, jevReply);
    const content = isExplanationCall(request) ? REASONLESS_EXPLANATIONS : phase2Reply;
    return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
  });
}

const bodyText = (call: CapturedRequest) => JSON.stringify(call.body ?? "");

describe("runPlanner: the clarity", () => {
  test("a first round with no questions left returns the clarity and keeps it in the report", async () => {
    mockOutside();
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, false, {}, { reports, owner: USER })) as Record<string, any>;

    assert.equal(result.clarity.version, 2);
    // Offer, value, stage and competition said; customer and place inferred; money unknown
    assert.equal(result.clarity.concept.level, "medium");
    assert.deepEqual(result.clarity.person, {
      level: "medium",
      score: 73,
      missing: ["Handling other people's money", "Fixed deadline", "Existing assets"],
      essentialMissing: false,
    });
    const stored = await reports.get(result.reportId, USER);
    assert.deepEqual(stored?.report.clarity, result.clarity);
  });

  test("the final request gives the same clarity for the same data, from the glance the browser sends back", async () => {
    mockOutside();
    const first = (await runPlanner(input, answers, false, {}, { owner: USER })) as Record<string, any>;
    mockOutside();
    const final = (await runPlanner(input, answers, true, {}, { owner: USER }, first.glance as Glance)) as Record<string, any>;

    assert.ok(first.clarity);
    assert.deepEqual(final.clarity, first.clarity);
  });

  test("a final glance without the sources gives no clarity, and the report is still kept", async () => {
    mockOutside();
    const first = (await runPlanner(input, answers, false, {}, { owner: USER })) as Record<string, any>;
    const { sources: _, ...older } = first.glance as Glance;
    mockOutside();
    const reports = new InMemoryReportRepository();
    const final = (await runPlanner(input, answers, true, {}, { reports, owner: USER }, older)) as Record<string, any>;

    assert.equal("clarity" in final, false);
    const stored = await reports.get(final.reportId, USER);
    assert.equal("clarity" in (stored?.report ?? {}), false);
  });
});

describe('runPlanner: an "I don\'t know" in the fixed questions', () => {
  const unsure: PlannerInput = { ...input, budget: 0, unknown: ["budget", "start_mode"] };

  test("is printed as unknown to the models, and the checks that need it are not asked", async () => {
    const calls = mockOutside();
    const result = (await runPlanner(unsure, answers, false, {}, { owner: USER })) as Record<string, any>;

    for (const call of calls) {
      assert.match(bodyText(call), /budget_eur\\":\\"unknown/);
      assert.match(bodyText(call), /start_mode\\":\\"unknown/);
    }
    const phase2 = calls.find((call) => !call.url.includes("typesafe.ai") && !isExplanationCall(call));
    assert.match(bodyText(phase2!), /does not know their budget yet/);
    const validation = calls.find((call) => bodyText(call).includes("check_consistency"));
    assert.ok(validation);
    assert.doesNotMatch(bodyText(validation), /check_budget_fit/);
    assert.match(bodyText(validation), /check_team_fit/);
    assert.equal(result.validation.warnings.includes("budget_fit"), false);

    // No budget: no sentence on how it fits, and the person's clarity lists what is missing
    assert.equal(result.glance.budget.fits, "");
    assert.equal(result.glance.budget.min, 5_000);
    assert.deepEqual(result.clarity.person.missing, ["Budget", "How you start", "Handling other people's money"]);
    assert.equal(result.clarity.person.level, "low"); // budget and start unknown, premises and skills still to say
  });

  test("with nothing flagged, the models see the numbers as before", async () => {
    const calls = mockOutside();
    await runPlanner(input, answers, false, {}, { owner: USER });
    for (const call of calls) assert.match(bodyText(call), /location\\":\\"Madrid\\",\\"budget_eur\\":10000,\\"start_mode\\":\\"scratch\\",\\"premises\\":\\"have\\"/);
    assert.ok(calls.some((call) => bodyText(call).includes("check_budget_fit")));
    assert.ok(calls.every((call) => !bodyText(call).includes("does not know their budget")));
  });
});

describe('runPlanner: the whole path with "I don\'t know" in every fixed question', () => {
  const everyUnknown: PlannerInput = {
    idea: "Tapas bar",
    location: "",
    budget: 0,
    start_mode: "scratch",
    premises: "have",
    unknown: ["location", "budget", "start_mode", "premises"],
  };

  test("the first round and the final request both keep the four as unknown in the report", async () => {
    mockOutside();
    const reports = new InMemoryReportRepository();
    const first = (await runPlanner(everyUnknown, answers, false, {}, { reports, owner: USER })) as Record<string, any>;
    const storedFirst = await reports.get(first.reportId, USER);
    assert.deepEqual(storedFirst?.report.input.unknown, ["location", "budget", "start_mode", "premises"]);
    assert.equal(storedFirst?.report.input.location, "");
    assert.equal(storedFirst?.report.clarity?.person.level, "low");
    assert.ok(storedFirst?.report.clarity?.person.missing.includes("How you start"));

    const final = (await runPlanner(everyUnknown, answers, true, {}, { reports, owner: USER })) as Record<string, any>;
    const storedFinal = await reports.get(final.reportId, USER);
    assert.deepEqual(storedFinal?.report.input.unknown, ["location", "budget", "start_mode", "premises"]);
    assert.equal(storedFinal?.report.input.premises, "have");
  });
});

describe('runPlanner: "undecided" and "unsure" are answers, not missing data', () => {
  test("they are kept as they are, and the clarity does not list them as missing", async () => {
    mockOutside();
    const reports = new InMemoryReportRepository();
    const input: PlannerInput = { ...everyDecided(), start_mode: "undecided", premises: "unsure" };
    const result = (await runPlanner(input, answers, false, {}, { reports, owner: USER })) as Record<string, any>;
    const stored = await reports.get(result.reportId, USER);
    assert.equal(stored?.report.input.start_mode, "undecided");
    assert.equal(stored?.report.input.premises, "unsure");
    assert.equal("unknown" in (stored?.report.input ?? {}), false);
    assert.equal(stored?.report.clarity?.person.missing.includes("How you start"), false);
    assert.equal(stored?.report.clarity?.person.missing.includes("Premises"), false);
  });
});

function everyDecided(): PlannerInput {
  return { idea: "Tapas bar", location: "Malasaña, Madrid", budget: 50_000, start_mode: "scratch" as const, premises: "have" as const };
}
