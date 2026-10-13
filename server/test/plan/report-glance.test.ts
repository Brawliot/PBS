import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CURRENCY, MAX_GLANCE_MONEY, MAX_PHASE2_TEXT, MAX_REPORT_BYTES, parseReport } from "../../plan/report.js";
import type { Glance } from "../../plan/glance.js";
import { reportWith } from "./report-fixtures.js";

// The glance is optional in the report: a report kept before it still reads, and a new one is checked with the
// limits of the glance (glance.ts). Its fields are the only ones it has, and it never reads back repaired.

const glance: Glance = {
  maturity: "advanced",
  subsectorSource: "stated",
  location: { value: "Madrid", source: "inferred" },
  budget: { min: 5_000, max: 9_000, currency: "EUR", fits: "Enough for a first version" },
};

const before = () => {
  const { input, answers, jev, profile, validation } = reportWith();
  return { input, answers, jev, profile, validation };
};
const withGlance = (value: unknown) => ({ ...before(), glance: value });
const read = (report: unknown) => parseReport(JSON.stringify(report));

describe("the report schema: glance", () => {
  test("a report kept before the glance existed still reads, without one", () => {
    const result = read(before());
    assert.equal(result.ok, true);
    assert.equal(result.ok && "glance" in result.report, false);
  });

  test("a report with a valid glance reads, and keeps it", () => {
    const result = read(withGlance(glance));
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.report.glance, glance);
  });

  test("a glance with no range and no location reads", () => {
    const value = { ...glance, location: { value: "", source: "unknown" }, budget: { min: null, max: null, currency: "", fits: "" } };
    assert.equal(read(withGlance(value)).ok, true);
  });

  const refused: [string, unknown][] = [
    ["an unknown maturity", { ...glance, maturity: "great" }],
    ["a location above the text limit", { ...glance, location: { value: "x".repeat(MAX_PHASE2_TEXT + 1), source: "stated" } }],
    ["a currency above its limit", { ...glance, budget: { ...glance.budget, currency: "x".repeat(MAX_CURRENCY + 1) } }],
    ["an amount above the limit", { ...glance, budget: { ...glance.budget, max: MAX_GLANCE_MONEY + 1 } }],
    ["a minimum above the maximum", { ...glance, budget: { ...glance.budget, min: 9_001, max: 9_000 } }],
    ["a negative amount", { ...glance, budget: { ...glance.budget, min: -5 } }],
    ["a NUL character in the fit text", { ...glance, budget: { ...glance.budget, fits: "a\u0000b" } }],
    ["an extra field", { ...glance, subsector: "Bakery" }],
  ];
  for (const [name, value] of refused) {
    test(`refuses a glance with ${name}`, () => {
      const result = read(withGlance(value));
      assert.deepEqual(result, { ok: false, code: "invalid_report" });
    });
  }

  test("a glance at the largest sizes keeps the report under its byte limit", () => {
    const largest: Glance = {
      maturity: "vague",
      subsectorSource: "unknown",
      location: { value: "x".repeat(MAX_PHASE2_TEXT), source: "stated" },
      budget: { min: 0, max: MAX_GLANCE_MONEY, currency: "y".repeat(MAX_CURRENCY), fits: "z".repeat(MAX_PHASE2_TEXT) },
    };
    const text = JSON.stringify(withGlance(largest));
    assert.ok(Buffer.byteLength(text) < MAX_REPORT_BYTES);
    assert.equal(read(withGlance(largest)).ok, true);
  });
});
