import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { CASES } from "../../eval/cases.js";
import { departmentOutcomes } from "../../eval/chain.js";
import { departmentsText, reasonsOf } from "../../eval/report.js";
import { runEvaluation, type EvalOptions } from "../../eval/run.js";
import { type AgentRequest, type AttemptFailure } from "../../plan/agents/contract.js";
import { EvalJudge, EvalModel, SENTINEL, validAnswer } from "./eval-fakes.js";

const ENV_OK = { AGENTS_EVAL: "1", OPENAI_API_KEY: "sk-TEST", OPENAI_MODEL: "model-x", TYPESAFE_API_KEY: "jev-TEST", JEV_MODEL: "jev-x" };

/** The departments of the restaurant case, in plan order */
function restaurantDepartments(): string[] {
  const skeleton = buildPlanSkeleton(CASES.find((item) => item.id === "restaurant")!.report());
  if (!skeleton.ok) throw new Error(skeleton.code);
  return skeleton.plan.departments.map((department) => department.id);
}

/** The file of a run whose name ends with `suffix` (the start time is part of each name) */
function pick(files: Record<string, string>, suffix: string): string {
  const name = Object.keys(files).find((item) => item.endsWith(suffix));
  assert.ok(name, `a file ending with ${suffix}`);
  return files[name];
}

/** Runs the restaurant case with the fakes, and returns the files it wrote, by name */
async function runWith(answer: (request: AgentRequest) => unknown): Promise<Record<string, string>> {
  const outputDir = mkdtempSync(join(tmpdir(), "eval-failure-report-"));
  try {
    const options: EvalOptions = {
      env: { ...ENV_OK },
      argv: ["--case", "restaurant"],
      now: () => "2026-10-10T10:00:00Z",
      clock: () => 0,
      makeAgents: (_record, failed) => ({ model: new EvalModel(answer), judge: new EvalJudge(), onFailure: failed }),
      outputDir,
      print: () => undefined,
    };
    assert.equal(await runEvaluation(options), 0);
    const files: Record<string, string> = {};
    for (const name of readdirSync(outputDir)) files[name] = readFileSync(join(outputDir, name), "utf8");
    return files;
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

test("8 of 10 departments failing by id_prefix: the summary lists those 8 ids and the count by reason, never a value", async () => {
  const departments = restaurantDepartments();
  assert.equal(departments.length, 10, "the restaurant case has ten departments");
  const failing = departments.slice(0, 8);
  const passing = departments.slice(8);

  const files = await runWith((request) => {
    const id = request.role.startsWith("department_") ? request.role.slice("department_".length) : undefined;
    if (id === undefined || !failing.includes(id)) return validAnswer(request);
    // The first evaluation's failure: ids without the department's prefix, with a value of the fake inside
    const { tasks } = validAnswer(request) as { tasks: { phaseId: string; derivedFrom: string[] }[] };
    return { tasks: [{ id: `obtain-${id}`, phaseId: tasks[0].phaseId, title: SENTINEL, derivedFrom: tasks[0].derivedFrom }], relations: [], facts: [], requests: [{ to: "plan", text: SENTINEL }], questions: [SENTINEL] };
  });

  const summary = pick(files, "resumen.md");
  assert.ok(summary.includes("## Fallos de los agentes"), "the summary has a failures section");
  for (const id of failing) assert.ok(summary.includes(`${id} (id_prefix)`), `lists the failing department ${id}`);
  for (const id of passing) assert.ok(!summary.includes(`${id} (`), `does not list the passing department ${id} as failing`);
  assert.ok(summary.includes(`8 fallaron del todo`));
  assert.ok(summary.includes(`2 a la primera`));
  assert.ok(summary.includes("Motivos en toda la ejecución: id_prefix 24"), "8 departments x 3 attempts, all id_prefix");

  const json = JSON.parse(pick(files, "-restaurant.json"));
  const levelDepartments = json.levels.find((level: { level: string }) => level.level === "departments");
  assert.equal(levelDepartments.departments.filter((item: { outcome: string }) => item.outcome === "failed").length, 8);
  assert.equal(levelDepartments.failures.length, 24);

  const markdown = pick(files, "-restaurant.md");
  assert.ok(markdown.includes("## Fallos de los agentes"));
  assert.ok(markdown.includes("24 (id_prefix 24)"), "the level table counts the failures by reason");

  assert.ok(Object.keys(files).length === 3, "the json, the markdown and the summary");
  for (const [name, text] of Object.entries(files)) assert.ok(!text.includes(SENTINEL), `${name} carries no value of the model`);
});

test("when every department passes first time, no failures section appears", async () => {
  const files = await runWith((request) => validAnswer(request as never));
  const summary = pick(files, "resumen.md");
  assert.ok(!summary.includes("## Fallos de los agentes"));
  const markdown = pick(files, "-restaurant.md");
  assert.ok(!markdown.includes("## Fallos de los agentes"));
  const json = JSON.parse(pick(files, "-restaurant.json"));
  const levelDepartments = json.levels.find((level: { level: string }) => level.level === "departments");
  assert.ok(levelDepartments.departments.every((item: { outcome: string }) => item.outcome === "first_try"));
});

test("departmentOutcomes: a pass after a retry is retried, a final failure is failed with its reason, the rest are first_try", () => {
  const failure = (role: string, attempt: number, final: boolean): AttemptFailure => ({ role, attempt, code: "invalid_output", reason: "id_prefix", final });
  const outcomes = departmentOutcomes([failure("department_legal", 1, false), failure("department_finance", 1, false), failure("department_finance", 2, true)], ["legal", "finance", "product"]);
  assert.deepEqual(outcomes, [
    { id: "legal", outcome: "retried", failedAttempts: 1 },
    { id: "finance", outcome: "failed", failedAttempts: 2, reason: "id_prefix" },
    { id: "product", outcome: "first_try", failedAttempts: 0 },
  ]);
  assert.equal(departmentsText(outcomes), "1 a la primera, 1 con reintentos, 1 fallaron del todo: finance (id_prefix)");
  const reasons: AttemptFailure[] = [failure("a", 1, false), failure("b", 1, true), failure("c", 1, true)];
  assert.deepEqual(reasonsOf(reasons), [["id_prefix", 3]]);
});
