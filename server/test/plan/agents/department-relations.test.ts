import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runDepartmentTasks, type DepartmentInput } from "../../../plan/agents/department-agent.js";
import { contextOf, MAX_AGENT_ATTEMPTS, type AttemptFailure } from "../../../plan/agents/contract.js";
import { applyProposalAction, createProposal } from "../../../plan/proposals.js";
import { checkPlan } from "../../../plan/plan-check.js";
import { parsePlan, type Plan, type Proposal } from "../../../plan/plan-model.js";
import { FakeJudge, FakeModel, NOW, now, planWithFact } from "./fakes.js";

/**
 * The restaurant plan, with "obtain-licences" in the department "legal" (as the real skeleton has it, phase f1).
 * Legal's tasks are then obtain-licences (f1), t-menu (f1) and t-permits (f2). Finance's task is t-viability (f1).
 */
const { plan: base, factId } = planWithFact();
const legal = base.departments[0];
const finance = base.departments[1];
const phaseId = base.phases[0].id;
const plan: Plan = parsePlan({
  ...base,
  tasks: [
    ...base.tasks,
    { id: "obtain-licences", phaseId, primaryDepartmentId: legal.id, title: "Obtain the licences", origin: { kind: "rule" }, confidence: 100 },
  ],
});
const context = contextOf("A web app for restaurants", plan);

const deptInput = (department = legal): DepartmentInput => ({
  context,
  department: { id: department.id, name: department.name, tier: department.tier },
  phases: plan.phases.map((phase) => ({ id: phase.id, name: phase.name })),
  ownTasks: plan.tasks.filter((task) => task.primaryDepartmentId === department.id).map((task) => ({ id: task.id, title: task.title, phaseId: task.phaseId })),
  confirmedOutputs: [],
  aspects: [],
});

const newTask = (id: string, overrides: Record<string, unknown> = {}) => ({ id, phaseId, title: `Title of ${id}`, derivedFrom: [factId], ...overrides });

const answer = (relations: unknown[], tasks: unknown[] = [newTask("legal-register-business")]) => ({
  tasks,
  relations,
  facts: [],
  requests: [],
  questions: [],
});

/** The failures of one attempt, recorded by the deps */
function recorded(model: FakeModel, judge: FakeJudge | null = new FakeJudge([true]), attempts = 1) {
  const failures: AttemptFailure[] = [];
  return { deps: { model, judge, attempts, onFailure: (failure: AttemptFailure) => failures.push(failure) }, failures };
}

describe("a department relates a new task to a task it already has", () => {
  test("the real case of the evaluation: a new legal task before obtain-licences passes at the first attempt", async () => {
    // Before this change the same answer failed 3 times with relation_ref, because obtain-licences was not new
    const model = new FakeModel([answer([{ from: "legal-register-business", to: "obtain-licences", type: "blocks" }])]);
    const { deps, failures } = recorded(model, new FakeJudge([true]), MAX_AGENT_ATTEMPTS);
    const result = await runDepartmentTasks(deps, deptInput(), plan, { now });
    assert.equal(result.ok, true);
    assert.equal(model.requests.length, 1);
    assert.deepEqual(failures, []);
    if (!result.ok || !result.value.proposal) throw new Error("no proposal");
    assert.deepEqual(result.value.proposal.add.relations, [{ level: "task", from: "legal-register-business", to: "obtain-licences", type: "blocks" }]);
  });

  test("a new task that follows an existing one also passes (the direction is the same rule as between new tasks)", async () => {
    const model = new FakeModel([answer([{ from: "legal-register-business", to: "t-menu", type: "follows" }])]);
    const result = await runDepartmentTasks(recorded(model).deps, deptInput(), plan, { now });
    assert.equal(result.ok, true);
  });

  test("two new tasks still pass, as before", async () => {
    const tasks = [newTask("legal-register-business"), newTask("legal-file-taxes")];
    const model = new FakeModel([answer([{ from: "legal-register-business", to: "legal-file-taxes", type: "blocks" }], tasks)]);
    assert.equal((await runDepartmentTasks(recorded(model).deps, deptInput(), plan, { now })).ok, true);
  });

  test("the accepted proposal keeps the relation, and checkPlan finds no new problem", async () => {
    const model = new FakeModel([answer([{ from: "legal-register-business", to: "obtain-licences", type: "blocks" }])]);
    const result = await runDepartmentTasks(recorded(model).deps, deptInput(), plan, { now });
    if (!result.ok || !result.value.proposal) throw new Error("no proposal");
    const withProposal: Plan = { ...plan, proposals: [...(plan.proposals ?? []), result.value.proposal] };

    const accepted = applyProposalAction(withProposal, result.value.proposal.id, "accept", { now, actor: "user" });
    if (!accepted.ok) throw new Error(accepted.code);
    assert.ok(accepted.plan.relations.some((relation) => relation.level === "task" && relation.from === "legal-register-business" && relation.to === "obtain-licences"));
    assert.deepEqual(checkPlan(accepted.plan), checkPlan(plan), "the same problems as the plan before (none)");
    assert.deepEqual(checkPlan(accepted.plan), []);
  });
});

describe("the refusals of a relation, each with its own reason", () => {
  const cases: [string, unknown[], string][] = [
    ["two tasks the department already has", [{ from: "obtain-licences", to: "t-menu", type: "blocks" }], "relation_existing_only"],
    ["an id that is in no set", [{ from: "legal-register-business", to: "legal-nowhere", type: "blocks" }], "relation_ref"],
    ["a task of another department, even when it is in the plan", [{ from: "legal-register-business", to: "t-viability", type: "blocks" }], "relation_ref"],
    ["the same task at both ends", [{ from: "obtain-licences", to: "obtain-licences", type: "blocks" }], "relation_ref"],
  ];
  for (const [name, relations, reason] of cases) {
    test(`${name}: ${reason}, on the first attempt`, async () => {
      const model = new FakeModel([answer(relations)]);
      const { deps, failures } = recorded(model);
      assert.deepEqual(await runDepartmentTasks(deps, deptInput(), plan, { now }), { ok: false, code: "invalid_output" });
      assert.equal(failures.length, 1);
      assert.equal(failures[0].reason, reason);
    });
  }

  test("a relation that closes a loop with a saved relation is invalid_result (the proposal is refused)", async () => {
    // Saved: obtain-licences blocks t-menu. The answer adds t-menu blocks the new task, and the new task blocks obtain-licences
    const looped: Plan = { ...plan, relations: [...plan.relations, { level: "task", from: "obtain-licences", to: "t-menu", type: "blocks" }] };
    const model = new FakeModel([
      answer([
        { from: "t-menu", to: "legal-register-business", type: "blocks" },
        { from: "legal-register-business", to: "obtain-licences", type: "blocks" },
      ]),
    ]);
    const { deps, failures } = recorded(model);
    assert.deepEqual(await runDepartmentTasks(deps, deptInput(), looped, { now }), { ok: false, code: "invalid_result" });
    assert.equal(failures[0].reason, "invalid_result");
  });

  test("a relation that contradicts the phases is invalid_result (the phase of t-permits is later than the new task's)", async () => {
    // t-permits is in phase f2 and the new task in f1: it cannot come after t-permits
    const model = new FakeModel([answer([{ from: "t-permits", to: "legal-register-business", type: "blocks" }])]);
    const { deps, failures } = recorded(model);
    assert.deepEqual(await runDepartmentTasks(deps, deptInput(), plan, { now }), { ok: false, code: "invalid_result" });
    assert.equal(failures[0].reason, "invalid_result");
  });
});

describe("the prompt says what a relation may join", () => {
  test("the department prompt names <own_tasks>, the id copied as it is, and the rule of two own tasks", async () => {
    const model = new FakeModel([answer([])]);
    await runDepartmentTasks(recorded(model).deps, deptInput(), plan, { now });
    const system = model.requests[0].system;
    assert.match(system, /<own_tasks>/);
    assert.match(system, /use that task's id exactly as it is written there/);
    assert.match(system, /Never join two tasks of <own_tasks>/);
    assert.match(system, /"from":"legal-register-business","to":"obtain-licences"/);
    // The meaning of the direction is unchanged
    assert.match(system, /"A blocks B" means A must be ready BEFORE B/);
  });

  test("the user message carries the own tasks with their ids and titles", async () => {
    const model = new FakeModel([answer([])]);
    await runDepartmentTasks(recorded(model).deps, deptInput(), plan, { now });
    const user = model.requests[0].user;
    assert.match(user, /<own_tasks>\n\[.*"id":"obtain-licences","title":"Obtain the licences"/);
  });
});

describe("the proposal of a relation to an existing task is created like any other", () => {
  test("createProposal on the same answer keeps the relation and does not change the plan's tasks", async () => {
    const created = createProposal(
      plan,
      {
        id: "agent-legal",
        reason: { factId },
        add: {
          tasks: [{ id: "legal-register-business", phaseId, primaryDepartmentId: legal.id, title: "Register", origin: { kind: "ai" }, confidence: 50, derivedFrom: [factId] }],
          steps: [],
          relations: [{ level: "task", from: "legal-register-business", to: "obtain-licences", type: "blocks" }],
        },
      },
      { now: () => NOW },
    );
    if (!created.ok) throw new Error(created.code);
    const proposal: Proposal = created.proposal;
    assert.equal(proposal.add.relations.length, 1);
    assert.equal(created.plan.tasks.length, plan.tasks.length, "the plan's tasks are not changed until acceptance");
  });
});
