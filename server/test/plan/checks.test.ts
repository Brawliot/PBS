import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_RULES, DEFAULT_WHY, buildChecks, experienceCheck, isOnline, jevCheck, moneyCheck } from "../../plan/checks.js";
import { DiagnosisSchema, MAX_DIAGNOSIS_WHY } from "../../plan/report.js";
import type { JevAnswer } from "../../planner/planner-handler.js";

// The five checks: two rules (money, experience) and three judgements of Jev. Each rule is tested at its limits.

const HEAVY = "Heavy (health, finance, food)";
const LIGHT = "Light";
const choice = (value: string): JevAnswer => ({ type: "choice", choice: value });
const judged = (value: string) => ({ concept: choice(value), location: choice(value), competition: choice(value), experience: choice(value) });

describe("money: the budget against the minimum the idea needs", () => {
  test("a budget exactly at the minimum is strong", () => {
    assert.equal(moneyCheck(8_000, { min: 8_000 }).status, "strong");
  });

  test("a budget above the minimum is strong", () => {
    assert.equal(moneyCheck(20_000, { min: 8_000 }).status, "strong");
  });

  test("a budget exactly 25% below the minimum is watch", () => {
    assert.equal(moneyCheck(6_000, { min: 8_000 }).status, "watch");
  });

  test("a budget one euro below 25% under the minimum is risk", () => {
    assert.equal(moneyCheck(5_999, { min: 8_000 }).status, "risk");
  });

  test("the 25% limit is exact: a fraction that rounding could move is still decided by the rule", () => {
    // 75% of 7_003 is 5_252.25: 5_252 is below it, so risk; 5_253 is above it, so watch
    assert.equal(moneyCheck(5_252, { min: 7_003 }).status, "risk");
    assert.equal(moneyCheck(5_253, { min: 7_003 }).status, "watch");
  });

  test("the share of the watch band is the rule's own constant", () => {
    assert.equal(CHECK_RULES.money.watchShare, 0.75);
  });

  test("no range is watch", () => {
    assert.equal(moneyCheck(8_000, undefined).status, "watch");
  });

  test("a range without a minimum is watch", () => {
    assert.equal(moneyCheck(8_000, { min: null }).status, "watch");
  });

  test("a zero minimum is strong for any budget, zero included", () => {
    assert.equal(moneyCheck(0, { min: 0 }).status, "strong");
  });

  test("money is always estimated and decided by the rule", () => {
    const money = moneyCheck(8_000, { min: 8_000 });
    assert.equal(money.estimated, true);
    assert.equal(money.decidedBy, "rule");
  });
});

describe("experience: the founder profile, and a regulated profession", () => {
  test("a sector expert is strong", () => {
    assert.equal(experienceCheck("Sector expert", false)?.status, "strong");
  });

  test("other skills, not the trade, are watch", () => {
    for (const profile of ["Technical", "Commercial", "Management", "Several areas"]) {
      assert.equal(experienceCheck(profile, false)?.status, "watch", profile);
    }
  });

  test("no relevant background is risk", () => {
    assert.equal(experienceCheck("No relevant background", false)?.status, "risk");
  });

  test("not specified is no answer, so Jev judges it (undefined)", () => {
    assert.equal(experienceCheck("Not specified", false), undefined);
  });

  test("a regulated profession is risk, whatever the profile says", () => {
    assert.equal(experienceCheck("Sector expert", true)?.status, "risk");
    assert.equal(experienceCheck("Not specified", true)?.status, "risk");
  });

  test("the rule decides experience, not estimated", () => {
    const experience = experienceCheck("Sector expert", false);
    assert.equal(experience?.decidedBy, "rule");
    assert.equal(experience?.estimated, false);
  });
});

describe("Jev's answer for a check", () => {
  test("Strong, Watch and Risk become their status, in any case", () => {
    assert.equal(jevCheck(choice("Strong")).status, "strong");
    assert.equal(jevCheck(choice("watch")).status, "watch");
    assert.equal(jevCheck(choice("RISK")).status, "risk");
  });

  test("the answer is decided by Jev and is estimated", () => {
    const answer = jevCheck(choice("Risk"));
    assert.equal(answer.decidedBy, "jev");
    assert.equal(answer.estimated, true);
  });

  test("no answer is watch", () => {
    assert.equal(jevCheck(undefined).status, "watch");
  });

  test("an answer that is not a status is watch", () => {
    assert.equal(jevCheck(choice("Excellent")).status, "watch");
    assert.equal(jevCheck(choice("")).status, "watch");
  });

  test("an answer that is not a choice is watch", () => {
    assert.equal(jevCheck({ type: "score", score: 90 }).status, "watch");
  });

  test("a missing answer gets the default text of watch", () => {
    assert.equal(jevCheck(undefined).why, DEFAULT_WHY.watch);
  });
});

describe("the default texts", () => {
  test("each default is a non-empty text within the report's limit", () => {
    for (const why of Object.values(DEFAULT_WHY)) {
      assert.ok(why.length > 0);
      assert.ok(why.length <= MAX_DIAGNOSIS_WHY);
    }
  });
});

describe("the five checks in order", () => {
  test("a physical business has location as its second check", () => {
    const checks = buildChecks({ budget: 8_000, founderProfile: "Sector expert", range: { min: 8_000 }, regulatoryLoad: LIGHT, jev: { geographic_scope: choice("Local") } });
    assert.deepEqual(checks.map((c) => c.key), ["concept", "location", "money", "experience", "competition"]);
  });

  test("an online business has reach in place of location, as the second check", () => {
    for (const scope of ["Online", "Global"]) {
      const checks = buildChecks({ budget: 8_000, founderProfile: "Sector expert", range: undefined, regulatoryLoad: LIGHT, jev: { geographic_scope: choice(scope) } });
      assert.equal(checks[1].key, "reach", scope);
    }
  });

  test("no scope answer from Jev means location", () => {
    const checks = buildChecks({ budget: 8_000, founderProfile: "Sector expert", range: undefined, regulatoryLoad: LIGHT, jev: {} });
    assert.equal(checks[1].key, "location");
  });

  test("the checks take the decided status: rules for money and experience, Jev for the rest", () => {
    const checks = buildChecks({ budget: 6_000, founderProfile: "Sector expert", range: { min: 8_000 }, regulatoryLoad: LIGHT, jev: judged("Strong") });
    const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
    assert.equal(byKey.money.status, "watch");
    assert.equal(byKey.money.decidedBy, "rule");
    assert.equal(byKey.experience.status, "strong");
    assert.equal(byKey.experience.decidedBy, "rule");
    assert.equal(byKey.concept.status, "strong");
    assert.equal(byKey.concept.decidedBy, "jev");
  });

  test("without years and without regulation, experience is Jev's judgement", () => {
    const checks = buildChecks({ budget: 8_000, founderProfile: "Not specified", range: { min: 8_000 }, regulatoryLoad: LIGHT, jev: judged("Risk") });
    const experience = checks.find((c) => c.key === "experience");
    assert.equal(experience?.status, "risk");
    assert.equal(experience?.decidedBy, "jev");
  });

  test("a regulated profession is risk on experience, whatever Jev says", () => {
    const checks = buildChecks({ budget: 8_000, founderProfile: "Sector expert", range: { min: 8_000 }, regulatoryLoad: HEAVY, jev: judged("Strong") });
    assert.equal(checks.find((c) => c.key === "experience")?.status, "risk");
  });

  test("a check Jev did not answer is watch, with the default text", () => {
    const checks = buildChecks({ budget: 8_000, founderProfile: "Sector expert", range: { min: 8_000 }, regulatoryLoad: LIGHT, jev: {} });
    const concept = checks.find((c) => c.key === "concept");
    assert.equal(concept?.status, "watch");
    assert.equal(concept?.why, DEFAULT_WHY.watch);
  });

  test("the five checks pass the diagnosis schema, with the idea and the risks around them", () => {
    const checks = buildChecks({ budget: 8_000, founderProfile: "Sector expert", range: { min: 8_000 }, regulatoryLoad: LIGHT, jev: judged("Watch") });
    const diagnosis = { idea: "Bakery", checks, risks: ["Rent"], split: { mando: [], you: [], outsource: [] } };
    assert.equal(DiagnosisSchema.safeParse(diagnosis).success, true);
  });
});

describe("the online scope", () => {
  test("Online and Global are online; the rest are not", () => {
    assert.equal(isOnline("Online"), true);
    assert.equal(isOnline("Global"), true);
    assert.equal(isOnline("Local"), false);
    assert.equal(isOnline("Hyper-local"), false);
    assert.equal(isOnline(undefined), false);
  });
});
