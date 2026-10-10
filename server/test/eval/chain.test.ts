import { test } from "node:test";
import assert from "node:assert/strict";
import { createBudget, withBudget } from "../../eval/budget.js";
import { runCase, type CallLogEntry, type ChainDeps } from "../../eval/chain.js";
import { CASES, caseById } from "../../eval/cases.js";
import { caseJson, caseMarkdown, summaryMarkdown, totalsOf, type CaseReport } from "../../eval/report.js";
import { EvalJudge, EvalModel, SENTINEL } from "./eval-fakes.js";

const clock = () => 0;
const now = () => "2026-10-10T10:00:00Z";

function depsWith(model: EvalModel, judge: EvalJudge, options: { limit?: number; taskCount?: number; calls?: CallLogEntry[] } = {}): ChainDeps {
  const budget = createBudget(options.limit ?? 1000);
  return {
    agents: withBudget({ model, judge }, budget),
    budget,
    calls: options.calls ?? [],
    now,
    clock,
    taskCount: options.taskCount ?? 2,
  };
}

const restaurant = caseById("restaurant")!;

test("the full chain reaches the steps level with every level ok, no new problems and the expectations met", async () => {
  const model = new EvalModel();
  const judge = new EvalJudge();
  const run = await runCase(restaurant, depsWith(model, judge));

  assert.deepEqual(
    run.levels.map((level) => [level.level, level.ok]),
    [
      ["setup", true],
      ["plan", true],
      ["departments", true],
      ["tasks", true],
      ["steps", true],
    ],
  );
  assert.equal(run.stoppedBy, undefined);
  assert.ok(run.levels.every((level) => level.newProblems === 0), "no acceptance may add a problem");
  assert.equal(run.levels[0].counts["hechos confirmados"], restaurant.facts.length);
  assert.equal(run.levels[3].counts["tareas elegidas"], 2);
  assert.equal(run.levels[4].counts["caracteres del documento"] > 0, true);
  assert.deepEqual(run.expectations, [{ id: "legal-licences", description: restaurant.expectations[0].description, passed: true }]);
  assert.deepEqual(run.relations.departments, ["«Legal & Compliance» debe estar lista antes que «Finance»"]);
  assert.ok(run.relations.tasks.some((text) => text.includes("debe estar lista antes que")), "the task order is read in words");
  assert.ok(Object.keys(run.tasksByDepartment).includes("Legal & Compliance"));
});

test("the tasks level takes its tasks from different departments, in the same order every time", async () => {
  const first = await runCase(restaurant, depsWith(new EvalModel(), new EvalJudge(), { taskCount: 3 }));
  const second = await runCase(restaurant, depsWith(new EvalModel(), new EvalJudge(), { taskCount: 3 }));
  assert.deepEqual(first.levels.map(({ ms, tokens, ...rest }) => rest), second.levels.map(({ ms, tokens, ...rest }) => rest));
  assert.deepEqual(first.tasksByDepartment, second.tasksByDepartment);
  assert.deepEqual(first.relations, second.relations);
  assert.equal(first.levels[3].counts["tareas elegidas"], 3);
});

test("a level that fails stops the case: its code is kept and no later level runs", async () => {
  const model = new EvalModel(validAlwaysFails());
  const judge = new EvalJudge();
  const run = await runCase(restaurant, depsWith(model, judge));

  assert.equal(run.stoppedBy, "agent_failed");
  assert.deepEqual(run.levels.map((level) => [level.level, level.ok, level.code]), [
    ["setup", true, undefined],
    ["plan", false, "agent_failed"],
  ]);
  assert.equal(run.expectations, undefined, "the checks are not evaluated when the departments level did not finish");
  assert.equal(run.levels[1].modelCalls, 3, "three attempts, all counted");
  assert.equal(run.levels[1].judgeCalls, 0, "no failed answer reaches the judge");
});

test("a failure twice and then a success counts three model calls for that level", async () => {
  const model = new EvalModel(undefined, { plan_generate: 2 });
  const judge = new EvalJudge();
  const run = await runCase(restaurant, depsWith(model, judge));

  assert.equal(run.stoppedBy, undefined);
  assert.equal(run.levels[1].ok, true);
  assert.equal(run.levels[1].modelCalls, 3);
  assert.equal(run.levels[1].judgeCalls, 1);
  assert.deepEqual(run.levels[1].verdicts, ["fits"]);
});

test("the hard cap refuses the next call before it is made, and the chain stops with budget_exhausted", async () => {
  const model = new EvalModel();
  const judge = new EvalJudge();
  const budget = createBudget(5);
  const deps: ChainDeps = { agents: withBudget({ model, judge }, budget), budget, calls: [], now, clock, taskCount: 2 };
  const run = await runCase(restaurant, deps);

  assert.equal(model.requests.length + judge.calls, 5, "the fakes received exactly the calls allowed, no more");
  assert.equal(budget.exhausted, true);
  assert.equal(budget.used, 5);
  assert.equal(run.stoppedBy, "budget_exhausted");
  assert.equal(run.levels.at(-1)!.level, "departments");
});

test("a case that starts with the budget used up does not call anything", async () => {
  const model = new EvalModel();
  const judge = new EvalJudge();
  const budget = createBudget(0);
  const deps: ChainDeps = { agents: withBudget({ model, judge }, budget), budget, calls: [], now, clock, taskCount: 2 };
  const run = await runCase(restaurant, deps);
  assert.equal(model.requests.length, 0);
  assert.equal(judge.calls, 0);
  assert.equal(run.stoppedBy, "budget_exhausted");
});

test("the report files hold no text of the model and no key, only numbers, titles and codes", async () => {
  const secret = "sk-TEST-SECRET-KEY-DO-NOT-REPORT";
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = secret;
  try {
    const run = await runCase(restaurant, depsWith(new EvalModel(), new EvalJudge()));
    const report: CaseReport = {
      run,
      info: { startedAt: now(), models: { openai: "model-x", jev: "jev-x" }, repetition: 1, repetitions: 1 },
      budget: { limit: 1000, used: 0, exhausted: false },
      totals: totalsOf(run.levels),
    };
    const files = caseJson(report, undefined) + caseMarkdown(report, undefined) + summaryMarkdown([report], [], undefined, { startedAt: now(), models: report.info.models, limit: 1000, used: 0, exhausted: false });
    assert.equal(files.includes(SENTINEL), false, "the fake's sentinel text must not reach a report");
    assert.equal(files.includes(secret), false, "no key may reach a report");
    assert.equal(files.includes("Documento del paso"), false, "no document text may reach a report");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("every case reaches the steps level with the fakes (the cases are valid for the chain)", async () => {
  for (const evalCase of CASES) {
    const run = await runCase(evalCase, depsWith(new EvalModel(), new EvalJudge()));
    assert.equal(run.stoppedBy, undefined, `${evalCase.id} stopped at ${run.stoppedBy}`);
    assert.ok(run.levels.every((level) => level.newProblems === 0), `${evalCase.id} added problems`);
  }
});

/** An answer for every role that always fails: the model is unavailable */
function validAlwaysFails(): (request: { role: string }) => unknown {
  return () => {
    throw new Error("unavailable");
  };
}
