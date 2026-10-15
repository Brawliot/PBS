import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePlannerRequest } from "../../request.js";
import { MAX_CURRENCY, MAX_GLANCE_MONEY, MAX_PHASE2_TEXT } from "../../plan/report.js";
import type { Glance } from "../../plan/glance.js";
import "./helpers.js";

// The glance of a final request: kept when it passes its schema, dropped whole when it does not. The request
// itself never fails because of it, and a request that is not final never uses it.

const validBody = { idea: "A bakery that delivers", budget: 0, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const, final: true, answers: [] };
const glance: Glance = {
  maturity: "developing",
  subsectorSource: "inferred",
  location: { value: "Manchester, UK", source: "stated" },
  budget: { min: 5_000, max: 9_000, currency: "GBP", fits: "Enough for a first version" },
};
const withGlance = (value: unknown, body: Record<string, unknown> = validBody) =>
  parsePlannerRequest(JSON.stringify({ ...body, glance: value }));

describe("parsePlannerRequest: the glance", () => {
  test("a valid glance of a final request is kept", () => {
    assert.deepEqual(withGlance(glance).glance, glance);
  });

  test("a glance with no range (both amounts null) and an empty location is kept", () => {
    const value = { ...glance, location: { value: "", source: "unknown" }, budget: { min: null, max: null, currency: "", fits: "" } };
    assert.deepEqual(withGlance(value).glance, value);
  });

  test("the largest values allowed are kept", () => {
    const value = {
      ...glance,
      location: { value: "x".repeat(MAX_PHASE2_TEXT), source: "stated" },
      budget: { min: 0, max: MAX_GLANCE_MONEY, currency: "y".repeat(MAX_CURRENCY), fits: "z".repeat(MAX_PHASE2_TEXT) },
    };
    assert.deepEqual(withGlance(value).glance, value);
  });

  test("a glance that is not in a final request is not used", () => {
    const result = withGlance(glance, { ...validBody, final: false });
    assert.equal("glance" in result, false);
  });

  test("a final request without a glance has none", () => {
    const result = parsePlannerRequest(JSON.stringify(validBody));
    assert.equal("glance" in result, false);
  });

  const invalid: [string, unknown][] = [
    ["a string", "developing"],
    ["an array", [glance]],
    ["an unknown maturity", { ...glance, maturity: "great" }],
    ["an unknown subsector source", { ...glance, subsectorSource: "guessed" }],
    ["an unknown location source", { ...glance, location: { value: "Madrid", source: "guessed" } }],
    ["a location text above the limit", { ...glance, location: { value: "x".repeat(MAX_PHASE2_TEXT + 1), source: "stated" } }],
    ["a location with a NUL character", { ...glance, location: { value: "Mad\u0000rid", source: "stated" } }],
    ["a missing budget", { ...glance, budget: undefined }],
    ["a negative minimum", { ...glance, budget: { ...glance.budget, min: -1 } }],
    ["a maximum above the limit", { ...glance, budget: { ...glance.budget, max: MAX_GLANCE_MONEY + 1 } }],
    ["a text for the amount", { ...glance, budget: { ...glance.budget, min: "5000" } }],
    ["a minimum above the maximum", { ...glance, budget: { ...glance.budget, min: 9_001, max: 9_000 } }],
    ["a currency above its limit", { ...glance, budget: { ...glance.budget, currency: "x".repeat(MAX_CURRENCY + 1) } }],
    ["a fit text with a NUL character", { ...glance, budget: { ...glance.budget, fits: "ok\u0000" } }],
    ["an extra field at the top", { ...glance, subsector: "Bakery" }],
    ["an extra field in the budget", { ...glance, budget: { ...glance.budget, notes: "x" } }],
    ["an extra field in the location", { ...glance, location: { value: "Madrid", source: "stated", confidence: 80 } }],
  ];
  for (const [name, value] of invalid) {
    test(`ignores the glance with ${name}, and the request still works`, () => {
      const result = withGlance(value);
      assert.equal("glance" in result, false);
      assert.deepEqual(result.input, { idea: "A bakery that delivers", budget: 0, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const});
      assert.equal(result.final, true);
    });
  }
});

describe("parsePlannerRequest: the sources of the glance", () => {
  const sources = { target_customer: "inferred", value_proposition: "stated", revenue_model: "unknown", stage: "stated", competition: "unknown" };

  test("a glance with valid sources keeps them", () => {
    assert.deepEqual(withGlance({ ...glance, sources }).glance, { ...glance, sources });
  });

  const invalid: [string, unknown][] = [
    ["an unknown source", { ...sources, stage: "guessed" }],
    ["a missing field", { ...sources, competition: undefined }],
    ["an extra field", { ...sources, location: "stated" }],
    ["a list", ["stated"]],
  ];
  for (const [name, value] of invalid) {
    test(`sources with ${name} drop the whole glance`, () => {
      assert.equal("glance" in withGlance({ ...glance, sources: value }), false);
    });
  }
});
