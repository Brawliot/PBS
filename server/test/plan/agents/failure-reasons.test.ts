import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runDepartmentTasks, type DepartmentInput } from "../../../plan/agents/department-agent.js";
import { runPlanGenerate, runPlanReview, type PlanReviewInput } from "../../../plan/agents/plan-agent.js";
import { runTaskSteps, type TaskInput } from "../../../plan/agents/task-agent.js";
import { type RunnerInput } from "../../../plan/step-runner.js";
import { runStepAgent } from "../../../plan/agents/step-agent.js";
import { type AgentDeps, type AttemptFailure, FACT_PROMPT, MAX_AGENT_ATTEMPTS, contextOf } from "../../../plan/agents/contract.js";
import { DEPENDENCY_ASPECTS } from "../../../plan/department-catalog.js";
import { FACT_KEYS, PRODUCT_TYPES } from "../../../plan/fact-catalog.js";
import { PROPOSAL_ERRORS } from "../../../plan/proposals.js";
import { FakeJudge, FakeModel, now, planWithFact } from "./fakes.js";

/** A value no failure may carry into a report: the fakes put it in ids, titles and texts */
const SENTINEL = "sentinel-do-not-report-7f3a";

const { plan, factId } = planWithFact();
const context = contextOf("A web app for restaurants", plan);
const dept = plan.departments[0];
const other = plan.departments[1];
const phaseId = plan.phases[0].id;

/** The failures of a call, with the deps that record them */
function recorded(deps: Omit<AgentDeps, "onFailure">): { deps: AgentDeps; failures: AttemptFailure[] } {
  const failures: AttemptFailure[] = [];
  return { deps: { ...deps, onFailure: (failure) => failures.push(failure) }, failures };
}

const deptInput = (): DepartmentInput => ({
  context,
  department: { id: dept.id, name: dept.name, tier: dept.tier },
  phases: plan.phases.map((phase) => ({ id: phase.id, name: phase.name })),
  ownTasks: [],
  confirmedOutputs: [],
  aspects: [],
});

const tasksAnswer = (overrides: Record<string, unknown> = {}) => ({
  tasks: [{ id: `${dept.id}-discovery`, phaseId, title: "Map the users", derivedFrom: [factId] }],
  relations: [],
  facts: [],
  requests: [],
  questions: [],
  ...overrides,
});

const expectReason = (failures: AttemptFailure[], reason: string) => {
  assert.ok(failures.length > 0, "a failed attempt was reported");
  for (const failure of failures) assert.equal(failure.reason, reason);
};

describe("the reason of a failed attempt, at the departments level", () => {
  test("a task id without the department's prefix fails with id_prefix on all three attempts, and the result keeps its code only", async () => {
    // The real failure of the first evaluation: the model proposed ids such as "obtain-licences", never "<department>-obtain-licences"
    const model = new FakeModel([tasksAnswer({ tasks: [{ id: "obtain-licences", phaseId, title: "x", derivedFrom: [factId] }] })]);
    const { deps, failures } = recorded({ model, judge: null });
    const result = await runDepartmentTasks(deps, deptInput(), plan, { now });

    assert.deepEqual(result, { ok: false, code: "invalid_output" });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
    assert.equal(failures.length, MAX_AGENT_ATTEMPTS);
    assert.deepEqual(
      failures.map((failure) => [failure.role, failure.attempt, failure.code, failure.reason, failure.final]),
      [
        [`department_${dept.id}`, 1, "invalid_output", "id_prefix", false],
        [`department_${dept.id}`, 2, "invalid_output", "id_prefix", false],
        [`department_${dept.id}`, 3, "invalid_output", "id_prefix", true],
      ],
    );
  });

  test("with the prefix the same call passes, and no failure is reported", async () => {
    const model = new FakeModel([tasksAnswer()]);
    const { deps, failures } = recorded({ model, judge: new FakeJudge([true]), attempts: 1 });
    assert.equal((await runDepartmentTasks(deps, deptInput(), plan, { now })).ok, true);
    assert.deepEqual(failures, []);
  });

  test("without onFailure the result and the number of calls are the same as before", async () => {
    const model = new FakeModel([tasksAnswer({ tasks: [{ id: "obtain-licences", phaseId, title: "x", derivedFrom: [factId] }] })]);
    assert.deepEqual(await runDepartmentTasks({ model, judge: null, attempts: MAX_AGENT_ATTEMPTS }, deptInput(), plan, { now }), { ok: false, code: "invalid_output" });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
  });

  test("each rule has its own reason", async () => {
    const cases: [string, unknown, string][] = [
      ["a phase that is not in the plan", tasksAnswer({ tasks: [{ id: `${dept.id}-x`, phaseId: "no-phase", title: "x", derivedFrom: [factId] }] }), "phase_unknown"],
      ["a fact the context does not have", tasksAnswer({ tasks: [{ id: `${dept.id}-x`, phaseId, title: "x", derivedFrom: ["fact-missing"] }] }), "fact_unknown"],
      ["a relation to a task of another department", tasksAnswer({ relations: [{ from: `${dept.id}-discovery`, to: `${other.id}-x`, type: "blocks" }] }), "relation_ref"],
      ["a fact key outside the catalogue", tasksAnswer({ facts: [{ key: { kind: "catalog", id: "unknown_key" }, value: { kind: "other", text: SENTINEL } }] }), "fact_catalog"],
      ["a product type outside the catalogue", tasksAnswer({ facts: [{ key: { kind: "catalog", id: "product_type" }, value: { kind: "other", text: SENTINEL } }] }), "fact_catalog"],
      ["an answer of the wrong shape", tasksAnswer({ tasks: [{ id: `${dept.id}-x`, phaseId: 123, title: "x", derivedFrom: [factId] }] }), "schema"],
    ];
    for (const [name, answer, reason] of cases) {
      const { deps, failures } = recorded({ model: new FakeModel([answer]), judge: null, attempts: 1 });
      const result = await runDepartmentTasks(deps, deptInput(), plan, { now });
      assert.deepEqual(result, { ok: false, code: "invalid_output" }, name);
      expectReason(failures, reason);
    }
  });

  test("a schema failure keeps the path and the code of the issue, and never the value that was sent", async () => {
    const answer = tasksAnswer({ tasks: [{ id: `${dept.id}-x`, phaseId: SENTINEL.toUpperCase(), title: SENTINEL, derivedFrom: [factId] }] });
    const { deps, failures } = recorded({ model: new FakeModel([answer]), judge: null, attempts: 1 });
    await runDepartmentTasks(deps, deptInput(), plan, { now });
    assert.equal(failures[0].reason, "schema");
    assert.match(failures[0].detail ?? "", /tasks\.0\.phaseId/);
    assert.ok(!(failures[0].detail ?? "").includes(SENTINEL.toUpperCase()));
  });

  test("a model that throws is model_error; Jev saying no is relevance; Jev down is judge_unavailable", async () => {
    const thrown = recorded({ model: new FakeModel([new Error("provider down")]), judge: null, attempts: 1 });
    await runDepartmentTasks(thrown.deps, deptInput(), plan, { now });
    expectReason(thrown.failures, "model_error");

    const no = recorded({ model: new FakeModel([tasksAnswer()]), judge: new FakeJudge([false]), attempts: 1 });
    await runDepartmentTasks(no.deps, deptInput(), plan, { now });
    expectReason(no.failures, "relevance");

    const down = recorded({ model: new FakeModel([tasksAnswer()]), judge: new FakeJudge([new Error("down")]), attempts: 1 });
    await runDepartmentTasks(down.deps, deptInput(), plan, { now });
    expectReason(down.failures, "judge_unavailable");
  });

  test("a refused proposal keeps the name of its proposal code", async () => {
    // A copy of the plan where an existing task already has the id the model proposes: the proposal must be refused
    const existing = plan.tasks.find((task) => task.primaryDepartmentId === dept.id);
    assert.ok(existing, "the plan has a task of the department");
    const taken = `${dept.id}-taken`;
    const clash = { ...plan, tasks: plan.tasks.map((task) => (task.id === existing.id ? { ...task, id: taken } : task)) };
    const { deps, failures } = recorded({ model: new FakeModel([tasksAnswer({ tasks: [{ id: taken, phaseId, title: "x", derivedFrom: [factId] }] })]), judge: null, attempts: 1 });
    assert.deepEqual(await runDepartmentTasks(deps, deptInput(), clash, { now }), { ok: false, code: "id_taken" });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, "id_taken");
    assert.equal(failures[0].reason, "id_taken");
    assert.ok((PROPOSAL_ERRORS as readonly string[]).includes(failures[0].reason));
  });

  test("no failure reports a value: not an id, a title or a text the model sent", async () => {
    const answer = tasksAnswer({
      tasks: [{ id: SENTINEL, phaseId: "no-phase", title: SENTINEL, derivedFrom: [factId] }],
      questions: [SENTINEL],
      requests: [{ to: "plan", text: SENTINEL }],
    });
    const { deps, failures } = recorded({ model: new FakeModel([answer, answer, answer]), judge: null });
    await runDepartmentTasks(deps, deptInput(), plan, { now });
    assert.ok(failures.length > 0);
    assert.ok(!JSON.stringify(failures).includes(SENTINEL));
  });
});

describe("the reason of a failed attempt, at the plan level", () => {
  const generateAnswer = (overrides: Record<string, unknown> = {}) => ({
    phases: structuredClone(plan.phases),
    tiers: plan.departments.map((department) => ({ departmentId: department.id, tier: department.tier })),
    relations: [],
    facts: [],
    requests: [],
    questions: [],
    ...overrides,
  });

  test("generate: a tier for an unknown department is structure; an unknown aspect is plan_check; a bad id is schema", async () => {
    const cases: [unknown, string, string][] = [
      [generateAnswer({ tiers: [{ departmentId: "no-such-department", tier: "core" }] }), "structure", "invalid_result"],
      [generateAnswer({ relations: [{ level: "department", from: dept.id, to: other.id, type: "blocks", aspect: { kind: "catalog", id: "not-an-aspect" } }] }), "plan_check", "invalid_result"],
      [generateAnswer({ tiers: [{ departmentId: "BAD ID", tier: "core" }] }), "schema", "invalid_output"],
    ];
    for (const [answer, reason, code] of cases) {
      const { deps, failures } = recorded({ model: new FakeModel([answer]), judge: null, attempts: 1 });
      assert.deepEqual(await runPlanGenerate(deps, context, plan), { ok: false, code });
      expectReason(failures, reason);
    }
  });

  test("review: a finding about an unknown task is task_ref; an adjustment from a task to itself is relation_ref", async () => {
    const input: PlanReviewInput = {
      idea: "idea",
      proposed: [{ id: `${dept.id}-discovery`, title: "Map the users", departmentId: dept.id, phaseId }],
    };
    const empty = { facts: [], requests: [], questions: [] };
    const unknown = recorded({ model: new FakeModel([{ findings: [{ kind: "gap", taskIds: ["no-such-task"], text: "x" }], adjustments: [], ...empty }]), judge: null, attempts: 1 });
    assert.deepEqual(await runPlanReview(unknown.deps, input, plan), { ok: false, code: "invalid_output" });
    expectReason(unknown.failures, "task_ref");

    const self = `${dept.id}-discovery`;
    const loop = recorded({ model: new FakeModel([{ findings: [], adjustments: [{ from: self, to: self, type: "blocks" }], ...empty }]), judge: null, attempts: 1 });
    assert.deepEqual(await runPlanReview(loop.deps, input, plan), { ok: false, code: "invalid_output" });
    expectReason(loop.failures, "relation_ref");
  });
});

describe("the reason of a failed attempt, at the task and step levels", () => {
  const taskId = `${dept.id}-task`;
  const taskInput = (): TaskInput => ({
    context,
    task: { id: taskId, title: "Open the restaurant", phaseId, departmentId: dept.id },
    confirmedOutputs: [],
  });
  const step = (overrides: Record<string, unknown> = {}) => ({
    id: `${taskId}-draft`,
    text: "Draft the menu",
    executor: "ai",
    evidence: "accepted_output",
    effortHours: 2,
    waitDays: 0,
    derivedFrom: [factId],
    ...overrides,
  });
  const stepsAnswer = (steps: unknown[], relations: unknown[] = [], extra: Record<string, unknown> = {}) => ({ steps, relations, facts: [], requests: [], questions: [], ...extra });

  test("task: a step id without the task's prefix is id_prefix; a fact the context does not have is fact_unknown; a relation to an unknown step is relation_ref", async () => {
    const cases: [unknown, string][] = [
      [stepsAnswer([step({ id: "other-draft" })]), "id_prefix"],
      [stepsAnswer([step({ derivedFrom: ["fact-missing"] })]), "fact_unknown"],
      [stepsAnswer([step()], [{ from: `${taskId}-draft`, to: `${taskId}-nowhere`, type: "blocks" }]), "relation_ref"],
    ];
    for (const [answer, reason] of cases) {
      const { deps, failures } = recorded({ model: new FakeModel([answer]), judge: null, attempts: 1 });
      assert.deepEqual(await runTaskSteps(deps, taskInput(), plan, { now }), { ok: false, code: "invalid_output" });
      expectReason(failures, reason);
    }
  });

  test("task: a user step without a mode breaks the rules of a step (step_rules), and its detail names the path", async () => {
    const answer = stepsAnswer([step({ id: `${taskId}-sign`, executor: "user", evidence: "written_confirmation" })]);
    const { deps, failures } = recorded({ model: new FakeModel([answer]), judge: null, attempts: 1 });
    assert.deepEqual(await runTaskSteps(deps, taskInput(), plan, { now }), { ok: false, code: "invalid_output" });
    expectReason(failures, "step_rules");
    assert.match(failures[0].detail ?? "", /mode/);
  });

  test("step: a missing field is schema with its path; a request to an unknown department is request_target; a bad fact is fact_catalog", async () => {
    const runner: RunnerInput = {
      step: { id: "legal-draft", text: "Draft", taskId, departmentId: dept.id },
      round: 1,
      answers: [],
      feeds: [],
      context,
      task: { title: "Open" },
      department: { name: dept.name },
    };
    const base = { document: "Document", questions: [], facts: [], requests: [] };
    const cases: [unknown, string][] = [
      [{ document: "Document", questions: [] }, "schema"],
      [{ ...base, summary: "Summary", requests: [{ to: "no-such-department", text: "x" }] }, "request_target"],
      [{ ...base, summary: "Summary", facts: [{ key: { kind: "catalog", id: "product_type" }, value: { kind: "other", text: "x" } }] }, "fact_catalog"],
    ];
    for (const [answer, reason] of cases) {
      const { deps, failures } = recorded({ model: new FakeModel([answer]), judge: null, attempts: 1 });
      assert.deepEqual(await runStepAgent(deps, runner, { knownDepartments: new Set([dept.id]) }), { ok: false, code: "invalid_output" });
      expectReason(failures, reason);
    }
    const summaryFailure = recorded({ model: new FakeModel([{ document: "Document", questions: [] }]), judge: null, attempts: 1 });
    await runStepAgent(summaryFailure.deps, runner, { knownDepartments: new Set([dept.id]) });
    assert.match(summaryFailure.failures[0].detail ?? "", /summary/);
  });
});

describe("the prompts state the rules their validators enforce", () => {
  /** The system prompt and the user message a level sent on its first call */
  async function sentBy(run: (deps: AgentDeps) => Promise<unknown>): Promise<{ system: string; user: string }> {
    const model = new FakeModel([new Error("only the request is read")]);
    await run({ model, judge: null, attempts: 1 });
    return { system: model.requests[0].system, user: model.requests[0].user };
  }

  test("departments: the prefix, the copied ids, the phase ids and the fact catalogue", async () => {
    const { system, user } = await sentBy((deps) => runDepartmentTasks(deps, deptInput(), plan, { now }));
    assert.ok(system.includes("STARTS with your department id"), "the id prefix rule");
    assert.ok(system.includes(`For the department "legal" an id is "legal-obtain-licences"`), "the example of the prefix");
    assert.ok(system.includes("phaseId: one of the phase ids in <phases>"), "the phase ids");
    assert.ok(system.includes('copied exactly from the "id" of the items in'), "the copied fact ids");
    assert.ok(system.includes("from and to must be ids of your tasks, and they must differ"), "the relation endpoints");
    assert.ok(system.includes(FACT_PROMPT), "the fact format");
    for (const key of FACT_KEYS) assert.ok(system.includes(key), `the catalogue key ${key}`);
    for (const type of PRODUCT_TYPES) assert.ok(system.includes(type), `the product type ${type}`);
    assert.ok(user.includes(`Your department id is "${dept.id}": every task id you propose starts with "${dept.id}-".`));
  });

  test("plan generate: the phase ids, the department ids, the relation endpoints and the aspect catalogue", async () => {
    const { system, user } = await sentBy((deps) => runPlanGenerate(deps, context, plan));
    assert.ok(system.includes("Keep EVERY phase id"), "the phase rule");
    assert.ok(system.includes("Use only the department ids of <departments>"), "the department ids");
    assert.ok(system.includes("from and to are department ids of <departments>"), "the relation endpoints");
    for (const aspect of Object.keys(DEPENDENCY_ASPECTS)) assert.ok(system.includes(aspect), `the aspect ${aspect}`);
    assert.ok(system.includes(FACT_PROMPT));
    assert.ok(user.includes("<departments>") && user.includes(dept.id));
  });

  test("plan review: the task ids it may name, the relations it must not repeat, and the plan's relations as data", async () => {
    const input: PlanReviewInput = { idea: "idea", proposed: [{ id: `${dept.id}-discovery`, title: "Map", departmentId: dept.id, phaseId }] };
    const { system, user } = await sentBy((deps) => runPlanReview(deps, input, plan));
    assert.ok(system.includes("only ids of <plan_tasks> or <proposed_tasks>"), "the findings' ids");
    assert.ok(system.includes("from and to are task ids of <plan_tasks> or <proposed_tasks>, and they must differ"), "the adjustments' ids");
    assert.ok(system.includes("Never repeat"), "no repeats");
    assert.ok(user.includes("<plan_relations>"), "the relations of the plan are sent");
  });

  test("task: the prefix, the mode of a user step, the loops and the phases", async () => {
    const { system, user } = await sentBy((deps) =>
      runTaskSteps(deps, { context, task: { id: `${dept.id}-task`, title: "Open", phaseId, departmentId: dept.id }, confirmedOutputs: [] }, plan, { now }),
    );
    assert.ok(system.includes("STARTS with the task id you are given"), "the id prefix rule");
    assert.ok(system.includes('REQUIRED for a "user" step'), "the mode rule");
    assert.ok(system.includes('"accepted_output" only for\n  an "ai" step'), "the evidence rule");
    assert.ok(system.includes("must not form a loop"), "no loops");
    assert.ok(system.includes("must not sit in a LATER phase"), "the phase order");
    assert.ok(system.includes("copied exactly from <confirmed_facts>"), "the copied fact ids");
    assert.ok(user.includes(`${dept.id}-task`));
  });

  test("step: the department ids a request may name, and the limits of the answer", async () => {
    const runner: RunnerInput = { step: { id: "legal-draft", text: "Draft", taskId: "legal-task", departmentId: dept.id }, round: 1, answers: [], feeds: [], context };
    const { system, user } = await sentBy((deps) => runStepAgent(deps, runner, { knownDepartments: new Set([dept.id, other.id]) }));
    assert.ok(system.includes("department ids in <departments>"), "the request targets");
    assert.ok(system.includes("at most 300"), "the question limit");
    assert.ok(system.includes("It is not empty"), "the document rule");
    assert.ok(user.includes("<departments>"));
    assert.ok(user.includes(JSON.stringify([dept.id, other.id])), "the ids the request may name are sent");
  });
});
