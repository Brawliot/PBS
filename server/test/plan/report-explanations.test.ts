import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseReport, MAX_EXPLAINED_AREAS, MAX_EXPLAINED_WARNINGS, MAX_EXPLANATION_REASON } from "../../plan/report.js";
import { reportWith } from "./report-fixtures.js";

// The explanations are optional in the report: a report kept before them still reads, and a new one is checked
// with the same limits the planner uses (a reason of 1 to MAX_EXPLANATION_REASON characters, shown items only).

/** A report as the planner stored it before explanations existed */
const before = () => {
  const { input, answers, jev, profile, validation } = reportWith();
  return { input, answers, jev, profile, validation };
};
const withExplanations = (explanations: unknown) => ({ ...before(), explanations });
const read = (report: unknown) => parseReport(JSON.stringify(report));

const valid = {
  warningReasons: [{ key: "budget_fit", reason: "Equipment and licences take most of the lower range." }],
  areaReasons: [{ name: "Legal & Compliance", reason: "Street trading, food hygiene." }],
};

describe("the report schema: explanations", () => {
  test("a report kept before explanations existed still reads", () => {
    const result = read(before());
    assert.equal(result.ok, true);
    assert.equal(result.ok && "explanations" in result.report, false);
  });

  test("a report with valid explanations reads, and keeps them", () => {
    const result = read(withExplanations(valid));
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.report.explanations, valid);
  });

  test("empty lists of explanations are valid", () => {
    assert.equal(read(withExplanations({ warningReasons: [], areaReasons: [] })).ok, true);
  });

  test(`a reason of exactly ${MAX_EXPLANATION_REASON} characters is valid, and one more is refused`, () => {
    const exact = { ...valid, warningReasons: [{ key: "budget_fit", reason: "x".repeat(MAX_EXPLANATION_REASON) }] };
    assert.equal(read(withExplanations(exact)).ok, true);

    const over = { ...valid, warningReasons: [{ key: "budget_fit", reason: "x".repeat(MAX_EXPLANATION_REASON + 1) }] };
    assert.deepEqual(read(withExplanations(over)), { ok: false, code: "invalid_report" });
  });

  test("an empty reason, or one with a line break, is refused", () => {
    const empty = { ...valid, areaReasons: [{ name: "Legal & Compliance", reason: "  " }] };
    assert.equal(read(withExplanations(empty)).ok, false);

    const lines = { ...valid, areaReasons: [{ name: "Legal & Compliance", reason: "Two\nlines" }] };
    assert.equal(read(withExplanations(lines)).ok, false);
  });

  test("a warning key or an area name that the validation does not have is refused", () => {
    const key = { ...valid, warningReasons: [{ key: "invented_check", reason: "Why." }] };
    assert.equal(read(withExplanations(key)).ok, false);

    const name = { ...valid, areaReasons: [{ name: "Invented area", reason: "Why." }] };
    assert.equal(read(withExplanations(name)).ok, false);
  });

  test("more reasons than the report shows are refused", () => {
    const warningKeys = ["budget_fit", "timeline_realistic", "team_fit", "consistency"];
    const warnings = warningKeys.slice(0, MAX_EXPLAINED_WARNINGS + 1).map((key) => ({ key, reason: "Why." }));
    assert.equal(read(withExplanations({ ...valid, warningReasons: warnings })).ok, false);

    const areas = Array.from({ length: MAX_EXPLAINED_AREAS + 1 }, () => ({ name: "Legal & Compliance", reason: "Why." }));
    assert.equal(read(withExplanations({ ...valid, areaReasons: areas })).ok, false);
  });

  test("an extra field inside the explanations is refused, as everywhere in the report", () => {
    const extra = { ...valid, warningReasons: [{ key: "budget_fit", reason: "Why.", score: 1 }] };
    assert.equal(read(withExplanations(extra)).ok, false);
  });
});

describe("the report schema: the time, the cost and the templates", () => {
  const more = {
    timeToOpen: { min: 3, max: 5, unit: "months", confidence: "medium" },
    costBreakdown: [
      { label: "Equipment", percent: 55 },
      { label: "Licences", percent: 45 },
    ],
    templates: ["supplier-quote", "licence-enquiry", "price-test"],
  };
  const withMore = (change: Record<string, unknown>) => withExplanations({ ...valid, ...more, ...change });

  test("a report kept before the new parts still reads, with or without the old ones", () => {
    assert.equal(read(withExplanations({})).ok, true);
    assert.equal(read(withExplanations({ warningReasons: valid.warningReasons })).ok, true);
  });

  test("a report with all the parts reads, and keeps them", () => {
    const result = read(withMore({}));
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.report.explanations, withMore({}).explanations);
  });

  test("the time to open is refused when it is above its cap, or the minimum is above the maximum", () => {
    assert.equal(read(withMore({ timeToOpen: { min: 1, max: 104, unit: "weeks", confidence: "low" } })).ok, true);
    assert.equal(read(withMore({ timeToOpen: { min: 1, max: 105, unit: "weeks", confidence: "low" } })).ok, false);
    assert.equal(read(withMore({ timeToOpen: { min: 1, max: 61, unit: "months", confidence: "low" } })).ok, false);
    assert.equal(read(withMore({ timeToOpen: { min: 5, max: 3, unit: "months", confidence: "low" } })).ok, false);
  });

  test("the cost breakdown is refused when it does not add up to 100, or has one or six items", () => {
    assert.equal(read(withMore({ costBreakdown: [{ label: "A", percent: 50 }, { label: "B", percent: 40 }] })).ok, false);
    assert.equal(read(withMore({ costBreakdown: [{ label: "A", percent: 100 }] })).ok, false);
    const six = ["A", "B", "C", "D", "E", "F"].map((label) => ({ label, percent: label === "F" ? 20 : 16 }));
    assert.equal(read(withMore({ costBreakdown: six })).ok, false);
  });

  test("the templates are refused when they are not three different ids of the catalog", () => {
    assert.equal(read(withMore({ templates: ["supplier-quote", "licence-enquiry"] })).ok, false);
    assert.equal(read(withMore({ templates: ["supplier-quote", "supplier-quote", "price-test"] })).ok, false);
    assert.equal(read(withMore({ templates: ["supplier-quote", "licence-enquiry", "invented"] })).ok, false);
  });

  test("a part the schema does not know is refused, as everywhere in the report", () => {
    assert.equal(read(withMore({ upfrontMoney: 9000 })).ok, false);
  });
});
