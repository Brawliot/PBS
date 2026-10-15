import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RISK, DEFAULT_WHY, applyDiagnosisText, baseDiagnosis, defaultRisks, fitsStatus, splitOf } from "../../plan/diagnosis-text.js";
import { buildExecution, type Execution } from "../../plan/execution.js";
import { DiagnosisSchema, type Diagnosis } from "../../plan/report.js";
import { MAX_DIAGNOSIS_IDEA, MAX_DIAGNOSIS_RISK, MAX_DIAGNOSIS_SPLIT_ITEM, MAX_DIAGNOSIS_SPLIT_ITEMS, MAX_DIAGNOSIS_WHY } from "../../plan/report-limits.js";

// The words of the diagnosis. The statuses are given; the model's words are kept only when they pass their limits
// and fit their status. Any part that does not pass keeps its default, so the diagnosis always passes its schema.

const checks = (statuses: Partial<Record<Diagnosis["checks"][number]["key"], Diagnosis["checks"][number]["status"]>> = {}): Diagnosis["checks"] => {
  const base = { concept: "strong", location: "watch", money: "risk", experience: "strong", competition: "watch" } as const;
  return (["concept", "location", "money", "experience", "competition"] as const).map((key) => ({
    key,
    status: statuses[key] ?? base[key],
    why: "rule text",
    estimated: false,
    decidedBy: "rule" as const,
  })) as Diagnosis["checks"];
};

const base = () => baseDiagnosis("A tapas bar in Malasaña", checks(), undefined);
const reply = (overrides: Record<string, unknown> = {}) => ({
  idea: "A neighbourhood tapas bar for locals and after-work crowds.",
  checks: [
    { key: "concept", why: "Locals already drink and eat in this street." },
    { key: "location", why: "The street is busy after work, though rents are high." },
    { key: "money", why: "The budget is far below the cost of the first months." },
    { key: "experience", why: "The owner has run a kitchen for years." },
    { key: "competition", why: "Several bars nearby serve the same tapas." },
  ],
  risks: ["Rent takes most of the margin.", "Lunch trade is thin in this street.", "Competition from two bars two streets away."],
  ...overrides,
});

describe("the default words", () => {
  test("a diagnosis with no model text is valid, and carries the default reason of each check and status", () => {
    const diagnosis = base();
    assert.equal(DiagnosisSchema.safeParse(diagnosis).success, true);
    assert.equal(diagnosis.checks[0].why, DEFAULT_WHY.concept.strong);
    assert.equal(diagnosis.checks[2].why, DEFAULT_WHY.money.risk);
  });

  test("the default idea is the person's own idea, cut to its limit", () => {
    assert.equal(baseDiagnosis("x".repeat(MAX_DIAGNOSIS_IDEA + 50), checks(), undefined).idea.length, MAX_DIAGNOSIS_IDEA);
    assert.equal(baseDiagnosis("   ", checks(), undefined).idea, "Business idea");
  });

  test("the default risks are the risks of the checks that are not strong, risk first, at most three", () => {
    const risks = defaultRisks(checks({ concept: "watch", location: "risk", money: "risk", competition: "watch" }));
    assert.deepEqual(risks, [DEFAULT_RISK.location, DEFAULT_RISK.money, DEFAULT_RISK.concept]);
  });

  test("with every check strong there is still one risk, so the list is never empty", () => {
    const risks = defaultRisks(checks({ concept: "strong", location: "strong", money: "strong", experience: "strong", competition: "strong" }));
    assert.equal(risks.length, 1);
    assert.equal(DiagnosisSchema.safeParse({ ...base(), risks }).success, true);
  });
});

describe("the model's words: kept when they fit", () => {
  test("a reply that passes is used: the idea, each reason and the risks", () => {
    const result = applyDiagnosisText(base(), reply());
    assert.equal(result.idea, "A neighbourhood tapas bar for locals and after-work crowds.");
    assert.equal(result.checks[0].why, "Locals already drink and eat in this street.");
    assert.deepEqual(result.risks, ["Rent takes most of the margin.", "Lunch trade is thin in this street.", "Competition from two bars two streets away."]);
    assert.equal(DiagnosisSchema.safeParse(result).success, true);
  });

  test("the statuses are not changed by the words", () => {
    const result = applyDiagnosisText(base(), reply());
    assert.deepEqual(result.checks.map(({ status }) => status), base().checks.map(({ status }) => status));
  });
});

describe("the model's words: replaced when they contradict or do not pass", () => {
  test("a Risk described as good is replaced by the default of that check and status", () => {
    const result = applyDiagnosisText(base(), reply({
      checks: [{ key: "money", why: "The budget is solid and the margin is excellent." }],
    }));
    assert.equal(result.checks[2].why, DEFAULT_WHY.money.risk);
  });

  test("a Strong described as a problem is replaced", () => {
    const result = applyDiagnosisText(base(), reply({
      checks: [{ key: "concept", why: "This is a real problem for the customers." }],
    }));
    assert.equal(result.checks[0].why, DEFAULT_WHY.concept.strong);
  });

  test("a Watch described as settled is replaced", () => {
    const result = applyDiagnosisText(base(), reply({
      checks: [{ key: "location", why: "The place is excellent and there is no problem with it." }],
    }));
    assert.equal(result.checks[1].why, DEFAULT_WHY.location.watch);
  });

  test("a reason over its limit is replaced, not cut", () => {
    const result = applyDiagnosisText(base(), reply({
      checks: [{ key: "concept", why: "x".repeat(MAX_DIAGNOSIS_WHY + 1) }],
    }));
    assert.equal(result.checks[0].why, DEFAULT_WHY.concept.strong);
  });

  test("a check the reply leaves out keeps its default", () => {
    const result = applyDiagnosisText(base(), reply({ checks: [{ key: "concept", why: "Locals already drink here." }] }));
    assert.equal(result.checks[1].why, DEFAULT_WHY.location.watch);
    assert.equal(result.checks[0].why, "Locals already drink here.");
  });

  test("the fit of a reason is decided by its words alone", () => {
    assert.equal(fitsStatus("A strong street with plenty of customers.", "risk"), true);
    assert.equal(fitsStatus("A strong street with plenty of customers.", "strong"), true);
    assert.equal(fitsStatus("An excellent place.", "risk"), false);
  });
});

describe("the model's risks and idea", () => {
  test("more than three risks are cut to the first three", () => {
    const result = applyDiagnosisText(base(), reply({ risks: ["One.", "Two.", "Three.", "Four."] }));
    assert.deepEqual(result.risks, ["One.", "Two.", "Three."]);
  });

  test("a risk over its limit leaves the risks on their defaults", () => {
    const result = applyDiagnosisText(base(), reply({ risks: ["x".repeat(MAX_DIAGNOSIS_RISK + 1)] }));
    assert.deepEqual(result.risks, base().risks);
  });

  test("an empty list of risks leaves the risks on their defaults", () => {
    assert.deepEqual(applyDiagnosisText(base(), reply({ risks: [] })).risks, base().risks);
  });

  test("an idea over its limit leaves the idea on its default", () => {
    assert.equal(applyDiagnosisText(base(), reply({ idea: "x".repeat(MAX_DIAGNOSIS_IDEA + 1) })).idea, base().idea);
  });

  test("a NUL character in a part leaves that part on its default", () => {
    assert.equal(applyDiagnosisText(base(), reply({ idea: "Bar\u0000" })).idea, base().idea);
  });
});

describe("no usable reply", () => {
  test("no reply at all gives the default diagnosis, unchanged and valid", () => {
    const result = applyDiagnosisText(base(), undefined);
    assert.deepEqual(result, base());
    assert.equal(DiagnosisSchema.safeParse(result).success, true);
  });

  test("a reply that is not an object gives the default diagnosis", () => {
    assert.deepEqual(applyDiagnosisText(base(), "text"), base());
    assert.deepEqual(applyDiagnosisText(base(), ["a"]), base());
  });

  test("a reply with a key that is not one of the checks is ignored for that check", () => {
    const result = applyDiagnosisText(base(), reply({ checks: [{ key: "traffic", why: "A good place." }] }));
    assert.equal(result.checks[0].why, DEFAULT_WHY.concept.strong);
  });
});

describe("the split comes from the execution, not from the model", () => {
  test("a Mando part is its catalog label", () => {
    const execution = { items: [{ name: "Our shop", who: "mando", mandoKey: "online_store", costMin: null, costMax: null, hoursWeek: null, reason: "" }] } as unknown as Execution;
    assert.deepEqual(splitOf(execution).mando, ["Online store"]);
  });

  test("a part the model calls Mando's but that is not in the catalog is not Mando's", () => {
    const execution = buildExecution([{ name: "Accounting app", who: "mando", mando_key: "invented", cost_min: 300, cost_max: 400, hours_week: null, reason: "" }]);
    const split = splitOf(execution);
    assert.deepEqual(split.mando, []);
    assert.deepEqual(split.outsource, ["Accounting app"]);
  });

  test("the person's and the hired parts are their names; each list has at most four, cut to sixty characters", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `Task ${i} ${"x".repeat(80)}`, who: "you", mando_key: "", cost_min: null, cost_max: null, hours_week: 2, reason: "" }));
    const split = splitOf(buildExecution(many));
    assert.equal(split.you.length, MAX_DIAGNOSIS_SPLIT_ITEMS);
    assert.ok(split.you.every((name) => name.length <= MAX_DIAGNOSIS_SPLIT_ITEM));
  });

  test("no execution gives an empty split, which is valid", () => {
    const split = splitOf(undefined);
    assert.deepEqual(split, { mando: [], you: [], outsource: [] });
    assert.equal(DiagnosisSchema.safeParse({ ...base(), split }).success, true);
  });
});
