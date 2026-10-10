/**
 * The catalogue of realistic answers: plausible answers of a model, most of them right and some of them imperfect in the
 * way a careful model really is (a gap with no task, a relation to a task that exists, a title a little too long, a
 * list left empty where there is nothing to say). Each one says what it should get: accepted, or refused with its label.
 * The fakes of the other tests always answer correctly, so they never reach these rules. Every case runs through the
 * real level function, once, with no retry, so the label is the one of the first answer.
 *
 * `regression: true` marks the three real failures of the evaluation runs (see FUTURE.md): a department task id
 * without its department prefix, a relation that joins a new task to an existing one, and a gap with no task named.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanGenerate, runPlanReview, type ProposedTask } from "../../../plan/agents/plan-agent.js";
import { runDepartmentTasks } from "../../../plan/agents/department-agent.js";
import { buildDepartmentInput } from "../../../plan/agents/department-input.js";
import { runTaskSteps } from "../../../plan/agents/task-agent.js";
import { buildTaskInput } from "../../../plan/agents/task-input.js";
import { runStepAgent, stepInputOf } from "../../../plan/agents/step-agent.js";
import { contextOf, type AgentDeps, type AgentResult, type AttemptFailure } from "../../../plan/agents/contract.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import { FakeModel, NOW, now, planWithFact } from "./fakes.js";

type Level = "plan_generate" | "plan_review" | "department" | "task" | "step";

interface RealisticCase {
  id: string;
  level: Level;
  /** What is in the answer, in a few words */
  what: string;
  answer: () => unknown;
  /** "accept", or the label of the refusal: the reason of the first failed attempt (see AttemptFailure) */
  expect: string;
  regression?: boolean;
}

const IDEA = "A Japanese restaurant with delivery";
const { plan, factId } = planWithFact();
const base = restaurantPlan();
const legalPhase = plan.phases.find((phase) => phase.id === "f1")!.id;
const longTitle = "Register the business with the city and the tax office so that it can trade, ".repeat(4).slice(0, 250);
const exactTitle = "Register the business with the city and the tax office so that it can trade legally in the area".padEnd(200, "x");

/** The tasks the review reads: two legal tasks the department has just proposed */
const proposed: ProposedTask[] = [
  { id: "legal-draft-terms", title: "Draft the terms", departmentId: "legal", phaseId: legalPhase },
  { id: "legal-publish-terms", title: "Publish the terms", departmentId: "legal", phaseId: legalPhase },
];

const NO_EXTRAS = { facts: [], requests: [], questions: [] };

/** A department answer with one task of legal, cited on the confirmed fact; `over` replaces parts of it */
const legalAnswer = (over: Record<string, unknown> = {}) => ({
  tasks: [{ id: "legal-register-business", phaseId: legalPhase, title: "Register the business", derivedFrom: [factId] }],
  relations: [],
  ...NO_EXTRAS,
  ...over,
});

const generateAnswer = (over: Record<string, unknown> = {}) => ({
  phases: base.phases,
  tiers: [{ departmentId: "legal", tier: "core" }],
  relations: [],
  ...NO_EXTRAS,
  ...over,
});

const reviewAnswer = (over: Record<string, unknown> = {}) => ({ findings: [], adjustments: [], ...NO_EXTRAS, ...over });

const taskAnswer = (over: Record<string, unknown> = {}) => ({ steps: [], relations: [], ...NO_EXTRAS, ...over });

const stepAnswer = (over: Record<string, unknown> = {}) => ({
  summary: "Compared three delivery apps and their fees.",
  document: "Three apps charge a commission between 15 and 30 percent of the order.",
  questions: [],
  ...over,
});

/** A step of legal's task, written the way a model writes one (the executor and the evidence agree) */
const draftStep = { id: "t-menu-draft", text: "Write the menu in English", executor: "ai", evidence: "accepted_output", effortHours: 2, waitDays: 0, derivedFrom: [factId] };
const signStep = { id: "t-menu-sign", text: "Sign off the menu", executor: "user", mode: "online", evidence: "written_confirmation", effortHours: 1, waitDays: 2, derivedFrom: [factId] };

const CASES: RealisticCase[] = [
  // ---- The plan level: generate
  { id: "plan-valid", level: "plan_generate", what: "the phases kept, one tier, no relation", answer: () => generateAnswer(), expect: "accept" },
  { id: "plan-empty-lists", level: "plan_generate", what: "no tier change and no relation: nothing to change", answer: () => generateAnswer({ tiers: [], relations: [] }), expect: "accept" },
  {
    id: "plan-relation-with-note",
    level: "plan_generate",
    what: "a relation whose aspect is a short note of its own",
    answer: () => generateAnswer({ relations: [{ level: "department", from: "legal", to: "finance", type: "blocks", aspect: { kind: "other", note: "licence first" } }] }),
    expect: "accept",
  },
  {
    id: "plan-phase-name-long",
    level: "plan_generate",
    what: "a phase name of 130 characters (the plan keeps 120)",
    answer: () => generateAnswer({ phases: base.phases.map((phase, index) => (index === 0 ? { ...phase, name: "x".repeat(130) } : phase)) }),
    expect: "schema",
  },
  { id: "plan-dropped-phase", level: "plan_generate", what: "a phase dropped although its tasks sit in it", answer: () => generateAnswer({ phases: base.phases.slice(1) }), expect: "plan_check" },
  { id: "plan-unknown-tier", level: "plan_generate", what: "a tier for a department that does not exist", answer: () => generateAnswer({ tiers: [{ departmentId: "marketing", tier: "core" }] }), expect: "structure" },
  {
    id: "plan-task-relation",
    level: "plan_generate",
    what: "a task relation in the structure answer (only department relations are allowed)",
    answer: () => generateAnswer({ relations: [{ level: "task", from: "t-menu", to: "t-permits", type: "blocks" }] }),
    expect: "structure",
  },
  {
    id: "plan-duplicate-relation",
    level: "plan_generate",
    what: "the same department relation twice",
    answer: () => {
      const relation = { level: "department", from: "legal", to: "finance", type: "blocks", aspect: { kind: "catalog", id: "budget" } };
      return generateAnswer({ relations: [relation, relation] });
    },
    expect: "plan_check",
  },
  { id: "plan-no-phases", level: "plan_generate", what: "no phase at all (a plan has phases; the answer keeps them)", answer: () => generateAnswer({ phases: [] }), expect: "schema" },
  { id: "plan-extra-field", level: "plan_generate", what: "an extra field the prompt did not ask for", answer: () => generateAnswer({ summary: "The plan is ready" }), expect: "schema" },

  // ---- The plan level: review
  { id: "review-gap-no-task", level: "plan_review", what: "a gap that names no task (taskIds: [])", answer: () => reviewAnswer({ findings: [{ kind: "gap", taskIds: [], text: "Nobody covers the licence" }] }), expect: "accept", regression: true },
  { id: "review-gap-names-task", level: "plan_review", what: "a gap that names an existing task of the plan", answer: () => reviewAnswer({ findings: [{ kind: "gap", taskIds: ["t-menu"], text: "The menu is not covered" }] }), expect: "accept" },
  { id: "review-clash-no-task", level: "plan_review", what: "a clash that names no task", answer: () => reviewAnswer({ findings: [{ kind: "clash", taskIds: [], text: "Two prices" }] }), expect: "schema" },
  { id: "review-duplicate-no-task", level: "plan_review", what: "a duplicate that names no task", answer: () => reviewAnswer({ findings: [{ kind: "duplicate", taskIds: [], text: "Same work twice" }] }), expect: "schema" },
  { id: "review-order-no-task", level: "plan_review", what: "a missing order that names no task", answer: () => reviewAnswer({ findings: [{ kind: "missing_order", taskIds: [], text: "Publish before draft" }] }), expect: "schema" },
  { id: "review-unknown-task", level: "plan_review", what: "a finding names a task that does not exist", answer: () => reviewAnswer({ findings: [{ kind: "clash", taskIds: ["legal-ghost"], text: "x" }] }), expect: "task_ref" },
  { id: "review-eleven-tasks", level: "plan_review", what: "one finding that names eleven tasks (the plan keeps ten)", answer: () => reviewAnswer({ findings: [{ kind: "clash", taskIds: Array.from({ length: 11 }, (_, index) => `legal-t${index}`), text: "x" }] }), expect: "schema" },
  { id: "review-no-findings", level: "plan_review", what: "nothing to report", answer: () => reviewAnswer(), expect: "accept" },
  {
    id: "review-order-valid",
    level: "plan_review",
    what: "a missing order between two proposed tasks, as an adjustment",
    answer: () => reviewAnswer({ findings: [{ kind: "missing_order", taskIds: ["legal-draft-terms", "legal-publish-terms"], text: "Draft first" }], adjustments: [{ from: "legal-draft-terms", to: "legal-publish-terms", type: "blocks" }] }),
    expect: "accept",
  },
  { id: "review-self-adjustment", level: "plan_review", what: "an adjustment that joins a task to itself", answer: () => reviewAnswer({ adjustments: [{ from: "legal-draft-terms", to: "legal-draft-terms", type: "blocks" }] }), expect: "relation_ref" },
  { id: "review-finding-extra-field", level: "plan_review", what: "a finding with a severity field the prompt does not name", answer: () => reviewAnswer({ findings: [{ kind: "clash", taskIds: ["t-menu"], text: "x", severity: "high" }] }), expect: "schema" },

  // ---- The department level
  { id: "dept-valid", level: "department", what: "one task with the department prefix, cited on the fact", answer: () => legalAnswer(), expect: "accept" },
  {
    id: "dept-prefix-missing",
    level: "department",
    what: "a task id without the department prefix",
    answer: () => legalAnswer({ tasks: [{ id: "register-business", phaseId: legalPhase, title: "Register the business", derivedFrom: [factId] }] }),
    expect: "id_prefix",
    regression: true,
  },
  {
    id: "dept-relation-new-to-existing",
    level: "department",
    what: "a new task ordered before an existing task of the department",
    answer: () => legalAnswer({ relations: [{ from: "legal-register-business", to: "t-menu", type: "blocks" }] }),
    expect: "accept",
    regression: true,
  },
  {
    id: "dept-relation-two-existing",
    level: "department",
    what: "a relation between two tasks the department already has",
    answer: () => legalAnswer({ relations: [{ from: "t-menu", to: "t-permits", type: "blocks" }] }),
    expect: "relation_existing_only",
  },
  {
    id: "dept-relation-other-department",
    level: "department",
    what: "a relation to a task of finance",
    answer: () => legalAnswer({ relations: [{ from: "legal-register-business", to: "t-viability", type: "blocks" }] }),
    expect: "relation_ref",
  },
  { id: "dept-unknown-fact", level: "department", what: "a fact id that is not confirmed in the plan", answer: () => legalAnswer({ tasks: [{ id: "legal-register-business", phaseId: legalPhase, title: "Register", derivedFrom: ["fact-invented"] }] }), expect: "fact_unknown" },
  { id: "dept-empty-derived", level: "department", what: "no fact cited at all", answer: () => legalAnswer({ tasks: [{ id: "legal-register-business", phaseId: legalPhase, title: "Register", derivedFrom: [] }] }), expect: "schema" },
  { id: "dept-unknown-phase", level: "department", what: "a phase id that is not in the plan", answer: () => legalAnswer({ tasks: [{ id: "legal-register-business", phaseId: "f9", title: "Register", derivedFrom: [factId] }] }), expect: "phase_unknown" },
  {
    id: "dept-title-200",
    level: "department",
    what: "a title of exactly the plan's 200 characters",
    answer: () => legalAnswer({ tasks: [{ id: "legal-register-business", phaseId: legalPhase, title: exactTitle, derivedFrom: [factId] }] }),
    expect: "accept",
  },
  {
    id: "dept-title-250",
    level: "department",
    what: "a title of 250 characters: longer than the plan keeps, so refused by the schema and retried",
    answer: () => legalAnswer({ tasks: [{ id: "legal-register-business", phaseId: legalPhase, title: longTitle, derivedFrom: [factId] }] }),
    expect: "schema",
  },
  {
    id: "dept-id-too-long",
    level: "department",
    what: "a task id of 66 characters (the plan keeps 64)",
    answer: () => legalAnswer({ tasks: [{ id: `legal-${"register-".repeat(7).slice(0, 60)}`, phaseId: legalPhase, title: "Register", derivedFrom: [factId] }] }),
    expect: "schema",
  },
  { id: "dept-no-tasks", level: "department", what: "nothing to add for this department", answer: () => legalAnswer({ tasks: [] }), expect: "accept" },
  {
    id: "dept-free-text-fact",
    level: "department",
    what: "a fact outside the catalogue, with a free-text key",
    answer: () => legalAnswer({ facts: [{ key: { kind: "other", text: "Opening hours" }, value: { kind: "other", text: "Monday to Sunday" } }] }),
    expect: "accept",
  },
  {
    id: "dept-catalog-key-unknown",
    level: "department",
    what: "a fact with a catalogue key id that does not exist",
    answer: () => legalAnswer({ facts: [{ key: { kind: "catalog", id: "no_such_key" }, value: { kind: "other", text: "x" } }] }),
    expect: "fact_catalog",
  },
  { id: "dept-extra-field", level: "department", what: "a task with a priority field the prompt does not name", answer: () => legalAnswer({ tasks: [{ id: "legal-register-business", phaseId: legalPhase, title: "Register", derivedFrom: [factId], priority: "high" }] }), expect: "schema" },

  // ---- The task level
  { id: "task-valid", level: "task", what: "an AI step and a user step, in order", answer: () => taskAnswer({ steps: [draftStep, signStep], relations: [{ from: "t-menu-draft", to: "t-menu-sign", type: "blocks" }] }), expect: "accept" },
  { id: "task-empty-derived", level: "task", what: "a step with no fact cited", answer: () => taskAnswer({ steps: [{ ...draftStep, derivedFrom: [] }] }), expect: "schema" },
  { id: "task-no-steps", level: "task", what: "nothing to do for this task", answer: () => taskAnswer(), expect: "accept" },
  { id: "task-user-without-mode", level: "task", what: "a user step with no mode", answer: () => taskAnswer({ steps: [{ ...signStep, mode: undefined }] }), expect: "step_rules" },
  { id: "task-ai-with-mode", level: "task", what: "an AI step that also names a mode", answer: () => taskAnswer({ steps: [{ ...draftStep, mode: "online" }] }), expect: "step_rules" },
  { id: "task-accepted-output-for-user", level: "task", what: "a user step closed by an accepted output", answer: () => taskAnswer({ steps: [{ ...signStep, evidence: "accepted_output" }] }), expect: "step_rules" },
  { id: "task-step-prefix-missing", level: "task", what: "a step id without the task prefix", answer: () => taskAnswer({ steps: [{ ...draftStep, id: "draft-menu" }] }), expect: "id_prefix", regression: true },
  { id: "task-relation-unknown-step", level: "task", what: "a relation to a step that is not in the answer", answer: () => taskAnswer({ steps: [draftStep], relations: [{ from: "t-menu-draft", to: "t-menu-ghost", type: "blocks" }] }), expect: "relation_ref" },
  { id: "task-relation-to-itself", level: "task", what: "a relation from a step to itself", answer: () => taskAnswer({ steps: [draftStep], relations: [{ from: "t-menu-draft", to: "t-menu-draft", type: "blocks" }] }), expect: "relation_ref" },
  { id: "task-feeds-from-user", level: "task", what: "a result fed from a user step (only an AI step can feed)", answer: () => taskAnswer({ steps: [signStep, { ...draftStep, id: "t-menu-check" }], relations: [{ from: "t-menu-sign", to: "t-menu-check", type: "feeds" }] }), expect: "invalid_result" },
  { id: "task-unknown-fact", level: "task", what: "a step that cites a fact the plan does not have", answer: () => taskAnswer({ steps: [{ ...draftStep, derivedFrom: ["fact-invented"] }] }), expect: "fact_unknown" },
  { id: "task-hours-above-limit", level: "task", what: "a step of 1200 hours (the plan keeps up to 1000)", answer: () => taskAnswer({ steps: [{ ...draftStep, effortHours: 1200 }] }), expect: "schema" },
  { id: "task-third-party-receipt", level: "task", what: "a step done by a third party, closed by a receipt", answer: () => taskAnswer({ steps: [{ ...signStep, id: "t-menu-notary", executor: "third_party", mode: undefined, evidence: "receipt" }] }), expect: "accept" },

  // ---- The step level (the AI step of finance: s-viability)
  { id: "step-valid", level: "step", what: "a summary and a document, nothing else", answer: () => stepAnswer(), expect: "accept" },
  { id: "step-empty-document", level: "step", what: "an empty document", answer: () => stepAnswer({ document: "" }), expect: "schema" },
  { id: "step-six-questions", level: "step", what: "six questions in one round (the plan keeps five)", answer: () => stepAnswer({ questions: ["q1", "q2", "q3", "q4", "q5", "q6"] }), expect: "schema" },
  { id: "step-request-to-unknown", level: "step", what: "a request to a department that does not exist", answer: () => stepAnswer({ requests: [{ to: "marketing", text: "Need the brand" }] }), expect: "request_target" },
  { id: "step-request-to-plan-and-department", level: "step", what: "a request to the plan and one to legal", answer: () => stepAnswer({ requests: [{ to: "plan", text: "Confirm the opening date" }, { to: "legal", text: "Check the delivery terms" }] }), expect: "accept" },
  { id: "step-summary-long", level: "step", what: "a summary of 1100 characters (the plan keeps 1000)", answer: () => stepAnswer({ summary: "x".repeat(1100) }), expect: "schema" },
  {
    id: "step-fact-catalog-bad",
    level: "step",
    what: "a catalogue fact with a value that is not a catalogue term",
    answer: () => stepAnswer({ facts: [{ key: { kind: "catalog", id: "product_type" }, value: { kind: "other", text: "a web shop" } }] }),
    expect: "fact_catalog",
  },
  { id: "step-extra-field", level: "step", what: "an answer with a confidence field the prompt does not name", answer: () => stepAnswer({ confidence: 80 }), expect: "schema" },
];

/** Runs one answer through its level, once, and says what became of it: "accept", or the label of the first failure */
async function outcomeOf(evalCase: RealisticCase): Promise<string> {
  const failures: AttemptFailure[] = [];
  const model = new FakeModel([evalCase.answer()]);
  const deps: AgentDeps = { model, judge: null, attempts: 1, onFailure: (failure) => failures.push(failure) };
  const idea = IDEA;
  let result: AgentResult<unknown>;
  switch (evalCase.level) {
    case "plan_generate":
      result = await runPlanGenerate(deps, contextOf(idea, plan), plan);
      break;
    case "plan_review":
      result = await runPlanReview(deps, { idea, proposed }, plan);
      break;
    case "department": {
      const input = buildDepartmentInput(plan, "legal", idea);
      if (!input) throw new Error("no legal input");
      result = await runDepartmentTasks(deps, input, plan, { now: () => NOW });
      break;
    }
    case "task": {
      const input = buildTaskInput(plan, "t-menu", idea);
      if (!input) throw new Error("no task input");
      result = await runTaskSteps(deps, input, plan, { now: () => NOW });
      break;
    }
    case "step": {
      const input = stepInputOf(plan, "s-viability", idea);
      if (!input) throw new Error("no step input");
      result = await runStepAgent(deps, input, { knownDepartments: new Set(plan.departments.map((department) => department.id)) });
      break;
    }
  }
  if (result.ok) return "accept";
  return failures.at(-1)?.reason ?? result.code;
}

describe("the catalogue of realistic answers: each one gets what it should", () => {
  for (const evalCase of CASES) {
    test(`${evalCase.id}${evalCase.regression ? " (regression)" : ""}: ${evalCase.what} -> ${evalCase.expect}`, async () => {
      assert.equal(await outcomeOf(evalCase), evalCase.expect);
    });
  }

  test("the catalogue has the three regressions of the evaluation runs, and each level has accepted and refused answers", () => {
    const regressions = CASES.filter((item) => item.regression).map((item) => item.id).sort();
    assert.deepEqual(regressions, ["dept-prefix-missing", "dept-relation-new-to-existing", "review-gap-no-task", "task-step-prefix-missing"]);
    for (const level of ["plan_generate", "plan_review", "department", "task", "step"] as const) {
      const outcomes = CASES.filter((item) => item.level === level).map((item) => item.expect);
      assert.equal(outcomes.includes("accept"), true, `${level} has an accepted answer`);
      assert.equal(outcomes.some((expect) => expect !== "accept"), true, `${level} has a refused answer`);
    }
  });
});

describe("the prompts name the limits the plan enforces (the audit of the validators)", () => {
  test("the department and task prompts say the id limit, and the department prompt says the title limit", async () => {
    const departmentModel = new FakeModel([legalAnswer()]);
    await runDepartmentTasks({ model: departmentModel, judge: null, attempts: 1 }, buildDepartmentInput(plan, "legal", IDEA)!, plan, { now: () => NOW });
    assert.match(departmentModel.requests[0].system, /at most 64 characters in all/);
    assert.match(departmentModel.requests[0].system, /at most 200 characters/);

    const taskModel = new FakeModel([taskAnswer()]);
    await runTaskSteps({ model: taskModel, judge: null, attempts: 1 }, buildTaskInput(plan, "t-menu", IDEA)!, plan, { now: () => NOW });
    assert.match(taskModel.requests[0].system, /at most 64 characters in all/);
    assert.match(taskModel.requests[0].system, /effortHours at most 1000/);
    assert.match(taskModel.requests[0].system, /waitDays at most 3650/);
  });

  test("the derivedFrom rule says what to do when in doubt: cite the most relevant fact", async () => {
    const model = new FakeModel([legalAnswer()]);
    await runDepartmentTasks({ model, judge: null, attempts: 1 }, buildDepartmentInput(plan, "legal", IDEA)!, plan, { now: () => NOW });
    assert.match(model.requests[0].system, /If in doubt, cite the most relevant one/);
  });

  test("every level says it returns only the fields it describes", async () => {
    const generate = new FakeModel([generateAnswer()]);
    await runPlanGenerate({ model: generate, judge: null, attempts: 1 }, contextOf(IDEA, plan), plan);
    assert.match(generate.requests[0].system, /Return only the fields described here, and no others\./);

    const review = new FakeModel([reviewAnswer()]);
    await runPlanReview({ model: review, judge: null, attempts: 1 }, { idea: IDEA, proposed }, plan);
    assert.match(review.requests[0].system, /Return only the fields described here, and no others\./);

    const step = new FakeModel([stepAnswer()]);
    await runStepAgent({ model: step, judge: null, attempts: 1 }, stepInputOf(plan, "s-viability", IDEA)!, { knownDepartments: new Set(["legal", "finance"]) });
    assert.match(step.requests[0].system, /Return only the fields described here, and no others\./);
  });
});
