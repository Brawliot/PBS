/**
 * The phase 2 part of a report is fitted to the report's limits, so no planner answer can stop a report from
 * being kept, and the plan (which does not read phase 2) comes out the same with or without it.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fitPhase2, fitText, reportOf, runPlanner } from "../../planner/planner-run.js";
import type { Phase2Response } from "../../planner/planner-phase2-handler.js";
import { parseReport, MAX_CURRENCY, MAX_PHASE2_LIST, MAX_PHASE2_TEXT, MAX_PHASE2_QUESTIONS, MAX_PHASE2_OPTIONS } from "../../plan/report.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { reportWith } from "../plan/report-fixtures.js";
import { prng } from "../plan/prng.js";
import { mockFetch, jsonResponse, silenceConsoleError } from "./helpers.js";
import "./helpers.js";

const input = { idea: "Bakery delivery", budget: 10_000, experience: 1, team: 1, hours: 1 };
const answers = [{ topic: "validation", question: "Have you tested it?", answer: "Yes" }];
const { profile, validation } = reportWith();
const built = { profile, validation } as never;
const jev = reportWith().jev as never;

const section = (value: string) => ({ value, source: "stated" as const, confidence: 80 });

/** A phase 2 answer that the planner's own schema accepts, with the given long parts */
function phase2With(options: { text?: string; risks?: number; currency?: string; questions?: number } = {}): Phase2Response {
  const text = options.text ?? "Bakery";
  const questions = Array.from({ length: options.questions ?? 0 }, (_, index) => ({
    topic: "validation" as const,
    question: `${text} question ${index}`,
    options: ["Yes", "No"],
  }));
  return {
    maturity: "developing",
    subsector: section(text),
    location: section("Madrid"),
    target_customer: section("Households"),
    value_proposition: section(text),
    revenue_model: { value: "", source: "unknown", confidence: 0 },
    stage: section("Idea only"),
    competition: section(text),
    constraints: {
      budget: { min: 5_000, max: null, currency: options.currency ?? "EUR", fits: text },
      exclusions: [],
      risks: Array.from({ length: options.risks ?? 0 }, (_, index) => `risk ${index} ${text}`),
      assumptions: ["Ovens are available"],
    },
    questions,
  } as Phase2Response;
}

/** The report exactly as the store would keep it: JSON text, through parseReport */
const kept = (phase2?: Phase2Response) => parseReport(JSON.stringify(reportOf(input, answers, jev, built, phase2)));

describe("fitText", () => {
  test("cuts to the limit in UTF-16 units and removes NUL", () => {
    assert.equal(fitText("abcdef", 4), "abcd");
    assert.equal(fitText("ab\u0000cd", 10), "abcd");
    assert.equal(fitText("", 4), "");
  });

  test("never splits a pair of surrogates", () => {
    const cut = fitText("😀".repeat(5), 3);
    assert.equal(cut, "😀");
    assert.equal(cut.length, 2);
    assert.equal(fitText("a😀", 2), "a");
  });
});

describe("fitPhase2 cuts each part to the report's limits", () => {
  test("texts of 1,200 characters become 1,000", () => {
    const fitted = fitPhase2(phase2With({ text: "x".repeat(1_200) }));
    assert.equal(fitted.subsector.value.length, MAX_PHASE2_TEXT);
    assert.equal(fitted.constraints.budget.fits.length, MAX_PHASE2_TEXT);
  });

  test("25 risks become 20", () => {
    assert.equal(fitPhase2(phase2With({ risks: 25 })).constraints.risks.length, MAX_PHASE2_LIST);
  });

  test("a currency of 12 characters becomes 10", () => {
    assert.equal(fitPhase2(phase2With({ currency: "E".repeat(12) })).constraints.budget.currency.length, MAX_CURRENCY);
  });

  test("more than 4 questions become 4, and a question left empty is dropped", () => {
    const phase2 = phase2With({ questions: 6 });
    phase2.questions[0] = { ...phase2.questions[0], question: "   " };
    const fitted = fitPhase2(phase2);
    assert.equal(fitted.questions.length, MAX_PHASE2_QUESTIONS);
    assert.ok(fitted.questions.every((question) => question.question.trim() !== ""));
    assert.ok(fitted.questions.every((question) => question.options.length <= MAX_PHASE2_OPTIONS));
  });

  test("the NUL character is removed from every text", () => {
    const fitted = fitPhase2(phase2With({ text: "a\u0000b" }));
    assert.equal(fitted.subsector.value, "ab");
    assert.equal(JSON.stringify(fitted).includes("\\u0000"), false);
  });

  test("a fitted part that was already within the limits is unchanged", () => {
    const phase2 = phase2With({ risks: 3 });
    assert.deepEqual(fitPhase2(phase2), { ...phase2, questions: [] });
  });
});

describe("the report keeps phase 2 whatever its size", () => {
  const cases = [
    { text: "x".repeat(1_200) },
    { risks: 25 },
    { currency: "EURO-EURO-E" },
    { questions: 5 },
    { text: "😀".repeat(600), risks: 25, currency: "E".repeat(12) },
    { text: "a\u0000b".repeat(400), questions: 6 },
  ];
  for (const options of cases) {
    test(`report with ${JSON.stringify(options).slice(0, 60)} is valid and kept`, async () => {
      const result = kept(phase2With(options));
      assert.equal(result.ok, true, result.ok ? "" : result.code);
      const reports = new InMemoryReportRepository();
      const id = await reports.create("local", JSON.parse(JSON.stringify(reportOf(input, answers, jev, built, phase2With(options)))));
      assert.ok(id);
    });
  }

  test("the plan is the same with the phase 2 part fitted, or with none at all", () => {
    const withPhase2 = kept(phase2With({ text: "x".repeat(1_200), risks: 25, currency: "E".repeat(12) }));
    const without = kept();
    assert.ok(withPhase2.ok && without.ok);
    const fromWith = buildPlanSkeleton(withPhase2.report);
    const fromWithout = buildPlanSkeleton(without.report);
    assert.ok(fromWith.ok && fromWithout.ok);
    assert.deepEqual(fromWith.plan, fromWithout.plan);
  });
});

describe("contract: planner outputs of any size are always kept", () => {
  // The planner's own schema fixes the enums, the scores and the four-question cap; everything else is free text
  const SEEDS = 60;
  test(`${SEEDS} seeded outputs, each stored and read back`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = prng(seed);
      const text = () => {
        const length = random.pick([0, 1, 40, 999, 1_000, 1_001, 1_200, 3_000]);
        const alphabet = ["a", " ", "é", "😀", "\u0000", "\n"];
        return Array.from({ length }, () => random.pick(alphabet)).join("");
      };
      const field = () => ({ value: text(), source: random.pick(["stated", "inferred", "unknown"] as const), confidence: random.int(101) });
      const list = () => Array.from({ length: random.int(31) }, text);
      const output = {
        maturity: random.pick(["vague", "developing", "advanced"] as const),
        subsector: field(),
        location: field(),
        target_customer: field(),
        value_proposition: field(),
        revenue_model: field(),
        stage: field(),
        competition: field(),
        constraints: {
          budget: { min: random.chance(0.5) ? random.int(100_000) : null, max: null, currency: text().slice(0, random.int(20)), fits: text() },
          exclusions: list(),
          risks: list(),
          assumptions: list(),
        },
        questions: [],
      };
      mockFetch(({ url }) => {
        if (url.includes("typesafe.ai")) return jsonResponse(200, { model: "test", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } });
        return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
      });
      const reports = new InMemoryReportRepository();
      const log = silenceConsoleError();
      const result = (await runPlanner(input, [], false, {}, { reports, owner: "local" })) as Record<string, unknown>;
      assert.equal(typeof result.reportId, "string", `seed ${seed}: report kept (${JSON.stringify(log.mock.calls.map((call) => call.arguments))})`);
      assert.equal(log.mock.calls.length, 0, `seed ${seed}: nothing logged`);
      log.mock.restore();
      assert.ok(await reports.get(result.reportId as string, "local"), `seed ${seed}: read back`);
    }
  });
});
