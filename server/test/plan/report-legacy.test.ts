import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { parseReport } from "../../plan/report.js";
import { reportWith } from "./report-fixtures.js";

// A report kept before the fixed questions changed: experience, team and hours, and no location, start or premises
const legacy = (input: Record<string, unknown>) => {
  const report = JSON.parse(JSON.stringify(reportWith()));
  report.input = input;
  return JSON.stringify(report);
};

describe("reports kept with the old fixed questions", () => {
  test("open, keep the budget, and count the three new questions as I don't know", () => {
    const result = parseReport(legacy({ idea: "Restaurante japonés en Madrid", budget: 80_000, experience: 3, team: 2, hours: 1 }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.report.input.budget, 80_000);
    assert.equal(result.report.input.location, "");
    assert.deepEqual(result.report.input.unknown, ["location", "start_mode", "premises"]);
    assert.equal("team" in result.report.input, false);
    assert.equal("hours" in result.report.input, false);
    assert.equal("experience" in result.report.input, false);
  });

  test("keep an old 'I don't know' on the budget, and drop the old keys from the list", () => {
    const result = parseReport(legacy({ idea: "Bakery", budget: 0, experience: 0, team: 0, hours: 0, unknown: ["budget", "team", "hours"] }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.report.input.unknown, ["budget", "location", "start_mode", "premises"]);
  });

  test("build their plan as before", () => {
    const parsed = parseReport(legacy({ idea: "Restaurante japonés en Madrid", budget: 80_000, experience: 3, team: 2, hours: 1 }));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const built = buildPlanSkeleton(parsed.report);
    assert.equal(built.ok, true);
  });

  test("an old report with a wrong budget is still refused", () => {
    assert.equal(parseReport(legacy({ idea: "x", budget: -5, team: 1 })).ok, false);
  });
});
