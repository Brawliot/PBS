/**
 * One case through the levels, each on its own starting point. The levels mode of the evaluation (`--mode levels`, the
 * default): a level never depends on the one before it, so one run shows the failures of every level at once, where the
 * chain (chain.ts) stops at the first one.
 *
 * - plan: the skeleton of the case, with the facts the person confirms (setup, as the chain does, not a level here).
 * - departments: the same skeleton, one call per department, all accepted by the person. The review is NOT inside: it is
 *   measured on its own, as in the chain it is part of the all-or-nothing of the departments.
 * - review: the tasks the departments of the SAME run proposed, when there are some; otherwise the fixed tasks of three
 *   departments, with a duplicate on purpose (synthetic.ts). Its result does not wait for the departments to pass: it
 *   always runs, and says where its tasks came from.
 * - tasks: the skeleton with two synthetic AI tasks per department, no steps; EVAL_TASKS of them get steps.
 * - steps: the skeleton's own AI steps (the research steps the plan starts with), launched and run as in the chain.
 *
 * Every level is measured with the same code as the chain (measured in chain.ts): calls, verdicts, time, tokens, counts and
 * the failed attempts with their reasons. The budget is shared by the case, so a level that finds it used up records
 * budget_exhausted and the others do the same: the cap is never passed.
 */

import { buildDepartmentInput } from "../plan/agents/department-input.js";
import { runDepartments } from "../plan/agents/department-agent.js";
import { type ProposedTask, findingTitles, runPlanReview } from "../plan/agents/plan-agent.js";
import { readiness } from "../plan/step-graph.js";
import type { Plan } from "../plan/plan-model.js";
import { type CaseRun, type ChainDeps, type LevelRecord, type Outcome, type ReviewSummary, type Stage, accept, add, departmentOutcomes, measured, planLevel, proposeAgentFacts, setup, stepsLevel, tasksLevel } from "./chain.js";
import type { EvalCase } from "./cases.js";
import { describeRelations, evaluateExpectations, tasksByDepartment } from "./checks.js";
import { syntheticReviewTasks, withSyntheticTasks } from "./synthetic.js";

/** The departments level without the review: one call per department, its proposals and facts accepted by the person */
export async function departmentsOnlyLevel(plan: Plan, idea: string, deps: ChainDeps, stage: Stage): Promise<Outcome> {
  const at = deps.now();
  const inputs = plan.departments.map((department) => buildDepartmentInput(plan, department.id, idea)).filter((input) => input !== undefined);
  const result = await runDepartments(deps.agents, inputs, plan, { now: deps.now });
  if (!result.ok) return { ok: false, code: result.code };
  const { proposals, answers } = result.value;

  add(stage, "propuestas", proposals.length);
  add(stage, "tareas", proposals.reduce((sum, proposal) => sum + proposal.add.tasks.length, 0));
  add(stage, "departamentos sin tareas", plan.departments.length - proposals.length);

  let next: Plan = { ...plan, proposals: [...(plan.proposals ?? []), ...proposals] };
  const withFacts = proposeAgentFacts(stage, next, answers.flatMap((answer) => answer.output.facts), "department", at);
  if (!withFacts.ok) return withFacts;
  next = withFacts.plan;
  for (const proposal of proposals) {
    const accepted = accept(stage, next, proposal.id, at);
    if (!accepted.ok) return accepted;
    next = accepted.plan;
  }
  return { ok: true, plan: next };
}

/** The kinds of finding the review reports, in the order the report shows them */
const REVIEW_KINDS = ["clash", "duplicate", "gap", "missing_order"] as const;

/**
 * The tasks the review reads: the ones the departments of this run proposed (they are in the plan after the departments
 * level, and not in the skeleton), or the fixed synthetic ones when no department proposed any.
 */
export function reviewTasksOf(skeleton: Plan, afterDepartments: Plan | undefined): { source: ReviewSummary["source"]; proposed: ProposedTask[] } {
  const known = new Set(skeleton.tasks.map((task) => task.id));
  const real: ProposedTask[] = (afterDepartments?.tasks ?? [])
    .filter((task) => !known.has(task.id) && task.origin.kind === "ai")
    .map((task) => ({ id: task.id, title: task.title, departmentId: task.primaryDepartmentId, phaseId: task.phaseId }));
  if (real.length > 0) return { source: "departamentos reales", proposed: real };
  return { source: "sintética", proposed: syntheticReviewTasks(skeleton) };
}

/**
 * The review on its own, read once: its findings and adjustments are counted and their titles kept, never applied. The
 * summary is always returned, even when the call failed (no findings then): the source is known before the call.
 */
export async function reviewLevel(plan: Plan, idea: string, deps: ChainDeps, stage: Stage, tasks: { source: ReviewSummary["source"]; proposed: ProposedTask[] }): Promise<{ outcome: Outcome; summary: ReviewSummary }> {
  const summary: ReviewSummary = { source: tasks.source, findings: [], adjustments: 0 };
  add(stage, "tareas propuestas", tasks.proposed.length);
  add(stage, "departamentos", new Set(tasks.proposed.map((task) => task.departmentId)).size);
  const answer = await runPlanReview(deps.agents, { idea, proposed: tasks.proposed }, plan);
  if (!answer.ok) return { outcome: { ok: false, code: answer.code }, summary };

  const { findings, adjustments } = answer.value.output;
  for (const kind of REVIEW_KINDS) add(stage, `hallazgos: ${kind}`, findings.filter((finding) => finding.kind === kind).length);
  add(stage, "ajustes", adjustments.length);
  summary.findings = findings.map((finding) => ({ kind: finding.kind, titles: findingTitles(finding, plan, tasks.proposed) }));
  summary.adjustments = adjustments.length;
  return { outcome: { ok: true, plan }, summary };
}

/** Each level from the start: the skeleton with its confirmed facts. Undefined only when the skeleton itself failed */
function startOf(evalCase: EvalCase, deps: ChainDeps): { ok: true; plan: Plan } | { ok: false; code: string } {
  const report = evalCase.report();
  return setup(evalCase, report, deps, { counts: {}, newProblems: 0 });
}

/** Runs one case through the levels. Every level starts from the same skeleton; a failure never stops the others. */
export async function runLevels(evalCase: EvalCase, deps: ChainDeps): Promise<CaseRun> {
  const idea = evalCase.report().input.idea;
  const start = startOf(evalCase, deps);
  const levels: LevelRecord[] = [];

  // A level that cannot start from the skeleton says so as its own failure, not as a crash of the run
  const from = (work: (plan: Plan, stage: Stage) => Promise<Outcome>) => async (stage: Stage): Promise<Outcome> => {
    if (!start.ok) return start;
    return work(start.plan, stage);
  };
  const run = async (level: LevelRecord["level"], work: (stage: Stage) => Promise<Outcome>): Promise<Outcome | undefined> => {
    const measure = await measured(level, deps, work);
    levels.push(measure.record);
    return measure.plan ? { ok: true, plan: measure.plan } : undefined;
  };

  const planned = await run("plan", from((plan, stage) => planLevel(plan, idea, deps, stage)));

  const departments = await run("departments", from((plan, stage) => departmentsOnlyLevel(plan, idea, deps, stage)));
  const departmentsRecord = levels[levels.length - 1];
  if (departmentsRecord.code !== "budget_exhausted" && start.ok) {
    departmentsRecord.departments = departmentOutcomes(departmentsRecord.failures, start.plan.departments.map((department) => department.id));
  }

  // The review reads the tasks of this run's departments (or the synthetic ones) and reports where they came from
  let review: ReviewSummary | undefined;
  await run("review", async (stage) => {
    if (!start.ok) return start;
    const result = await reviewLevel(start.plan, idea, deps, stage, reviewTasksOf(start.plan, departments?.ok ? departments.plan : undefined));
    review = result.summary;
    return result.outcome;
  });

  const chosen: string[] = [];
  await run(
    "tasks",
    from(async (plan, stage) => {
      const withTasks = withSyntheticTasks(plan);
      if (withTasks === undefined) return { ok: false, code: "synthetic_plan" };
      return tasksLevel(withTasks, idea, deps, stage, chosen);
    }),
  );

  // The steps level runs the research steps the skeleton already has, in the tasks that have one
  const aiTasks = start.ok ? [...new Set(start.plan.steps.filter((step) => step.executor === "ai" && readiness(step, start.plan.steps, start.plan.relations) === "ready").map((step) => step.taskId))] : [];
  await run("steps", from((plan, stage) => stepsLevel(plan, idea, deps, stage, aiTasks)));

  const departmentsPlan = departments !== undefined && departments.ok ? departments.plan : undefined;
  return {
    caseId: evalCase.id,
    label: evalCase.label,
    mode: "levels",
    levels,
    ...(review !== undefined && { review }),
    // The expectations read the plan the departments level produced; when it did not, they are not evaluated
    ...(departmentsPlan !== undefined && { expectations: evaluateExpectations(evalCase.expectations, departmentsPlan) }),
    // The department relations are the plan level's own; the task relations are those of the departments' proposals
    relations: start.ok
      ? { departments: describeRelations(planned?.ok ? planned.plan : start.plan).departments, tasks: describeRelations(departmentsPlan ?? start.plan).tasks }
      : { departments: [], tasks: [] },
    tasksByDepartment: departmentsPlan !== undefined ? tasksByDepartment(departmentsPlan) : {},
  };
}
