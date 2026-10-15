import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_RULES, applyImprove, moneyCheck } from "../../plan/checks.js";
import { PLAN_TASK, effectOfAnswer, IMPROVE_BANK, optionsOf } from "../../plan/improve-questions.js";
import { applyDiagnosisText, baseDiagnosis, IDENTIFIED_WHY } from "../../plan/diagnosis-text.js";
import { DiagnosisSchema, type Diagnosis } from "../../plan/report.js";

// The answers of "Improve my report" move the statuses: each effect from each starting status, the gap that never
// becomes strong, one raise per category, the money rule decided again with a cushion, and nothing lowered.

type Status = Diagnosis["checks"][number]["status"];
type Key = Diagnosis["checks"][number]["key"];
const checks = (statuses: Partial<Record<Key, Status>> = {}): Diagnosis["checks"] =>
  (["concept", "location", "money", "experience", "competition"] as const).map((key) => ({
    key,
    status: statuses[key] ?? "strong",
    why: "rule text",
    estimated: false,
    decidedBy: "rule" as const,
  })) as Diagnosis["checks"];

const at = (list: Diagnosis["checks"], key: Key) => list.find((check) => check.key === key)!;
const NO_MONEY = { budget: 40_000, range: undefined };

/** Every option of a question, for every sector's list (the customer question has one list per sector) */
const SECTORS = [undefined, "Hospitality/Food service", "Health/Medicine", "Technology/SaaS", "Other"];
const allOptions = (question: (typeof IMPROVE_BANK)[number]) =>
  SECTORS.flatMap((sector) => optionsOf(question, sector));

describe("each effect from each starting status", () => {
  const starts: Status[] = ["risk", "watch", "strong"];
  const cases: [effect: string, answer: Record<string, string>, expected: Record<Status, Status>][] = [
    // good: one level up (the concept's "Product" is good)
    ["good", { imp_concept_difference: "Product" }, { risk: "watch", watch: "strong", strong: "strong" }],
    // partial: a risk becomes a watch; a watch stays ("Price" is partial)
    ["partial", { imp_concept_difference: "Price" }, { risk: "watch", watch: "watch", strong: "strong" }],
    // gap: a risk becomes a watch, a watch stays ("I don't know yet")
    ["gap", { imp_concept_difference: "I don't know yet" }, { risk: "watch", watch: "watch", strong: "strong" }],
    // none: no change (the one "none" option in the bank is not used here, so no answer is the same as none)
    ["none", {}, { risk: "risk", watch: "watch", strong: "strong" }],
  ];
  for (const [effect, answer, expected] of cases) {
    for (const start of starts) {
      test(`${effect} on a ${start} concept gives ${expected[start]}`, () => {
        const result = applyImprove(checks({ concept: start }), answer, { money: NO_MONEY });
        assert.equal(at(result, "concept").status, expected[start]);
      });
    }
  }

  test("an online business: the reach answer moves the reach check, the location is not in the list", () => {
    const online = checks({ concept: "strong" }).map((check) => (check.key === "location" ? { ...check, key: "reach" as const, status: "risk" as const } : check)) as Diagnosis["checks"];
    const result = applyImprove(online, { imp_reach_channel: "Partners" }, { money: NO_MONEY });
    assert.equal(result.find((check) => check.key === "reach")!.status, "watch");
  });

  test("the location and the reach answers move the check of their category, and nothing else", () => {
    const result = applyImprove(checks({ location: "risk", competition: "risk" }), { imp_location_premises: "Yes, a specific one" }, { money: NO_MONEY });
    assert.equal(at(result, "location").status, "watch");
    assert.equal(at(result, "competition").status, "risk");
  });
});

describe("a gap is never strong, and it names the check", () => {
  test("a gap on a risk is a watch and identified, with its plan task", () => {
    const result = applyImprove(checks({ concept: "risk" }), { imp_concept_difference: "I don't know yet" }, { money: NO_MONEY });
    const concept = at(result, "concept");
    assert.equal(concept.status, "watch");
    assert.equal(concept.identified, true);
    assert.equal(concept.planTask, PLAN_TASK.imp_concept_difference);
  });

  test("a gap on a strong check does not mark it: a strong check is not identified", () => {
    const result = applyImprove(checks({ concept: "strong" }), { imp_concept_difference: "I don't know yet" }, { money: NO_MONEY });
    assert.equal(at(result, "concept").status, "strong");
    assert.equal(at(result, "concept").identified, false);
    assert.equal(at(result, "concept").planTask, null);
  });

  test("a gap never raises a check to strong, even alone on a watch", () => {
    const result = applyImprove(checks({ location: "watch" }), { imp_location_premises: "Not yet" }, { money: NO_MONEY });
    assert.equal(at(result, "location").status, "watch");
    assert.equal(at(result, "location").identified, true);
  });

  test("a check without answers is not identified and has no plan task", () => {
    const result = applyImprove(checks({ concept: "risk" }), {}, { money: NO_MONEY });
    assert.equal(at(result, "concept").identified, false);
    assert.equal(at(result, "concept").planTask, null);
  });
});

describe("one raise per category, and nothing is lowered", () => {
  test("two answers in one category with a good and a partial: one raise, the better one", () => {
    const result = applyImprove(
      checks({ concept: "watch" }),
      { imp_concept_difference: "Product", imp_concept_customer: "Visitors and tourists" },
      { money: NO_MONEY },
    );
    assert.equal(at(result, "concept").status, "strong", "a good answer raises once, not once per answer");
  });

  test("a good and a gap in one category: the good counts, and the check is still identified", () => {
    const result = applyImprove(
      checks({ concept: "risk" }),
      { imp_concept_difference: "Product", imp_concept_customer: "I don't know yet" },
      { money: NO_MONEY },
    );
    assert.equal(at(result, "concept").status, "watch", "one raise: risk to watch, not to strong");
    assert.equal(at(result, "concept").identified, true);
  });

  test("a partial answer never lowers a strong check", () => {
    const result = applyImprove(checks({ concept: "strong" }), { imp_concept_difference: "Price" }, { money: NO_MONEY });
    assert.equal(at(result, "concept").status, "strong");
  });

  test("the statuses only go up, for every answer of the bank and every starting status", () => {
    const order: Status[] = ["risk", "watch", "strong"];
    // The reach checks are checked in their own test: this list has the physical checks (location, not reach)
    for (const question of IMPROVE_BANK.filter(({ category }) => category !== "reach")) {
      for (const { label } of allOptions(question)) {
        if (!effectOfAnswer(question.key, label)) continue;
        for (const start of order) {
          const result = applyImprove(checks({ [question.category]: start }), { [question.key]: label }, { money: NO_MONEY });
          assert.ok(order.indexOf(at(result, question.category).status) >= order.indexOf(start), `${question.key} "${label}" lowered ${start}`);
        }
      }
    }
  });
});

describe("money with a cushion: the money rule decides again", () => {
  const cushion = { imp_money_cushion: "Yes, 3+ months of costs" };

  test("a watch on money with a cushion becomes strong when the rule allows it (budget 40k, minimum 45k)", () => {
    const result = applyImprove(checks({ money: "watch" }), cushion, { money: { budget: 40_000, range: { min: 45_000 } } });
    assert.equal(at(result, "money").status, "strong");
    assert.equal(moneyCheck(40_000 + CHECK_RULES.money.cushionShare * 45_000, { min: 45_000 }).status, "strong");
  });

  test("a risk on money with a cushion becomes a watch, decided by the rule (budget 30k, minimum 45k)", () => {
    const result = applyImprove(checks({ money: "risk" }), cushion, { money: { budget: 30_000, range: { min: 45_000 } } });
    assert.equal(at(result, "money").status, "watch");
  });

  test("a cushion with no range to count it against is a plain step up", () => {
    const result = applyImprove(checks({ money: "risk" }), cushion, { money: NO_MONEY });
    assert.equal(at(result, "money").status, "watch");
  });

  test("a partial cushion is a plain partial, not a recalculation", () => {
    const result = applyImprove(checks({ money: "watch" }), { imp_money_cushion: "Some, less than 3 months" }, { money: { budget: 40_000, range: { min: 45_000 } } });
    assert.equal(at(result, "money").status, "watch");
  });
});

describe("the plan task of each gap, by question", () => {
  test("every gap answer of the bank has its plan task, and a task is short", () => {
    for (const question of IMPROVE_BANK) {
      if (!allOptions(question).some(({ effect }) => effect === "gap")) continue;
      assert.ok(PLAN_TASK[question.key], `${question.key} has no plan task`);
      assert.ok(PLAN_TASK[question.key].length <= 80);
    }
  });

  test("the task of the answer is the task of its question", () => {
    const result = applyImprove(checks({ money: "risk" }), { imp_money_financing: "No" }, { money: NO_MONEY });
    assert.equal(at(result, "money").planTask, "Build a cash cushion or find financing");
  });
});

describe("the texts of an identified check", () => {
  test("an identified check without a usable reason gets the identified text, which says the plan works on it", () => {
    const checked = applyImprove(checks({ concept: "risk" }), { imp_concept_difference: "I don't know yet" }, { money: NO_MONEY });
    const diagnosis = baseDiagnosis("Tapas bar", checked, undefined);
    const concept = diagnosis.checks.find((check) => check.key === "concept")!;
    assert.equal(concept.why, IDENTIFIED_WHY.concept);
    assert.match(concept.why, /your plan will work on it/);
  });

  test("a reason from the model that presents an identified check as settled is replaced", () => {
    const checked = applyImprove(checks({ concept: "risk" }), { imp_concept_difference: "I don't know yet" }, { money: NO_MONEY });
    const base = baseDiagnosis("Tapas bar", checked, undefined);
    const result = applyDiagnosisText(base, {
      idea: "Tapas bar",
      checks: [{ key: "concept", why: "The offer is solid and settled." }],
      risks: ["Rent."],
    });
    assert.equal(result.checks.find((check) => check.key === "concept")!.why, IDENTIFIED_WHY.concept);
  });

  test("a reason that says the check is not known yet is kept", () => {
    const checked = applyImprove(checks({ concept: "risk" }), { imp_concept_difference: "I don't know yet" }, { money: NO_MONEY });
    const base = baseDiagnosis("Tapas bar", checked, undefined);
    const result = applyDiagnosisText(base, {
      idea: "Tapas bar",
      checks: [{ key: "concept", why: "You do not know yet what sets you apart." }],
      risks: ["Rent."],
    });
    assert.equal(result.checks.find((check) => check.key === "concept")!.why, "You do not know yet what sets you apart.");
  });
});

describe("the schema of the new fields", () => {
  const base = { idea: "Tapas bar", risks: ["Rent."], split: { mando: [], you: [], outsource: [] } };
  test("a check with identified and a plan task passes", () => {
    const checked = applyImprove(checks({ concept: "risk" }), { imp_concept_difference: "I don't know yet" }, { money: NO_MONEY });
    assert.equal(DiagnosisSchema.safeParse({ ...base, checks: checked }).success, true);
  });

  test("a check without the new fields (kept before them) still passes", () => {
    assert.equal(DiagnosisSchema.safeParse({ ...base, checks: checks() }).success, true);
  });

  test("a plan task that is empty or too long is refused", () => {
    const withTask = (planTask: string) => checks().map((check, index) => (index === 0 ? { ...check, planTask } : check));
    assert.equal(DiagnosisSchema.safeParse({ ...base, checks: withTask("") }).success, false);
    assert.equal(DiagnosisSchema.safeParse({ ...base, checks: withTask("x".repeat(81)) }).success, false);
  });
});
