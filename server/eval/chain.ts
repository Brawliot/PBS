/**
 * One case through the real levels, in the order the app uses them. The script plays the person: it confirms the facts
 * of the case, and accepts what the agents propose once it passes the same checks the routes apply (checkPlan, and the
 * acceptance rules of proposals.ts and plan-actions.ts). Every level is measured: calls, judge verdicts, time, tokens,
 * and counts of what it produced. The chain stops at its first failure: that level keeps its code, and no later level runs.
 *
 * Levels: setup (skeleton and facts), plan (structure), departments (tasks), tasks (steps of some tasks), steps (one AI
 * step is run and its output attached). The last level does not answer questions: one run is what the measure needs.
 */

import { buildPlanSkeleton } from "../plan/plan-skeleton.js";
import { confirmFact, proposeFact } from "../plan/fact-actions.js";
import { applyProposalAction } from "../plan/proposals.js";
import { createStructureProposal } from "../plan/plan-structure.js";
import { applyPlanAction, newProblems } from "../plan/plan-actions.js";
import { checkPlan } from "../plan/plan-check.js";
import { readiness } from "../plan/step-graph.js";
import type { Plan } from "../plan/plan-model.js";
import type { Report } from "../plan/report.js";
import { type AgentDeps, type FactProposal, contextOf } from "../plan/agents/contract.js";
import { runPlanGenerate, structureOf } from "../plan/agents/plan-agent.js";
import { suggestDepartmentTasks } from "../plan/agents/department-suggestion.js";
import { buildTaskInput } from "../plan/agents/task-input.js";
import { hasPendingSteps, runTaskSteps } from "../plan/agents/task-agent.js";
import { runStepAgent, stepInputOf } from "../plan/agents/step-agent.js";
import type { Budget } from "./budget.js";
import type { EvalCase } from "./cases.js";
import { type ExpectationResult, evaluateExpectations, describeRelations, tasksByDepartment } from "./checks.js";

export type LevelName = "setup" | "plan" | "departments" | "tasks" | "steps";
export type Counts = Record<string, number>;

/** One call as the adapters report it (see openai-model.ts and jev-judge.ts). Never a prompt or an answer */
export interface CallLogEntry {
  kind: "model" | "judge";
  ms: number;
  ok: boolean;
  status?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface Tokens {
  input: number;
  output: number;
  /** Calls that answered without a count of tokens (OpenAI or Jev did not send one) */
  missing: number;
}

export interface LevelRecord {
  level: LevelName;
  ok: boolean;
  /** The code of the first failure: an agent's code, or one of the codes below */
  code?: string;
  /** Calls to the model, retries included */
  modelCalls: number;
  /** Calls to Jev, retries included */
  judgeCalls: number;
  /** Jev's verdict of each judge call of this level */
  verdicts: string[];
  ms: number;
  tokens: { model: Tokens; judge: Tokens };
  counts: Counts;
  /** Problems the acceptances of this level added to the plan. Expected: 0 */
  newProblems: number;
  /** Problems of the plan after the level, when it finished */
  problems?: number;
}

export interface CaseRun {
  caseId: string;
  label: string;
  levels: LevelRecord[];
  /** The code of the level that stopped the case, if one did */
  stoppedBy?: string;
  /** The heuristic checks, when the departments level finished */
  expectations?: ExpectationResult[];
  relations: { departments: string[]; tasks: string[] };
  tasksByDepartment: Record<string, string[]>;
}

export interface ChainDeps {
  /** The agents, with their calls counted by `budget` (budget.ts) */
  agents: AgentDeps;
  budget: Budget;
  /** Filled by the adapters' onCall: the tokens and times of the calls that were made */
  calls: CallLogEntry[];
  now: () => string;
  /** Milliseconds, from a monotonic clock */
  clock: () => number;
  /** Tasks the steps level takes, one per department at most */
  taskCount: number;
}

/** The steps of the chain's own: an error the rules or the agents gave, or one of these */
export type Outcome = { ok: true; plan: Plan } | { ok: false; code: string };
const fail = (code: string): Outcome => ({ ok: false, code });

/** What one level counts while it runs */
interface Stage {
  counts: Counts;
  newProblems: number;
}

const add = (stage: Stage, key: string, n: number = 1) => {
  stage.counts[key] = (stage.counts[key] ?? 0) + n;
};

/** Accepting must not add a problem: the plan after it is checked against the plan before (newProblems) */
function acceptance(stage: Stage, before: Plan, after: Plan): Outcome {
  const added = newProblems(checkPlan(before), checkPlan(after)).length;
  stage.newProblems += added;
  return added === 0 ? { ok: true, plan: after } : fail("new_problems");
}

/** The person accepts a proposal: applyProposalAction, then the check above */
function accept(stage: Stage, plan: Plan, proposalId: string, at: string): Outcome {
  const result = applyProposalAction(plan, proposalId, "accept", { now: () => at, actor: "user" });
  if (!result.ok) return fail(result.code);
  return acceptance(stage, plan, result.plan);
}

/** Facts the agents proposed, kept as the routes keep them: the same key and value once is not proposed again */
function proposeAgentFacts(stage: Stage, plan: Plan, facts: FactProposal[], agentLevel: "plan" | "department", at: string): Outcome {
  let next = plan;
  for (const fact of facts) {
    const known = (next.facts ?? []).some(
      (item) =>
        (item.status === "proposed" || item.status === "confirmed") &&
        JSON.stringify(item.key) === JSON.stringify(fact.key) &&
        JSON.stringify(item.value) === JSON.stringify(fact.value),
    );
    if (known) continue;
    const made = proposeFact(next, { key: fact.key, value: fact.value, agentLevel }, { now: () => at, actor: "ai" });
    if (!made.ok) return fail("fact_invalid");
    next = made.plan;
    add(stage, "hechos propuestos");
  }
  return { ok: true, plan: next };
}

/** The tasks the steps level may take: AI tasks of the departments, with no steps yet, first one per department in plan order */
function taskCandidates(plan: Plan): Plan["tasks"] {
  const seen = new Set<string>();
  return plan.tasks.filter((task) => {
    if (task.origin.kind !== "ai" || task.placeholder !== undefined) return false;
    if (plan.steps.some((step) => step.taskId === task.id) || hasPendingSteps(plan, task.id)) return false;
    if (seen.has(task.primaryDepartmentId)) return false;
    seen.add(task.primaryDepartmentId);
    return true;
  });
}

interface Measure {
  record: LevelRecord;
  plan?: Plan;
}

/**
 * Runs one level and measures it. Once the budget is used up, the level does not start, and any failure of it is
 * recorded as budget_exhausted (the agents turn a refused call into an ordinary failed attempt).
 */
async function measured(level: LevelName, deps: ChainDeps, work: (stage: Stage) => Promise<Outcome>): Promise<Measure> {
  const stage: Stage = { counts: {}, newProblems: 0 };
  const empty = (code: string): LevelRecord => ({
    level,
    ok: false,
    code,
    modelCalls: 0,
    judgeCalls: 0,
    verdicts: [],
    ms: 0,
    tokens: { model: { input: 0, output: 0, missing: 0 }, judge: { input: 0, output: 0, missing: 0 } },
    counts: {},
    newProblems: 0,
  });
  if (deps.budget.exhausted) return { record: empty("budget_exhausted") };

  const started = deps.clock();
  const calls = deps.calls.length;
  const model = deps.budget.counts.model;
  const judge = deps.budget.counts.judge;
  const verdicts = deps.budget.verdicts.length;

  let outcome: Outcome;
  try {
    outcome = await work(stage);
  } catch {
    // Only the fact of the error is kept: its message may hold a value from a provider
    outcome = fail("internal_error");
  }
  const code = outcome.ok ? undefined : deps.budget.exhausted ? "budget_exhausted" : outcome.code;

  const made = deps.calls.slice(calls);
  const tokens = (kind: CallLogEntry["kind"]): Tokens => {
    const entries = made.filter((entry) => entry.kind === kind);
    return {
      input: entries.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
      output: entries.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
      missing: entries.filter((entry) => entry.ok && entry.inputTokens === undefined).length,
    };
  };
  const record: LevelRecord = {
    level,
    ok: outcome.ok,
    ...(code !== undefined && { code }),
    modelCalls: deps.budget.counts.model - model,
    judgeCalls: deps.budget.counts.judge - judge,
    verdicts: deps.budget.verdicts.slice(verdicts),
    ms: Math.round(deps.clock() - started),
    tokens: { model: tokens("model"), judge: tokens("judge") },
    counts: stage.counts,
    newProblems: stage.newProblems,
    ...(outcome.ok && { problems: checkPlan(outcome.plan).length }),
  };
  return { record, ...(outcome.ok && { plan: outcome.plan }) };
}

/** The first step: the skeleton of the report, and the facts of the case confirmed by the person */
function setup(evalCase: EvalCase, report: Report, deps: ChainDeps, stage: Stage): Outcome {
  const skeleton = buildPlanSkeleton(report);
  if (!skeleton.ok) return fail("skeleton_failed");
  let plan = skeleton.plan;
  const at = deps.now();
  for (const fact of evalCase.facts) {
    const proposed = proposeFact(plan, { key: fact.key, value: fact.value }, { now: () => at, actor: "user" });
    if (!proposed.ok) return fail("fact_invalid");
    const confirmed = confirmFact(proposed.plan, proposed.fact.id, { now: () => at, actor: "user" });
    if (!confirmed.ok) return fail("fact_invalid");
    plan = confirmed.plan;
    add(stage, "hechos confirmados");
  }
  add(stage, "fases", plan.phases.length);
  add(stage, "departamentos", plan.departments.length);
  add(stage, "tareas del esqueleto", plan.tasks.length);
  return { ok: true, plan };
}

/** The plan level: the structure proposed, then accepted as a whole */
async function planLevel(plan: Plan, idea: string, deps: ChainDeps, stage: Stage): Promise<Outcome> {
  const at = deps.now();
  const answer = await runPlanGenerate(deps.agents, contextOf(idea, plan), plan);
  if (!answer.ok) return fail(answer.code);
  const structure = structureOf(answer.value.output);
  if (!structure) return fail("invalid_result");
  const created = createStructureProposal(plan, structure, { now: () => at });
  if (!created.ok) return fail(created.code);

  add(stage, "fases", structure.phases.length);
  add(stage, "tiers cambiados", structure.tiers.filter((item) => plan.departments.find((d) => d.id === item.departmentId)?.tier !== item.tier).length);
  add(stage, "relaciones entre departamentos", structure.relations.length);
  add(stage, "peticiones", structure.requests.length);
  add(stage, "preguntas", structure.questions.length);

  const withFacts = proposeAgentFacts(stage, created.plan, answer.value.output.facts, "plan", at);
  if (!withFacts.ok) return withFacts;
  return accept(stage, withFacts.plan, created.proposal.id, at);
}

/** The department level: one proposal per department with tasks, all accepted by the person */
async function departmentsLevel(plan: Plan, idea: string, deps: ChainDeps, stage: Stage): Promise<Outcome> {
  const at = deps.now();
  const suggestion = await suggestDepartmentTasks(deps.agents, plan, idea, { now: deps.now });
  if (!suggestion.ok) return fail(suggestion.code);
  const { proposals, facts } = suggestion.value;

  add(stage, "propuestas", proposals.length);
  add(stage, "tareas", proposals.reduce((sum, proposal) => sum + proposal.add.tasks.length, 0));
  add(stage, "departamentos sin tareas", plan.departments.length - proposals.length);
  for (const proposal of proposals) {
    for (const note of proposal.notes ?? []) {
      if (note.startsWith("Request")) add(stage, "peticiones");
      else if (note.startsWith("Question")) add(stage, "preguntas");
      else if (note.startsWith("Suggested order")) add(stage, "órdenes sugeridas");
      else add(stage, "hallazgos de revisión");
    }
  }

  let next: Plan = { ...plan, proposals: [...(plan.proposals ?? []), ...proposals] };
  const withFacts = proposeAgentFacts(stage, next, facts, "department", at);
  if (!withFacts.ok) return withFacts;
  next = withFacts.plan;
  for (const proposal of proposals) {
    const accepted = accept(stage, next, proposal.id, at);
    if (!accepted.ok) return accepted;
    next = accepted.plan;
  }
  return { ok: true, plan: next };
}

/** The task level: steps for up to taskCount tasks, from different departments, each accepted by the person */
async function tasksLevel(plan: Plan, idea: string, deps: ChainDeps, stage: Stage, chosen: string[]): Promise<Outcome> {
  const at = deps.now();
  const candidates = taskCandidates(plan);
  if (candidates.length === 0) return fail("no_tasks");
  add(stage, "candidatas", candidates.length);

  let next = plan;
  let skipped = 0;
  for (const candidate of candidates) {
    if (chosen.length >= deps.taskCount) break;
    const input = buildTaskInput(next, candidate.id, idea);
    if (!input) continue;
    const answer = await runTaskSteps(deps.agents, input, next, { now: deps.now });
    if (!answer.ok) return fail(answer.code);
    const { output, proposal } = answer.value;
    if (!proposal) {
      skipped += 1;
      continue;
    }
    add(stage, "pasos", output.steps.length);
    add(stage, "pasos de IA", output.steps.filter((step) => step.executor === "ai").length);
    add(stage, "pasos de usuario", output.steps.filter((step) => step.executor === "user").length);
    add(stage, "pasos de terceros", output.steps.filter((step) => step.executor === "third_party").length);
    add(stage, "relaciones entre pasos", output.relations.length);

    const withProposal: Plan = { ...next, proposals: [...(next.proposals ?? []), proposal] };
    const withFacts = proposeAgentFacts(stage, withProposal, output.facts, "department", at);
    if (!withFacts.ok) return withFacts;
    const accepted = accept(stage, withFacts.plan, proposal.id, at);
    if (!accepted.ok) return accepted;
    next = accepted.plan;
    chosen.push(candidate.id);
  }
  add(stage, "tareas elegidas", chosen.length);
  add(stage, "sin pasos", skipped);
  if (chosen.length === 0) return fail("no_steps");
  return { ok: true, plan: next };
}

/** The steps level: the first AI step of the chosen tasks that is ready is launched, run, and its output attached */
async function stepsLevel(plan: Plan, idea: string, deps: ChainDeps, stage: Stage, chosen: string[]): Promise<Outcome> {
  const ready = plan.steps.filter(
    (step) => step.executor === "ai" && chosen.includes(step.taskId) && readiness(step, plan.steps, plan.relations) === "ready",
  );
  add(stage, "pasos de IA listos", ready.length);
  if (ready.length === 0) return fail("no_ai_step");
  const step = ready[0];

  // The person starts the step; the same action the route applies before any call
  const launched = applyPlanAction(plan, step.id, "launch", { now: deps.now, actor: "user" });
  if (!launched.ok) return fail(launched.code);
  const input = stepInputOf(launched.plan, step.id, idea);
  if (!input) return fail("unknown_step");

  const answer = await runStepAgent(deps.agents, input, { knownDepartments: new Set(plan.departments.map((department) => department.id)) });
  if (!answer.ok) return fail(answer.code);
  const { output } = answer.value;
  add(stage, "caracteres del documento", output.document.length);
  add(stage, "preguntas", output.questions.length);
  add(stage, "peticiones", (output.requests ?? []).length);

  const attached = applyPlanAction(launched.plan, step.id, "attach_output", {
    now: deps.now,
    actor: "ai",
    payload: { summary: output.summary, document: output.document, requests: output.requests ?? [], questions: output.questions },
  });
  if (!attached.ok) return fail(attached.code);
  const version = attached.plan.steps.find((candidate) => candidate.id === step.id)!.outputs!.at(-1)!.version;

  let next = attached.plan;
  for (const fact of output.facts ?? []) {
    const made = proposeFact(next, { key: fact.key, value: fact.value, stepId: step.id, version }, { now: deps.now, actor: "ai" });
    if (!made.ok) return fail("fact_invalid");
    next = made.plan;
    add(stage, "hechos propuestos");
  }
  return acceptance(stage, plan, next);
}

/** Runs one case through the levels. Returns what each level did, and the plan as far as it got. */
export async function runCase(evalCase: EvalCase, deps: ChainDeps): Promise<CaseRun> {
  const report = evalCase.report();
  const idea = report.input.idea;
  const levels: LevelRecord[] = [];
  const chosen: string[] = [];
  let current: Plan | undefined;
  let expectations: ExpectationResult[] | undefined;
  let stoppedBy: string | undefined;

  const run = async (level: LevelName, work: (stage: Stage) => Promise<Outcome>): Promise<boolean> => {
    const measure = await measured(level, deps, work);
    levels.push(measure.record);
    if (!measure.plan) {
      stoppedBy = measure.record.code;
      return false;
    }
    current = measure.plan;
    return true;
  };

  if (!(await run("setup", async (stage) => setup(evalCase, report, deps, stage)))) return finish();
  if (!(await run("plan", async (stage) => planLevel(current!, idea, deps, stage)))) return finish();
  if (!(await run("departments", async (stage) => departmentsLevel(current!, idea, deps, stage)))) return finish();
  expectations = evaluateExpectations(evalCase.expectations, current!);
  if (!(await run("tasks", async (stage) => tasksLevel(current!, idea, deps, stage, chosen)))) return finish();
  await run("steps", async (stage) => stepsLevel(current!, idea, deps, stage, chosen));
  return finish();

  function finish(): CaseRun {
    const plan = current;
    return {
      caseId: evalCase.id,
      label: evalCase.label,
      levels,
      ...(stoppedBy !== undefined && { stoppedBy }),
      ...(expectations !== undefined && { expectations }),
      relations: plan ? describeRelations(plan) : { departments: [], tasks: [] },
      tasksByDepartment: plan ? tasksByDepartment(plan) : {},
    };
  }
}
