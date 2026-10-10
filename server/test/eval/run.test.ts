import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { CASES } from "../../eval/cases.js";
import { costOf, totalsOf } from "../../eval/report.js";
import { estimateCase, parseArguments, pricesOf, runEvaluation, type EvalOptions } from "../../eval/run.js";
import { EvalJudge, EvalModel } from "./eval-fakes.js";

const ENV_OK = { AGENTS_EVAL: "1", OPENAI_API_KEY: "sk-TEST", OPENAI_MODEL: "model-x", TYPESAFE_API_KEY: "jev-TEST", JEV_MODEL: "jev-x" };
const PRICES = { EVAL_PRICE_OPENAI_IN: "2", EVAL_PRICE_OPENAI_OUT: "8", EVAL_PRICE_JEV_IN: "1", EVAL_PRICE_JEV_OUT: "3" };

/** The options of one run, with a folder of its own. `made` counts how many times the agents were built */
function options(overrides: Partial<EvalOptions> = {}): EvalOptions & { made: { count: number }; lines: string[] } {
  const made = { count: 0 };
  const lines: string[] = [];
  return {
    env: { ...ENV_OK },
    argv: ["--case", "restaurant"],
    now: () => "2026-10-10T10:00:00Z",
    clock: () => 0,
    outputDir: mkdtempSync(join(tmpdir(), "eval-run-")),
    print: (line: string) => lines.push(line),
    makeAgents: () => {
      made.count += 1;
      return { model: new EvalModel(), judge: new EvalJudge() };
    },
    ...overrides,
    made,
    lines,
  };
}

test("without AGENTS_EVAL=1 it sends nothing: no client, no folder, exit 0", async () => {
  const run = options({ env: {} });
  const code = await runEvaluation(run);
  assert.equal(code, 0);
  assert.equal(run.made.count, 0, "no agents are built");
  assert.match(run.lines.join("\n"), /Nothing sent/);
  assert.equal(existsSync(join(run.outputDir, "never")), false, "no folder of results is created");
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("with the variables missing it names them (not their values) and stops", async () => {
  const run = options({ env: { AGENTS_EVAL: "1", OPENAI_API_KEY: "sk-SECRET", OPENAI_MODEL: "m" } });
  assert.equal(await runEvaluation(run), 1);
  assert.equal(run.made.count, 0);
  const text = run.lines.join("\n");
  assert.match(text, /TYPESAFE_API_KEY, JEV_MODEL/);
  assert.equal(text.includes("sk-SECRET"), false);
});

test("a bad argument or a bad EVAL_TASKS stops before any call", async () => {
  for (const extra of [{ argv: ["--case", "nope"] }, { argv: ["--repeat", "4"] }, { env: { ...ENV_OK, EVAL_TASKS: "9" } }, { env: { ...ENV_OK, EVAL_MAX_CALLS: "0" } }]) {
    const run = options(extra);
    assert.equal(await runEvaluation(run), 1);
    assert.equal(run.made.count, 0);
  }
});

test("the command line: one case by default, --all for four, --repeat up to three", () => {
  const one = parseArguments([], CASES);
  assert.ok(typeof one !== "string");
  assert.deepEqual(one.cases.map((item) => item.id), ["restaurant"]);
  const all = parseArguments(["--all", "--repeat", "2"], CASES);
  assert.ok(typeof all !== "string");
  assert.equal(all.cases.length, 4);
  assert.equal(all.repeat, 2);
  assert.equal(typeof parseArguments(["--repeat", "0"], CASES), "string");
  assert.equal(typeof parseArguments(["--whatever"], CASES), "string");
});

test("the estimate: model calls per case, and calls with Jev from one attempt to three", () => {
  const skeleton = buildPlanSkeleton(CASES[0].report());
  assert.ok(skeleton.ok);
  const departments = skeleton.plan.departments.length;
  const estimate = estimateCase(departments, 2);
  const modelCalls = 1 + departments + 1 + 2 + 1;
  assert.equal(estimate.modelCalls, modelCalls);
  assert.equal(estimate.min, modelCalls * 2);
  assert.equal(estimate.max, modelCalls * 6);
});

test("the cost is written only when the four prices are all there", () => {
  assert.equal(pricesOf({ ...PRICES, EVAL_PRICE_JEV_OUT: undefined }).prices, undefined);
  assert.deepEqual(pricesOf({ ...PRICES, EVAL_PRICE_JEV_OUT: undefined }).incomplete, ["EVAL_PRICE_JEV_OUT"]);
  assert.equal(pricesOf({ ...PRICES, EVAL_PRICE_JEV_OUT: "abc" }).prices, undefined);
  const { prices } = pricesOf(PRICES);
  assert.ok(prices);
  const totals = totalsOf([
    {
      level: "plan",
      ok: true,
      modelCalls: 1,
      judgeCalls: 1,
      verdicts: ["fits"],
      ms: 5,
      tokens: { model: { input: 1_000_000, output: 500_000, missing: 0 }, judge: { input: 1_000_000, output: 0, missing: 0 } },
      counts: {},
      newProblems: 0,
    },
  ]);
  // 1M * 2 + 0.5M * 8 + 1M * 1 = 2 + 4 + 1
  assert.equal(costOf(totals, prices), 7);
  assert.equal(costOf(totals, undefined), undefined);
});

test("a full run with the fakes writes the json, the markdown and the summary, and nothing secret", async () => {
  const run = options({ argv: ["--all"], env: { ...ENV_OK, ...PRICES, EVAL_TASKS: "2" } });
  const code = await runEvaluation(run);
  assert.equal(code, 0);
  assert.equal(run.made.count, 1, "the agents are built once, for the whole run");

  const files = readdirSync(run.outputDir).sort();
  assert.equal(files.length, 4 * 2 + 1, "a json and a markdown per case, and the summary");
  assert.ok(files.some((name) => name.endsWith("-resumen.md")));
  const jsonFile = files.find((name) => name.endsWith("-restaurant.json"))!;
  const json = JSON.parse(readFileSync(join(run.outputDir, jsonFile), "utf8"));
  assert.equal(json.heuristic, true);
  assert.equal(json.levels.length, 5);
  assert.equal(json.run.models.openai, "model-x");
  assert.equal(typeof json.costUsd, "number", "the cost is there with the four prices");

  const everything = files.map((name) => readFileSync(join(run.outputDir, name), "utf8")).join("\n");
  assert.equal(everything.includes("sk-TEST"), false);
  assert.equal(everything.includes("jev-TEST"), false);
  assert.match(run.lines.join("\n"), /Estimated calls/);
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("the run stops at the cap: the cases that did not start are named, and the summary says so", async () => {
  const run = options({ argv: ["--all"], env: { ...ENV_OK, EVAL_MAX_CALLS: "5" } });
  assert.equal(await runEvaluation(run), 0);
  const summary = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((name) => name.endsWith("-resumen.md"))!), "utf8");
  assert.match(summary, /PRESUPUESTO AGOTADO/);
  assert.match(summary, /No ejecutados por el presupuesto: saas, physio, marketplace/);
  assert.match(summary, /Coste: no se calcula/);
  rmSync(run.outputDir, { recursive: true, force: true });
});
