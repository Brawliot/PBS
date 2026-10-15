import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXCLUDED_EXECUTION,
  IMPROVE_BANK,
  IMPROVE_KEY,
  MAX_IMPROVE_PER_CATEGORY,
  MAX_IMPROVE_TOTAL,
  improveAnswersOf,
  isImproveAnswer,
  optionsOf,
  selectImproveQuestions,
} from "../../plan/improve-questions.js";
import { parseReport, ReportSchema, type Diagnosis } from "../../plan/report.js";
import { parseAnswers } from "../../request.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { handlePlanRequest } from "../../plan-routes.js";
import { reportWith } from "./report-fixtures.js";

// "Improve my report": a closed bank in code, selected from the weak categories of the diagnosis. The questions are
// about planning only; a question about execution never enters the bank.

type Status = "strong" | "watch" | "risk";
/** A diagnosis with the given status per check; the others are strong */
function diagnosisWith(statuses: Partial<Record<Diagnosis["checks"][number]["key"], Status>>): Diagnosis {
  const keys = ["concept", "location", "money", "experience", "competition"] as const;
  return {
    idea: "Bar de tapas",
    checks: keys.map((key) => ({ key, status: statuses[key] ?? "strong", why: "Text.", estimated: false, decidedBy: "rule" as const })) as Diagnosis["checks"],
    risks: ["A risk."],
    split: { mando: [], you: [], outsource: [] },
  };
}

describe("the bank", () => {
  it("every key is an improve key, and no two questions share a key", () => {
    const keys = IMPROVE_BANK.map(({ key }) => key);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.match(key, IMPROVE_KEY);
  });

  it("every question has the don't-know option, and its options are plain and unique", () => {
    for (const question of IMPROVE_BANK) {
      for (const sector of [undefined, "Hospitality/Food service", "Health/Medicine", "Technology/SaaS", "Other"]) {
        const labels = optionsOf(question, sector).map(({ label }) => label);
        assert.ok(labels.includes("I don't know yet"), `${question.key} (${sector ?? "default"})`);
        assert.equal(new Set(labels).size, labels.length, `${question.key} repeats an option`);
      }
    }
  });

  it("the effects are the four named ones", () => {
    const effects = new Set(IMPROVE_BANK.flatMap((question) => optionsOf(question).map(({ effect }) => effect)));
    for (const effect of effects) assert.ok(["good", "partial", "gap", "none"].includes(effect));
  });

  it("no question or option is about execution: none of the excluded words appears in the bank", () => {
    const texts = IMPROVE_BANK.flatMap((question) => [
      question.question,
      ...[undefined, "Hospitality/Food service", "Health/Medicine", "Technology/SaaS"].flatMap((sector) => optionsOf(question, sector).map(({ label }) => label)),
    ]);
    for (const word of EXCLUDED_EXECUTION) {
      const pattern = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i");
      for (const text of texts) assert.equal(pattern.test(text), false, `"${word}" found in "${text}"`);
    }
  });
});

describe("selection", () => {
  it("the risks come before the watches", () => {
    const selected = selectImproveQuestions(diagnosisWith({ concept: "watch", money: "risk" }), []);
    assert.equal(selected[0].category, "money");
    const lastRisk = selected.map(({ status }) => status).lastIndexOf("risk");
    const firstWatch = selected.map(({ status }) => status).indexOf("watch");
    assert.ok(lastRisk < firstWatch, "every risk is asked before any watch");
  });

  it("two questions per category at most", () => {
    const selected = selectImproveQuestions(diagnosisWith({ money: "risk" }), []);
    assert.equal(selected.length, MAX_IMPROVE_PER_CATEGORY);
    assert.ok(selected.every(({ category }) => category === "money"));
  });

  it("five questions in all at most", () => {
    const selected = selectImproveQuestions(diagnosisWith({ concept: "risk", location: "risk", money: "risk", experience: "risk", competition: "risk" }), []);
    assert.equal(selected.length, MAX_IMPROVE_TOTAL);
  });

  it("a strong check is never asked", () => {
    const selected = selectImproveQuestions(diagnosisWith({ concept: "watch" }), []);
    assert.ok(selected.every(({ category }) => category === "concept"));
    assert.ok(selected.every(({ status }) => status !== "strong"));
  });

  it("a question already answered in the report is not asked again", () => {
    const first = selectImproveQuestions(diagnosisWith({ money: "risk" }), []);
    const next = selectImproveQuestions(diagnosisWith({ money: "risk" }), [first[0].key]);
    assert.equal(next.some(({ key }) => key === first[0].key), false);
    assert.equal(next[0].key, first[1].key);
  });

  it("a report with every check strong has no questions, and so no link", () => {
    assert.deepEqual(selectImproveQuestions(diagnosisWith({}), []), []);
  });

  it("no diagnosis, no questions", () => {
    assert.deepEqual(selectImproveQuestions(undefined, []), []);
  });

  it("the room left in the report limits the questions", () => {
    assert.equal(selectImproveQuestions(diagnosisWith({ money: "risk" }), [], undefined, 1).length, 1);
    assert.equal(selectImproveQuestions(diagnosisWith({ money: "risk" }), [], undefined, 0).length, 0);
  });

  it("the customer question follows the sector", () => {
    const selected = selectImproveQuestions(diagnosisWith({ concept: "risk" }), [], "Hospitality/Food service");
    const customer = selected.find(({ key }) => key === "imp_concept_customer");
    assert.ok(customer);
    assert.ok(customer.options.includes("Locals in one area"));
  });
});

describe("answers", () => {
  it("an option of its question is valid; anything else is not", () => {
    assert.equal(isImproveAnswer("imp_money_cushion", "No"), true);
    assert.equal(isImproveAnswer("imp_money_cushion", "Maybe"), false);
    assert.equal(isImproveAnswer("imp_unknown_key", "No"), false);
  });

  it("the answers kept in a report are only the options of their questions", () => {
    const kept = improveAnswersOf([
      { topic: "imp_money_cushion", answer: "Yes, 3+ months of costs" },
      { topic: "imp_money_cushion", answer: "a free text" },
      { topic: "existing_customers", answer: "Yes" },
    ]);
    assert.deepEqual(kept, { imp_money_cushion: "Yes, 3+ months of costs" });
  });

  it("an improve answer that is not one of its options is refused by the request", () => {
    assert.throws(
      () => parseAnswers([{ topic: "imp_money_cushion", question: "Do you have a cushion?", answer: "A lot" }]),
      (error: { status?: number }) => error.status === 400,
    );
    assert.equal(parseAnswers([{ topic: "imp_money_cushion", question: "Do you have a cushion?", answer: "No" }]).length, 1);
  });

  it("a report keeps its improve answers by key, and refuses a key that is not an improve key", () => {
    const base = reportWith();
    assert.equal(ReportSchema.safeParse({ ...base, improveAnswers: { imp_money_cushion: "No" } }).success, true);
    assert.equal(ReportSchema.safeParse({ ...base, improveAnswers: { money: "No" } }).success, false);
    assert.equal(parseReport(JSON.stringify({ ...base, improveAnswers: { imp_money_cushion: "No" } })).ok, true);
  });
});

describe("GET /api/reports/:id/improve-questions", () => {
  const request = (userId: string, path: string, reports: InMemoryReportRepository) =>
    handlePlanRequest({ method: "GET", path, userId, body: "", env: {}, repo: new InMemoryPlanRepository(), reports, now: () => new Date().toISOString() });

  it("the owner gets the questions the report asks now", async () => {
    const reports = new InMemoryReportRepository();
    const id = await reports.create("ana", { ...reportWith(), diagnosis: diagnosisWith({ money: "risk" }) });
    const response = await request("ana", `/api/reports/${id}/improve-questions`, reports);
    assert.equal(response.status, 200);
    assert.equal((response.body as { questions: unknown[] }).questions.length, MAX_IMPROVE_PER_CATEGORY);
  });

  it("another user's report is not found, as if it did not exist", async () => {
    const reports = new InMemoryReportRepository();
    const id = await reports.create("ana", { ...reportWith(), diagnosis: diagnosisWith({ money: "risk" }) });
    const other = await request("ben", `/api/reports/${id}/improve-questions`, reports);
    const missing = await request("ben", "/api/reports/11111111-1111-4111-8111-111111111111/improve-questions", reports);
    assert.equal(other.status, 404);
    assert.deepEqual(other.body, missing.body);
  });

  it("a report with its answers asks no question it already has", async () => {
    const reports = new InMemoryReportRepository();
    const id = await reports.create("ana", { ...reportWith(), diagnosis: diagnosisWith({ money: "risk" }), improveAnswers: { imp_money_cushion: "No" } });
    const response = await request("ana", `/api/reports/${id}/improve-questions`, reports);
    const keys = (response.body as { questions: { key: string }[] }).questions.map(({ key }) => key);
    assert.equal(keys.includes("imp_money_cushion"), false);
  });
});
