import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRequest } from "../../plan/agents/contract.js";
import { CASES, type EvalCase } from "../../eval/cases.js";
import { parseArguments, runEvaluation, type EvalOptions } from "../../eval/run.js";
import { recordDeps, readRecording } from "../../eval/record.js";
import { withSyntheticTasks } from "../../eval/synthetic.js";
import { z } from "zod";
import { confirmFact, proposeFact } from "../../plan/fact-actions.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { EvalJudge, EvalModel, SENTINEL, section, validAnswer } from "./eval-fakes.js";

const ENV_OK = { AGENTS_EVAL: "1", OPENAI_API_KEY: "sk-TEST", OPENAI_MODEL: "model-x", TYPESAFE_API_KEY: "jev-TEST", JEV_MODEL: "jev-x" };
const PROMPT_SENTINEL = "PROMPT-SENTINEL-4c1e";

/** A case whose idea carries a sentinel: the idea goes into every prompt, so it must never reach a report or a recording */
const promptCase: EvalCase = {
  ...CASES[0],
  report: () => {
    const report = CASES[0].report();
    return { ...report, input: { ...report.input, idea: `Idea ${PROMPT_SENTINEL}` } };
  },
};

/** Answers the valid way, except three levels, each broken in a different way: a schema error, a prefix error, a clash with no task */
function brokenAnswer(request: AgentRequest): unknown {
  if (request.role === "plan_generate") return { phases: [] };
  if (request.role === "department_finance") {
    return {
      tasks: [{ id: "obtain-licences", phaseId: section(request.user, "phases")[0].id, title: "Obtain the licence", derivedFrom: [section(request.user, "confirmed_facts")[0].id] }],
      relations: [],
      facts: [],
      requests: [],
      questions: [],
    };
  }
  if (request.role === "plan_review") return { findings: [{ kind: "clash", taskIds: [], text: "Two prices" }], adjustments: [], facts: [], requests: [], questions: [] };
  return validAnswer(request);
}

/** The options of one run in a folder of its own; `made` counts the clients built, `lines` what was printed */
function options(overrides: Partial<EvalOptions> = {}, model: EvalModel = new EvalModel(), judge: EvalJudge = new EvalJudge()) {
  const made = { count: 0 };
  const lines: string[] = [];
  const outputDir = mkdtempSync(join(tmpdir(), "eval-levels-"));
  const run: EvalOptions & { made: { count: number }; lines: string[]; model: EvalModel; judge: EvalJudge } = {
    env: { ...ENV_OK },
    argv: ["--case", "restaurant"],
    now: () => "2026-10-10T10:00:00Z",
    clock: () => 0,
    outputDir,
    print: (line: string) => lines.push(line),
    cases: [CASES[0]],
    makeAgents: (_record, failed) => {
      made.count += 1;
      return { model, judge, onFailure: failed };
    },
    ...overrides,
    made,
    lines,
    model,
    judge,
  };
  return run;
}

/** The JSON of the restaurant case of a run folder (the file name ends with -<name>.json) */
function caseJsonOf(outputDir: string, name = "restaurant") {
  const file = readdirSync(outputDir).find((item) => item.endsWith(`-${name}.json`));
  assert.ok(file, `a json of ${name}`);
  return JSON.parse(readFileSync(join(outputDir, file), "utf8"));
}

/** Every file a run wrote to its folder (not the recordings), as one text: for the privacy checks */
function everythingWritten(outputDir: string): string {
  return readdirSync(outputDir)
    .filter((name) => !name.startsWith("recordings"))
    .map((name) => readFileSync(join(outputDir, name), "utf8"))
    .join("\n");
}

test("the levels mode is the default: five levels, each on its own, and a failure does not stop the others", async () => {
  const run = options({}, new EvalModel(brokenAnswer));
  assert.equal(await runEvaluation(run), 0);
  const json = caseJsonOf(run.outputDir);
  assert.equal(json.case.mode, "levels");
  assert.deepEqual(
    json.levels.map((level: { level: string }) => level.level),
    ["plan", "departments", "review", "tasks", "steps"],
  );
  assert.deepEqual(
    json.levels.map((level: { ok: boolean }) => level.ok),
    [false, false, false, true, true],
    "the broken levels fail; the review is not evaluated (no department proposed) and the tasks and the steps still run and pass",
  );
  assert.equal(json.levels[2].notEvaluated, "departamentos sin propuestas");
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("the summary of each level names its failure: the label of the rule that broke it, and the departments that failed", async () => {
  const run = options({}, new EvalModel(brokenAnswer));
  await runEvaluation(run);
  const json = caseJsonOf(run.outputDir);
  const byLevel = Object.fromEntries(json.levelSummary.map((item: { level: string }) => [item.level, item]));
  assert.equal(byLevel.plan.code, "invalid_output");
  assert.deepEqual(byLevel.plan.reasons, [{ reason: "schema", count: 3 }]);
  assert.equal(byLevel.departments.code, "invalid_output");
  assert.deepEqual(byLevel.departments.reasons, [{ reason: "id_prefix", count: 3 }]);
  assert.equal(byLevel.review.status, "no evaluada", "no department proposed, so the review does not run");
  assert.equal(byLevel.review.notEvaluated, "departamentos sin propuestas");
  assert.deepEqual(byLevel.review.reasons, []);
  assert.equal(byLevel.tasks.ok, true);
  assert.equal(byLevel.steps.ok, true);
  const finance = json.levels.find((level: { level: string }) => level.level === "departments").departments.find((item: { id: string }) => item.id === "finance");
  assert.equal(finance.outcome, "failed");
  assert.equal(finance.reason, "id_prefix");
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("every file starts with the table of the levels: the json by its first key, the markdown and the summary by their first section", async () => {
  const run = options({}, new EvalModel(brokenAnswer));
  await runEvaluation(run);
  const json = caseJsonOf(run.outputDir);
  assert.equal(Object.keys(json)[0], "levelSummary");
  const markdown = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-restaurant.md"))!), "utf8");
  assert.ok(markdown.indexOf("## Resumen por nivel") < markdown.indexOf("## Niveles"));
  assert.match(markdown, /\| plan \| fallo \| invalid_output \| schema 3 \|/);
  const summary = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-resumen.md"))!), "utf8");
  assert.ok(summary.indexOf("## Resumen por nivel") < summary.indexOf("## Fallos de los agentes"));
  assert.match(summary, /\| departments \| fallo: invalid_output \(id_prefix 3\)/);
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("the chain is unchanged: --mode chain runs setup and then stops at its first failure", async () => {
  const chain = options({ argv: ["--case", "restaurant", "--mode", "chain"] }, new EvalModel(brokenAnswer));
  assert.equal(await runEvaluation(chain), 0);
  const json = caseJsonOf(chain.outputDir);
  assert.equal(json.case.mode, "chain");
  assert.deepEqual(
    json.levels.map((level: { level: string }) => level.level),
    ["setup", "plan"],
    "the chain stops at the plan level, the first one that fails, and the levels after it do not run",
  );
  assert.equal(json.stoppedBy, "invalid_output");
  rmSync(chain.outputDir, { recursive: true, force: true });
});

test("the cap is hard in the levels mode: no call past it, and the levels after it record budget_exhausted", async () => {
  const run = options({ env: { ...ENV_OK, EVAL_MAX_CALLS: "6" } }, new EvalModel(validAnswer));
  assert.equal(await runEvaluation(run), 0);
  const calls = run.model.requests.length + run.judge.calls;
  assert.ok(calls <= 6, `at most 6 calls, made ${calls}`);
  const json = caseJsonOf(run.outputDir);
  assert.equal(json.budget.exhausted, true);
  assert.ok(json.levels.some((level: { code?: string }) => level.code === "budget_exhausted"));
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("the reports carry no prompt, no key and no answer text: the idea and the sentinel of the answers stay out", async () => {
  const run = options({ cases: [promptCase] }, new EvalModel(validAnswer));
  assert.equal(await runEvaluation(run), 0);
  const written = everythingWritten(run.outputDir);
  assert.equal(written.includes(PROMPT_SENTINEL), false, "the idea (in every prompt) is not written");
  assert.equal(written.includes(SENTINEL), false, "no text the model wrote beyond a title is written");
  assert.equal(written.includes("sk-TEST"), false);
  assert.ok(run.model.requests.some((request) => request.user.includes(PROMPT_SENTINEL)), "the sentinel really was in a prompt");
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("EVAL_RECORD=1 keeps the role and the answer of each call, never the prompt", async () => {
  const run = options({ env: { ...ENV_OK, EVAL_RECORD: "1" }, cases: [promptCase] }, new EvalModel(validAnswer));
  assert.equal(await runEvaluation(run), 0);
  const folder = join(run.outputDir, "recordings", readdirSync(join(run.outputDir, "recordings"))[0]);
  const file = join(folder, "restaurant.jsonl");
  assert.ok(existsSync(file), "one recording per case");
  const text = readFileSync(file, "utf8");
  assert.equal(text.includes(PROMPT_SENTINEL), false, "the prompt (with the idea) is never written");
  const allowed = ["kind", "role", "answer", "error", "verdict"];
  for (const line of text.trim().split("\n")) {
    const parsed = JSON.parse(line);
    assert.deepEqual(
      Object.keys(parsed).filter((key) => !allowed.includes(key)),
      [],
      "a line holds only the kind, the role, the answer, the error flag or the verdict",
    );
  }
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("the recorder writes only the role and the answer of a call, even when the request holds a sentinel", async () => {
  const lines: unknown[] = [];
  const deps = recordDeps(
    { model: new EvalModel(() => ({ answer: "ok" })), judge: new EvalJudge(true) },
    (line) => lines.push(line),
  );
  await deps.model.complete({ role: "plan_generate", system: `system ${PROMPT_SENTINEL}`, user: `user ${PROMPT_SENTINEL}`, schema: z.unknown() });
  assert.deepEqual(lines[0], { kind: "model", role: "plan_generate", answer: { answer: "ok" } });
  assert.equal(JSON.stringify(lines).includes(PROMPT_SENTINEL), false);
});

test("a replay of a recording makes no call and no client: same levels and codes as the run that recorded it", async () => {
  // The recording: a real run with the fakes, with EVAL_RECORD=1
  const recorded = options({ env: { ...ENV_OK, EVAL_RECORD: "1" } }, new EvalModel(brokenAnswer));
  assert.equal(await runEvaluation(recorded), 0);
  const folder = join(recorded.outputDir, "recordings", readdirSync(join(recorded.outputDir, "recordings"))[0]);
  const before = caseJsonOf(recorded.outputDir).levelSummary;

  // The replay: no key, no AGENTS_EVAL, no client built, and any network call would throw
  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("the network is not allowed in a replay");
  }) as typeof fetch;
  try {
    const replay = options({ env: {}, argv: ["--replay", folder, "--case", "restaurant"] });
    assert.equal(await runEvaluation(replay), 0);
    assert.equal(replay.made.count, 0, "no client is built");
    assert.equal(replay.model.requests.length, 0, "the fake of the run is never called");
    assert.equal(replay.judge.calls, 0, "Jev is never called");
    assert.equal(networkCalls, 0, "no network call");
    assert.deepEqual(caseJsonOf(replay.outputDir).levelSummary, before, "the replay reproduces the levels of the recording");
    rmSync(replay.outputDir, { recursive: true, force: true });
  } finally {
    globalThis.fetch = realFetch;
  }
  rmSync(recorded.outputDir, { recursive: true, force: true });
});

test("a replay needs its recording: a case with none is named and not run; a folder that does not exist stops", async () => {
  const empty = mkdtempSync(join(tmpdir(), "eval-empty-"));
  const run = options({ env: {}, argv: ["--replay", empty, "--case", "restaurant"] });
  assert.equal(await runEvaluation(run), 0);
  assert.match(run.lines.join("\n"), /restaurant: no recording/);
  assert.equal(run.made.count, 0);
  const missing = options({ env: {}, argv: ["--replay", join(empty, "nope")] });
  assert.equal(await runEvaluation(missing), 1);
  rmSync(empty, { recursive: true, force: true });
  rmSync(run.outputDir, { recursive: true, force: true });
  rmSync(missing.outputDir, { recursive: true, force: true });
});

test("a replay reads what the recording holds: a hand-made line of a role is the answer of its call", () => {
  const folder = mkdtempSync(join(tmpdir(), "eval-hand-"));
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "x.jsonl");
  writeFileSync(file, [JSON.stringify({ kind: "model", role: "plan_review", answer: { findings: [], adjustments: [] } }), JSON.stringify({ kind: "judge", verdict: true }), "not json", ""].join("\n"));
  const recording = readRecording(file);
  assert.deepEqual(recording.models.get("plan_review"), [{ answer: { findings: [], adjustments: [] } }]);
  assert.deepEqual(recording.verdicts, [true], "a line that does not parse is skipped");
  rmSync(folder, { recursive: true, force: true });
});

test("the tasks level input: two synthetic tasks per department, and none without a confirmed fact to cite", () => {
  const skeleton = buildPlanSkeleton(CASES[0].report());
  assert.ok(skeleton.ok);
  assert.equal(withSyntheticTasks(skeleton.plan), undefined, "no confirmed fact, no synthetic tasks");
  const proposed = proposeFact(skeleton.plan, { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "service" } }, { now: () => "2026-10-10T10:00:00Z", actor: "user" });
  assert.ok(proposed.ok);
  const confirmed = confirmFact(proposed.plan, proposed.fact.id, { now: () => "2026-10-10T10:00:00Z", actor: "user" });
  assert.ok(confirmed.ok);
  const withTasks = withSyntheticTasks(confirmed.plan);
  assert.ok(withTasks, "a plan with a confirmed fact gets its synthetic tasks");
  const synthetic = withTasks.tasks.filter((task) => task.id.includes("-eval-"));
  assert.equal(synthetic.length, withTasks.departments.length * 2, "two per department");
  for (const task of synthetic) assert.ok(task.id.startsWith(`${task.primaryDepartmentId}-`), "the id carries the department prefix");
  assert.ok(synthetic.every((task) => task.origin.kind === "ai" && task.derivedFrom?.[0] === proposed.fact.id), "every synthetic task cites the confirmed fact");
});

test("the arguments: --mode takes levels or chain; --replay takes a folder; anything else is refused", () => {
  const levels = parseArguments([], CASES);
  assert.ok(typeof levels !== "string");
  assert.equal(levels.mode, "levels");
  const chain = parseArguments(["--mode", "chain"], CASES);
  assert.ok(typeof chain !== "string");
  assert.equal(chain.mode, "chain");
  assert.equal(typeof parseArguments(["--mode", "fast"], CASES), "string");
  assert.equal(typeof parseArguments(["--replay"], CASES), "string");
  const replay = parseArguments(["--replay", "some/folder"], CASES);
  assert.ok(typeof replay !== "string");
  assert.equal(replay.replay, "some/folder");
});
