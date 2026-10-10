import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRequest } from "../../plan/agents/contract.js";
import { CASES, type EvalCase } from "../../eval/cases.js";
import { evaluateExpectations } from "../../eval/checks.js";
import { runEvaluation, type EvalOptions } from "../../eval/run.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import type { Plan } from "../../plan/plan-model.js";
import { EvalJudge, EvalModel, SENTINEL, section, validAnswer } from "./eval-fakes.js";

const ENV_OK = { AGENTS_EVAL: "1", OPENAI_API_KEY: "sk-TEST", OPENAI_MODEL: "model-x", TYPESAFE_API_KEY: "jev-TEST", JEV_MODEL: "jev-x" };
/** The title the fake legal department proposes (eval-fakes.ts): the review must read it when the departments pass */
const LEGAL_TITLE = "Constituir la sociedad y firmar el contrato de alquiler";

/** The options of one run in a folder of its own; `made` counts the clients built */
function options(overrides: Partial<EvalOptions> = {}, model: EvalModel = new EvalModel(), judge: EvalJudge = new EvalJudge()) {
  const made = { count: 0 };
  const lines: string[] = [];
  const run: EvalOptions & { made: { count: number }; lines: string[]; model: EvalModel; judge: EvalJudge } = {
    env: { ...ENV_OK },
    argv: ["--case", "restaurant"],
    now: () => "2026-10-10T10:00:00Z",
    clock: () => 0,
    outputDir: mkdtempSync(join(tmpdir(), "eval-review-")),
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

function caseJsonOf(outputDir: string, name = "restaurant") {
  const file = readdirSync(outputDir).find((item) => item.endsWith(`-${name}.json`));
  assert.ok(file, `a json of ${name}`);
  return JSON.parse(readFileSync(join(outputDir, file), "utf8"));
}

function everythingWritten(outputDir: string): string {
  return readdirSync(outputDir)
    .filter((name) => !name.startsWith("recordings"))
    .map((name) => readFileSync(join(outputDir, name), "utf8"))
    .join("\n");
}

/** The tasks the review was asked about: the proposed_tasks section of its prompt */
function reviewedTitles(request: AgentRequest): string[] {
  return (section(request.user, "proposed_tasks") as { title: string }[]).map((task) => task.title);
}

/** Departments that break (a task id without its prefix): the departments level fails, all or nothing */
function departmentsBreak(request: AgentRequest): unknown {
  if (request.role === "department_finance") {
    return { tasks: [{ id: "obtain-funding", phaseId: section(request.user, "phases")[0].id, title: "Secure funding", derivedFrom: [section(request.user, "confirmed_facts")[0].id] }], relations: [], facts: [], requests: [], questions: [] };
  }
  return validAnswer(request);
}

test("the review reads the tasks the departments of the same run proposed, not the synthetic ones", async () => {
  const run = options({}, new EvalModel(validAnswer));
  assert.equal(await runEvaluation(run), 0);
  const review = run.model.requests.find((request) => request.role === "plan_review")!;
  assert.ok(reviewedTitles(review).includes(LEGAL_TITLE), "a real title of a department reaches the review");
  assert.equal(reviewedTitles(review).some((title) => title.startsWith("Revisar el trabajo de")), false, "no synthetic title");
  assert.equal(caseJsonOf(run.outputDir).review.source, "departamentos reales");
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("when the departments fail, the review does not run: no call is spent, and every table says it is not evaluated", async () => {
  const run = options({}, new EvalModel(departmentsBreak));
  assert.equal(await runEvaluation(run), 0);
  assert.equal(run.model.requests.filter((request) => request.role === "plan_review").length, 0, "no review call");
  const json = caseJsonOf(run.outputDir);
  assert.equal(json.review, null);
  const markdown = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-restaurant.md"))!), "utf8");
  assert.match(markdown, /\| review \| no evaluada \| departamentos sin propuestas \|/);
  assert.match(markdown, /No evaluada: departamentos sin propuestas\./);
  const summary = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-resumen.md"))!), "utf8");
  assert.match(summary, /no evaluada \(departamentos sin propuestas\)/);
  assert.match(summary, /no evaluada: departamentos sin propuestas/);
  assert.match(run.lines.join("\n"), /not evaluated: review \(departamentos sin propuestas\)/);
  // The failure of the departments is still a failure, and it is seen as one
  assert.match(markdown, /\| departments \| fallo \| invalid_output \|/);
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("a failed review stops no other level, and it runs when the departments proposed", async () => {
  // Departments pass, the review fails: the review is a failure, and the others still run
  const reviewBroken = options({}, new EvalModel((request) => (request.role === "plan_review" ? { findings: [{ kind: "clash", taskIds: [], text: "x" }], adjustments: [], facts: [], requests: [], questions: [] } : validAnswer(request))));
  await runEvaluation(reviewBroken);
  const byLevel = Object.fromEntries(caseJsonOf(reviewBroken.outputDir).levelSummary.map((item: { level: string; ok: boolean }) => [item.level, item.ok]));
  assert.equal(byLevel.review, false);
  assert.equal(byLevel.departments, true);
  assert.equal(byLevel.tasks, true);
  assert.equal(byLevel.steps, true);
  rmSync(reviewBroken.outputDir, { recursive: true, force: true });
});

test("the report counts the findings by kind, and names the titles of the tasks each one names; a gap says so", async () => {
  const answer = (request: AgentRequest) => {
    if (request.role !== "plan_review") return validAnswer(request);
    const tasks = section(request.user, "proposed_tasks") as { id: string; title: string }[];
    return {
      findings: [
        { kind: "duplicate", taskIds: [tasks[0].id, tasks[1].id], text: SENTINEL },
        { kind: "gap", taskIds: [], text: SENTINEL },
        { kind: "missing_order", taskIds: [tasks[2].id], text: SENTINEL },
      ],
      adjustments: [{ from: tasks[0].id, to: tasks[1].id, type: "blocks" }],
      facts: [],
      requests: [],
      questions: [],
    };
  };
  const run = options({}, new EvalModel(answer));
  await runEvaluation(run);
  const json = caseJsonOf(run.outputDir);
  assert.deepEqual(json.review.findings.map((finding: { kind: string }) => finding.kind), ["duplicate", "gap", "missing_order"]);
  assert.equal(json.review.adjustments, 1);
  assert.equal(json.review.findings[0].titles.length, 2, "the duplicate names two titles");
  assert.deepEqual(json.review.findings[1].titles, [], "the gap names none");
  const levels = json.levels.find((level: { level: string }) => level.level === "review");
  assert.equal(levels.counts["hallazgos: duplicate"], 1);
  assert.equal(levels.counts["hallazgos: gap"], 1);
  assert.equal(levels.counts["hallazgos: clash"], 0);
  const markdown = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-restaurant.md"))!), "utf8");
  assert.match(markdown, /- gap: \(sin tarea\)/);
  assert.match(markdown, /- duplicate: .*·/, "the titles of a finding are joined");
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("the free text of a finding is never written: it counts as the model's own text", async () => {
  const run = options({}, new EvalModel((request) => (request.role === "plan_review" ? { findings: [{ kind: "clash", taskIds: [], text: SENTINEL }], adjustments: [], facts: [], requests: [], questions: [] } : validAnswer(request))));
  await runEvaluation(run);
  assert.equal(everythingWritten(run.outputDir).includes(SENTINEL), false);
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("the department relations of the levels mode are the plan level's own, in words", async () => {
  const run = options({}, new EvalModel(validAnswer));
  await runEvaluation(run);
  const json = caseJsonOf(run.outputDir);
  assert.deepEqual(json.relations.departments, ["«Legal & Compliance» debe estar lista antes que «Finance»"]);
  const markdown = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-restaurant.md"))!), "utf8");
  assert.match(markdown, /Entre departamentos:\n- «Legal & Compliance» debe estar lista antes que «Finance»/);
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("a recording replays with the same review: the order of the calls by role does not change", async () => {
  const recorded = options({ env: { ...ENV_OK, EVAL_RECORD: "1" } }, new EvalModel(validAnswer));
  await runEvaluation(recorded);
  const folder = join(recorded.outputDir, "recordings", readdirSync(join(recorded.outputDir, "recordings"))[0]);
  const before = caseJsonOf(recorded.outputDir);

  const replay = options({ env: {}, argv: ["--replay", folder, "--case", "restaurant"] });
  assert.equal(await runEvaluation(replay), 0);
  assert.equal(replay.made.count, 0);
  const after = caseJsonOf(replay.outputDir);
  assert.deepEqual(after.levelSummary, before.levelSummary);
  assert.deepEqual(after.review, before.review);
  rmSync(recorded.outputDir, { recursive: true, force: true });
  rmSync(replay.outputDir, { recursive: true, force: true });
});

expectationTests();

/** Each case's expectations, by hand: one title that meets it, and one that does not. The skeleton alone does not meet them */
function expectationTests() {
  const handmade: Record<string, { department: string; meets: string }> = {
    restaurant: { department: "legal", meets: LEGAL_TITLE },
    saas: { department: "technology", meets: "Diseñar la interfaz de la aplicación" },
    physio: { department: "legal", meets: "Registrar la titulación profesional y el seguro de responsabilidad" },
    marketplace: { department: "finance", meets: "Gestionar los cobros y los fondos de los profesionales" },
  };
  for (const evalCase of CASES as EvalCase[]) {
    test(`the checks of ${evalCase.id}: a hand-made task that meets the expectation passes, an unrelated one fails`, () => {
      const skeleton = buildPlanSkeleton(evalCase.report());
      assert.ok(skeleton.ok);
      const base = skeleton.plan;
      const withTask = (title: string): Plan => ({
        ...base,
        tasks: [...base.tasks, { id: "hand-task", phaseId: base.phases[0].id, primaryDepartmentId: handmade[evalCase.id].department, title, origin: { kind: "ai" as const }, confidence: 50 }],
      });
      const meets = evaluateExpectations(evalCase.expectations, withTask(handmade[evalCase.id].meets));
      assert.ok(meets.every((item) => item.passed), `every expectation of ${evalCase.id} is met`);
      const unrelated = evaluateExpectations(evalCase.expectations, withTask("Revisar el calendario de reuniones del equipo"));
      assert.ok(unrelated.every((item) => !item.passed), `an unrelated task does not meet ${evalCase.id}`);
      assert.ok(evaluateExpectations(evalCase.expectations, base).some((item) => !item.passed), "the skeleton alone does not meet all of them");
    });
  }
}

test("the report shows the rule of the plan that refused an answer, by its code, and never the answer's text", async () => {
  const duplicated = (request: AgentRequest) => {
    if (request.role !== "plan_generate") return validAnswer(request);
    const relation = { level: "department", from: "legal", to: "finance", type: "blocks", aspect: { kind: "other", note: SENTINEL } };
    return { phases: section(request.user, "phases"), tiers: [], relations: [relation, relation], facts: [], requests: [], questions: [] };
  };
  const run = options({}, new EvalModel(duplicated));
  await runEvaluation(run);
  const markdown = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-restaurant.md"))!), "utf8");
  assert.match(markdown, /- plan_generate, intento 1: plan_check \(duplicate_relation\)/);
  const summary = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-resumen.md"))!), "utf8");
  assert.match(summary, /Reglas del plan que rompieron las respuestas \(checkPlan\): duplicate_relation \d+/);
  assert.equal(everythingWritten(run.outputDir).includes(SENTINEL), false, "no text of the answer");
  rmSync(run.outputDir, { recursive: true, force: true });
});

test("a department with an empty list is not a failure: it is named as having nothing to propose, and the review still runs", async () => {
  const emptyMarketing = (request: AgentRequest) =>
    request.role === "department_marketing" ? { tasks: [], relations: [], facts: [], requests: [], questions: [] } : validAnswer(request);
  const run = options({}, new EvalModel(emptyMarketing));
  await runEvaluation(run);
  const json = caseJsonOf(run.outputDir);
  const byLevel = Object.fromEntries(json.levelSummary.map((item: { level: string; ok: boolean }) => [item.level, item.ok]));
  assert.equal(byLevel.departments, true, "the empty answer passes the level");
  assert.equal(byLevel.review, true, "the review runs with the tasks of the others");
  const departments = json.levels.find((level: { level: string }) => level.level === "departments").departments;
  assert.equal(departments.find((item: { id: string }) => item.id === "marketing").empty, true);
  const markdown = readFileSync(join(run.outputDir, readdirSync(run.outputDir).find((item) => item.endsWith("-restaurant.md"))!), "utf8");
  assert.match(markdown, /Departamentos: .*\. 1 con la lista vacía \(nada que proponer\): marketing\./);
  rmSync(run.outputDir, { recursive: true, force: true });
});
