import { OTHER_USER, USER } from "../user-ids.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import {
  DiagnosisSchema,
  MAX_DIAGNOSIS_IDEA,
  MAX_DIAGNOSIS_RISK,
  MAX_DIAGNOSIS_RISKS,
  MAX_DIAGNOSIS_SPLIT_ITEM,
  MAX_DIAGNOSIS_SPLIT_ITEMS,
  MAX_DIAGNOSIS_WHY,
  parseReport,
} from "../../plan/report.js";
import { DIAGNOSIS_CHECK_KEYS, DIAGNOSIS_CHECK_STATUS, DIAGNOSIS_DECIDED_BY, DIAGNOSIS_REACH_KEY } from "../../plan/diagnosis-enums.js";
import { reportWith } from "./report-fixtures.js";

// The diagnosis is optional in the report: a report kept before it still reads without it, and a new one is checked
// with the limits of report-limits.ts. Five checks in a fixed order, each with its own key; nothing is repaired.

const check = (key: string, status = "strong", overrides: Record<string, unknown> = {}) => ({
  key,
  status,
  why: "Motivo corto y claro.",
  estimated: false,
  decidedBy: "rule",
  ...overrides,
});

const valid = {
  idea: "Bar de tapas en Malasaña para vecinos y turistas.",
  checks: [
    check("concept"),
    check("location"),
    check("money", "watch", { estimated: true }),
    check("experience"),
    check("competition", "risk", { decidedBy: "jev" }),
  ],
  risks: ["El alquiler de la zona sube cada año."],
  split: { mando: ["Compras", "Cuentas"], you: ["Atención al cliente"], outsource: ["Contabilidad"] },
};

const before = () => reportWith();
const withDiagnosis = (value: unknown) => ({ ...before(), diagnosis: value });
const read = (report: unknown) => parseReport(JSON.stringify(report));
const refuse = (value: unknown) => assert.deepEqual(read(withDiagnosis(value)), { ok: false, code: "invalid_report" });
const withChecks = (checks: unknown[]) => ({ ...valid, checks });

describe("the report schema: diagnosis, the shape", () => {
  test("a report kept before the diagnosis existed still reads, without one", () => {
    const result = read(before());
    assert.equal(result.ok, true);
    assert.equal(result.ok && "diagnosis" in result.report, false);
  });

  test("a report with a valid diagnosis reads, and keeps it as it was", () => {
    const result = read(withDiagnosis(valid));
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.report.diagnosis, valid);
  });

  test("the five check keys are the ones the diagnosis names, in their order", () => {
    assert.deepEqual([...DIAGNOSIS_CHECK_KEYS], ["concept", "location", "money", "experience", "competition"]);
    assert.deepEqual([...DIAGNOSIS_CHECK_STATUS], ["strong", "watch", "risk"]);
    assert.deepEqual([...DIAGNOSIS_DECIDED_BY], ["rule", "jev"]);
    assert.equal(DIAGNOSIS_REACH_KEY, "reach");
  });

  test("an online business may use reach in place of location, as the second check", () => {
    const online = withChecks([check("concept"), check("reach"), check("money"), check("experience"), check("competition")]);
    assert.equal(DiagnosisSchema.safeParse(online).success, true);
  });

  test("reach is not accepted in any other place", () => {
    const misplaced = withChecks([check("concept"), check("money"), check("reach"), check("experience"), check("competition")]);
    assert.equal(DiagnosisSchema.safeParse(misplaced).success, false);
  });

  test("the diagnosis may be given to the schema alone, as its own type", () => {
    assert.equal(DiagnosisSchema.safeParse(valid).success, true);
    assert.equal(DiagnosisSchema.safeParse({ ...valid, idea: undefined }).success, false);
  });
});

describe("the report schema: diagnosis, the checks", () => {
  test("four checks are refused", () => {
    refuse(withChecks(valid.checks.slice(0, 4)));
  });

  test("six checks are refused", () => {
    refuse(withChecks([...valid.checks, check("money")]));
  });

  test("no checks at all is refused", () => {
    refuse(withChecks([]));
  });

  test("a repeated key in place of another is refused", () => {
    // money twice, and no competition
    refuse(withChecks([check("concept"), check("location"), check("money"), check("money"), check("experience")]));
  });

  test("the checks out of order are refused", () => {
    const swapped = [valid.checks[1], valid.checks[0], ...valid.checks.slice(2)];
    refuse(withChecks(swapped));
  });

  test("an unknown key is refused", () => {
    refuse(withChecks([check("concept"), check("location"), check("money"), check("experience"), check("traffic")]));
  });

  test("a status other than strong, watch or risk is refused", () => {
    refuse(withChecks([check("concept", "great"), ...valid.checks.slice(1)]));
    refuse(withChecks([check("concept", "Strong"), ...valid.checks.slice(1)]));
  });

  test("decidedBy other than rule or jev is refused", () => {
    refuse(withChecks([check("concept", "strong", { decidedBy: "model" }), ...valid.checks.slice(1)]));
  });

  test("estimated must be a boolean", () => {
    refuse(withChecks([check("concept", "strong", { estimated: "yes" }), ...valid.checks.slice(1)]));
  });

  test("an extra field inside a check is refused", () => {
    refuse(withChecks([check("concept", "strong", { score: 80 }), ...valid.checks.slice(1)]));
  });

  test(`a why of exactly ${MAX_DIAGNOSIS_WHY} characters is valid, and one more is refused, not cut`, () => {
    const exact = withChecks([check("concept", "strong", { why: "x".repeat(MAX_DIAGNOSIS_WHY) }), ...valid.checks.slice(1)]);
    assert.equal(read(withDiagnosis(exact)).ok, true);

    const over = withChecks([check("concept", "strong", { why: "x".repeat(MAX_DIAGNOSIS_WHY + 1) }), ...valid.checks.slice(1)]);
    refuse(over);
  });

  test("an empty why is refused", () => {
    refuse(withChecks([check("concept", "strong", { why: "   " }), ...valid.checks.slice(1)]));
  });

  test("a NUL character in a why is refused", () => {
    refuse(withChecks([check("concept", "strong", { why: "a\u0000b" }), ...valid.checks.slice(1)]));
  });
});

describe("the report schema: diagnosis, the idea, the risks and the split", () => {
  test(`an idea of exactly ${MAX_DIAGNOSIS_IDEA} characters is valid, and one more is refused`, () => {
    assert.equal(read(withDiagnosis({ ...valid, idea: "x".repeat(MAX_DIAGNOSIS_IDEA) })).ok, true);
    refuse({ ...valid, idea: "x".repeat(MAX_DIAGNOSIS_IDEA + 1) });
  });

  test("an empty idea is refused", () => {
    refuse({ ...valid, idea: "" });
  });

  test("a NUL character in the idea is refused", () => {
    refuse({ ...valid, idea: "Bar\u0000" });
  });

  test("no risk is refused, and one or three risks are valid", () => {
    refuse({ ...valid, risks: [] });
    assert.equal(read(withDiagnosis({ ...valid, risks: ["Uno."] })).ok, true);
    assert.equal(read(withDiagnosis({ ...valid, risks: ["Uno.", "Dos.", "Tres."] })).ok, true);
  });

  test(`more than ${MAX_DIAGNOSIS_RISKS} risks are refused`, () => {
    refuse({ ...valid, risks: ["Uno.", "Dos.", "Tres.", "Cuatro."] });
  });

  test(`a risk of ${MAX_DIAGNOSIS_RISK} characters is valid, and one more is refused`, () => {
    assert.equal(read(withDiagnosis({ ...valid, risks: ["x".repeat(MAX_DIAGNOSIS_RISK)] })).ok, true);
    refuse({ ...valid, risks: ["x".repeat(MAX_DIAGNOSIS_RISK + 1)] });
  });

  test("the split has exactly its three lists: a missing or an extra list is refused", () => {
    refuse({ ...valid, split: { mando: [], you: [] } });
    refuse({ ...valid, split: { ...valid.split, partner: ["Socio"] } });
  });

  test(`a split list of ${MAX_DIAGNOSIS_SPLIT_ITEMS} items is valid, and more are refused`, () => {
    const four = Array.from({ length: MAX_DIAGNOSIS_SPLIT_ITEMS }, (_, i) => `Tarea ${i}`);
    assert.equal(read(withDiagnosis({ ...valid, split: { mando: four, you: [], outsource: [] } })).ok, true);
    refuse({ ...valid, split: { mando: [...four, "Quinta"], you: [], outsource: [] } });
  });

  test(`a split item of ${MAX_DIAGNOSIS_SPLIT_ITEM} characters is valid, and one more is refused`, () => {
    const exact = { mando: ["x".repeat(MAX_DIAGNOSIS_SPLIT_ITEM)], you: [], outsource: [] };
    assert.equal(read(withDiagnosis({ ...valid, split: exact })).ok, true);
    refuse({ ...valid, split: { mando: ["x".repeat(MAX_DIAGNOSIS_SPLIT_ITEM + 1)], you: [], outsource: [] } });
  });

  test("an empty split list is valid", () => {
    assert.equal(read(withDiagnosis({ ...valid, split: { mando: [], you: [], outsource: [] } })).ok, true);
  });
});

describe("the diagnosis is stored and read back", () => {
  test("a report with a diagnosis is saved and comes back equal", async () => {
    const repo = new InMemoryReportRepository();
    const report = { ...reportWith(), diagnosis: valid };
    const id = await repo.create(USER, report);
    const stored = await repo.get(id, USER);
    assert.deepEqual(stored?.report.diagnosis, valid);
  });

  test("a report kept before the diagnosis is still read, and has none", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create(USER, reportWith());
    const stored = await repo.get(id, USER);
    assert.ok(stored);
    assert.equal("diagnosis" in stored.report, false);
  });

  test("a diagnosis that does not pass is not saved", async () => {
    const repo = new InMemoryReportRepository();
    await assert.rejects(repo.create(USER, { ...reportWith(), diagnosis: { ...valid, checks: valid.checks.slice(0, 4) } }));
    assert.equal(repo.rows.size, 0);
  });

  test("another user cannot read a report with a diagnosis", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create(USER, { ...reportWith(), diagnosis: valid });
    assert.equal(await repo.get(id, OTHER_USER), undefined);
  });
});
