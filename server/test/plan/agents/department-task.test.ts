import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runDepartmentTasks, runDepartments, type DepartmentInput } from "../../../plan/agents/department-agent.js";
import { runTaskSteps, type TaskInput } from "../../../plan/agents/task-agent.js";
import { contextOf, MAX_AGENT_ATTEMPTS } from "../../../plan/agents/contract.js";
import { checkPlan } from "../../../plan/plan-check.js";
import { FakeJudge, FakeModel, now, planWithFact } from "./fakes.js";

const { plan, factId } = planWithFact();
const context = contextOf("A web app for restaurants", plan);
const dept = plan.departments[0];
const other = plan.departments[1];
const phaseId = plan.phases[0].id;

const deptInput = (department = dept): DepartmentInput => ({
  context,
  department: { id: department.id, name: department.name, tier: department.tier },
  phases: plan.phases.map((phase) => ({ id: phase.id, name: phase.name })),
  ownTasks: plan.tasks.filter((task) => task.primaryDepartmentId === department.id).map((task) => ({ id: task.id, title: task.title, phaseId: task.phaseId })),
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

describe("the department level", () => {
  test("a valid answer becomes one pending proposal of its department, with its reason", async () => {
    const result = await runDepartmentTasks({ model: new FakeModel([tasksAnswer()]), judge: new FakeJudge([true]), attempts: 1 }, deptInput(), plan, { now });
    assert.equal(result.ok, true);
    if (!result.ok || !result.value.proposal) throw new Error("no proposal");
    assert.equal(result.value.proposal.status, "pending");
    assert.deepEqual(result.value.proposal.reason, { factId });
    assert.equal(result.value.proposal.add.tasks[0].primaryDepartmentId, dept.id);
    assert.deepEqual(checkPlan({ ...plan, tasks: [...plan.tasks], proposals: [result.value.proposal] }).filter((p) => p.code === "unknown_department"), []);
  });

  test("a task that cites a fact the context does not have is invalid_output, after the attempts", async () => {
    const model = new FakeModel([tasksAnswer({ tasks: [{ id: `${dept.id}-x`, phaseId, title: "x", derivedFrom: ["fact-not-here"] }] })]);
    const result = await runDepartmentTasks({ model, judge: null, attempts: MAX_AGENT_ATTEMPTS }, deptInput(), plan, { now });
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
  });

  test("a task id without the department's prefix is refused: two departments can never clash on an id", async () => {
    const model = new FakeModel([tasksAnswer({ tasks: [{ id: "shared-task", phaseId, title: "x", derivedFrom: [factId] }] })]);
    assert.deepEqual(await runDepartmentTasks({ model, judge: null, attempts: 1 }, deptInput(), plan, { now }), { ok: false, code: "invalid_output" });
  });

  test("a phase that is not in the plan is invalid_output", async () => {
    const model = new FakeModel([tasksAnswer({ tasks: [{ id: `${dept.id}-x`, phaseId: "no-phase", title: "x", derivedFrom: [factId] }] })]);
    assert.deepEqual(await runDepartmentTasks({ model, judge: null, attempts: 1 }, deptInput(), plan, { now }), { ok: false, code: "invalid_output" });
  });

  test("an empty answer is not an error and makes no proposal", async () => {
    const result = await runDepartmentTasks({ model: new FakeModel([tasksAnswer({ tasks: [], relations: [] })]), judge: null, attempts: 1 }, deptInput(), plan, { now });
    assert.equal(result.ok && result.value.proposal, undefined);
  });

  test("Jev down is relevance_unavailable; the answer is not kept", async () => {
    const result = await runDepartmentTasks({ model: new FakeModel([tasksAnswer()]), judge: new FakeJudge([new Error("down")]), attempts: 1 }, deptInput(), plan, { now });
    assert.deepEqual(result, { ok: false, code: "relevance_unavailable" });
  });

  test("all departments together: if one fails after its attempts, nothing is returned at all", async () => {
    const good = new FakeModel([tasksAnswer()]);
    const bad = new FakeModel([new Error("provider down")]);
    const runs = [deptInput(dept), deptInput(other)];
    // One model for all calls; the failing department is the one with the bad id, so the good call is answered by the first request
    const model = {
      complete: async (request: { role: string }) => (request.role.endsWith(other.id) ? bad.complete(request as never) : good.complete(request as never)),
    };
    const result = await runDepartments({ model, judge: null, attempts: 1 }, runs, plan, { now });
    assert.deepEqual(result, { ok: false, code: "agent_failed" });
  });

  test("two departments that both answer give two proposals, each with its own id prefix", async () => {
    const answerFor = (id: string) => tasksAnswer({ tasks: [{ id: `${id}-step`, phaseId, title: "t", derivedFrom: [factId] }] });
    const model = {
      complete: async (request: { role: string }) => new FakeModel([answerFor(request.role.replace("department_", ""))]).complete(request as never),
    };
    const result = await runDepartments({ model, judge: null, attempts: 1 }, [deptInput(dept), deptInput(other)], plan, { now });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.proposals.length, 2);
      assert.notEqual(result.value.proposals[0].id, result.value.proposals[1].id);
    }
  });

  test("a department that is not in the plan is unknown_department, before any call", async () => {
    const model = new FakeModel([tasksAnswer()]);
    const input = { ...deptInput(), department: { id: "not-a-dept", name: "x", tier: "core" } };
    assert.deepEqual(await runDepartments({ model, judge: null, attempts: 1 }, [input], plan, { now }), { ok: false, code: "unknown_department" });
    assert.equal(model.requests.length, 0);
  });

  test("a department sees only its own input: no other department's proposals are in its prompt", async () => {
    const model = new FakeModel([tasksAnswer()]);
    await runDepartmentTasks({ model, judge: null, attempts: 1 }, deptInput(), plan, { now });
    assert.equal(model.requests[0].role, `department_${dept.id}`);
    assert.doesNotMatch(model.requests[0].user, /agent-/);
  });
});

// A task that exists in the plan: steps of an unknown task would fail the plan's own checks
const realTask = plan.tasks[0];
const taskInput = (): TaskInput => ({
  context,
  task: { id: realTask.id, title: realTask.title, phaseId: realTask.phaseId, departmentId: realTask.primaryDepartmentId },
  confirmedOutputs: [],
});

const stepsAnswer = (steps: Record<string, unknown>[], relations: Record<string, unknown>[] = []) => ({
  steps,
  relations,
  facts: [],
  requests: [],
  questions: [],
});

const aiStep = { id: `${realTask.id}-draft`, text: "Draft the page", executor: "ai", evidence: "accepted_output", effortHours: 2, waitDays: 0, derivedFrom: [factId] };
const userStep = { id: `${realTask.id}-approve`, text: "Approve the page", executor: "user", mode: "online", evidence: "written_confirmation", effortHours: 1, waitDays: 0, derivedFrom: [factId] };

describe("the task level", () => {
  test("valid steps become one pending proposal with its steps and relations", async () => {
    const answer = stepsAnswer([aiStep, userStep], [{ from: aiStep.id, to: userStep.id, type: "feeds" }]);
    const result = await runTaskSteps({ model: new FakeModel([answer]), judge: new FakeJudge([true]), attempts: 1 }, taskInput(), plan, { now });
    assert.equal(result.ok, true);
    if (result.ok && result.value.proposal) {
      assert.equal(result.value.proposal.add.steps.length, 2);
      assert.equal(result.value.proposal.add.relations.length, 1);
      assert.equal(result.value.proposal.add.steps[0].origin.kind, "ai");
    } else throw new Error("no proposal");
  });

  test("a user step without a mode is invalid_output (the rules of a step apply)", async () => {
    const { mode: _mode, ...noMode } = userStep;
    const result = await runTaskSteps({ model: new FakeModel([stepsAnswer([noMode])]), judge: null, attempts: 1 }, taskInput(), plan, { now });
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
  });

  test("accepted output as the evidence of a user step is invalid_output", async () => {
    const wrong = { ...userStep, evidence: "accepted_output" };
    const result = await runTaskSteps({ model: new FakeModel([stepsAnswer([wrong])]), judge: null, attempts: 1 }, taskInput(), plan, { now });
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
  });

  test("a step id without the task's prefix is invalid_output", async () => {
    const result = await runTaskSteps({ model: new FakeModel([stepsAnswer([{ ...aiStep, id: "other-draft" }])]), judge: null, attempts: 1 }, taskInput(), plan, { now });
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
  });

  test("a feed from a step that is not AI breaks the plan: invalid_result after the attempts", async () => {
    const answer = stepsAnswer([aiStep, userStep], [{ from: userStep.id, to: aiStep.id, type: "feeds" }]);
    const model = new FakeModel([answer]);
    const result = await runTaskSteps({ model, judge: null, attempts: MAX_AGENT_ATTEMPTS }, taskInput(), plan, { now });
    assert.deepEqual(result, { ok: false, code: "invalid_result" });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
  });
});
