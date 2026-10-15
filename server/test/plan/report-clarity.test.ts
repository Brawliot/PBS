import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseReport } from "../../plan/report.js";
import type { Clarity } from "../../plan/clarity.js";
import { reportWith } from "./report-fixtures.js";

// The clarity and the "I don't know" list are optional in the report: a report kept before them still reads, and
// a new one is checked strictly (closed levels, scores 0-100, only known labels, at most three missing).

/** A report as it was kept before this change: no clarity, no unknown inputs, a glance without sources */
const oldShape = () => {
  const { input, answers, jev, profile, validation } = reportWith();
  return {
    input,
    answers,
    jev,
    profile,
    validation,
    glance: {
      maturity: "developing",
      subsectorSource: "stated",
      location: { value: "Madrid", source: "inferred" },
      budget: { min: 5_000, max: 9_000, currency: "EUR", fits: "Enough for a first version" },
    },
  };
};
const clarity: Clarity = {
  version: 1,
  concept: { level: "medium", score: 43, missing: ["How it makes money", "Where it operates"] },
  person: { level: "high", score: 89, missing: [] },
};
const read = (report: unknown) => parseReport(JSON.stringify(report));

describe("the report schema: clarity and unknown inputs", () => {
  test("a report of the old shape still reads, with no clarity and no unknown list", () => {
    const result = read(oldShape());
    assert.equal(result.ok, true);
    assert.equal(result.ok && "clarity" in result.report, false);
    assert.equal(result.ok && "unknown" in result.report.input, false);
  });

  test("a report with a valid clarity, glance sources and unknown inputs reads, and keeps them", () => {
    const base = oldShape();
    const sources = { target_customer: "inferred", value_proposition: "stated", revenue_model: "unknown", stage: "stated", competition: "unknown" };
    const report = { ...base, input: { ...base.input, unknown: ["budget", "hours"] }, glance: { ...base.glance, sources }, clarity };
    const result = read(report);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.report.clarity, clarity);
    assert.deepEqual(result.ok && result.report.input.unknown, ["budget", "hours"]);
    assert.deepEqual(result.ok && result.report.glance?.sources, sources);
  });

  const invalidClarity: [string, unknown][] = [
    ["an unknown level", { ...clarity, concept: { ...clarity.concept, level: "great" } }],
    ["a score above 100", { ...clarity, person: { ...clarity.person, score: 101 } }],
    ["a fractional score", { ...clarity, person: { ...clarity.person, score: 50.5 } }],
    ["a missing label not in the tables", { ...clarity, concept: { ...clarity.concept, missing: ["Market size"] } }],
    ["four missing items", { ...clarity, person: { ...clarity.person, missing: ["Budget", "Team", "Weekly hours", "Experience"] } }],
    ["an extra key", { ...clarity, viability: "high" }],
    ["a missing metric", { version: 1, concept: clarity.concept }],
  ];
  for (const [name, value] of invalidClarity) {
    test(`a clarity with ${name} is refused`, () => {
      assert.deepEqual(read({ ...oldShape(), clarity: value }), { ok: false, code: "invalid_report" });
    });
  }

  const invalidUnknown: [string, unknown][] = [
    ["an unknown key", ["money"]],
    ["a repeated key", ["team", "team"]],
    ["a string", "team"],
  ];
  for (const [name, value] of invalidUnknown) {
    test(`an unknown list with ${name} is refused`, () => {
      const base = oldShape();
      assert.deepEqual(read({ ...base, input: { ...base.input, unknown: value } }), { ok: false, code: "invalid_report" });
    });
  }
});
