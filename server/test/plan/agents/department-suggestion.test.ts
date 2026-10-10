import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { suggestDepartmentTasks, withDeadline, departmentsWithPendingTasks } from "../../../plan/agents/department-suggestion.js";
import { buildDepartmentInput } from "../../../plan/agents/department-input.js";
import { limitedModel, MAX_PARALLEL_DEPARTMENTS, runDepartments, type DepartmentInput } from "../../../plan/agents/department-agent.js";
import type { AgentModel, AgentRequest } from "../../../plan/agents/contract.js";
import { PROPOSAL_NOTE_LIMITS, parsePlan, type Plan } from "../../../plan/plan-model.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import { FakeJudge, NOW, now, planWithFact } from "./fakes.js";

const IDEA = "A Japanese restaurant with a bar";

/** A model that answers from its role. An Error from the function makes that call fail. Counts the roles it was asked. */
class RoleModel implements AgentModel {
  readonly roles: string[] = [];
  constructor(private readonly answer: (role: string) => unknown) {}
  async complete(request: AgentRequest): Promise<unknown> {
    this.roles.push(request.role);
    const answer = this.answer(request.role);
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  }
}

const EXTRAS = { facts: [], requests: [], questions: [] };

/** One task for a department, cited on the confirmed fact of the plan */
const tasksFor = (departmentId: string, factId: string, extras: Record<string, unknown> = {}) => ({
  tasks: [{ id: `${departmentId}-scope`, phaseId: "f1", title: `Scope of ${departmentId}`, derivedFrom: [factId] }],
  relations: [],
  ...EXTRAS,
  ...extras,
});

const noReview = { findings: [], adjustments: [], ...EXTRAS };

/** The plan with a confirmed fact, and the answers of a model for its two departments */
function setup() {
  const { plan, factId } = planWithFact();
  return { plan, factId };
}

describe("the suggestion of all departments", () => {
  test("a clash between two departments: the finding and the order are noted on both proposals, as text", async () => {
    const { plan, factId } = setup();
    const model = new RoleModel((role) => {
      if (role === "plan_review") {
        return {
          findings: [{ kind: "clash", taskIds: ["legal-scope", "finance-scope"], text: "Both need the same budget" }],
          adjustments: [{ from: "legal-scope", to: "finance-scope", type: "blocks" }],
          ...EXTRAS,
        };
      }
      return tasksFor(role.replace("department_", ""), factId);
    });
    const result = await suggestDepartmentTasks({ model, judge: new FakeJudge([true]), attempts: 1 }, plan, IDEA, { now });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.proposals.length, 2);
    for (const proposal of result.value.proposals) {
      assert.equal(proposal.status, "pending");
      assert.deepEqual(proposal.notes, ["clash: Both need the same budget", "Suggested order: Scope of legal before Scope of finance"]);
    }
  });

  test("a finding that names no proposed task goes to the first proposal only", async () => {
    const { plan, factId } = setup();
    const model = new RoleModel((role) =>
      role === "plan_review"
        ? { findings: [{ kind: "gap", taskIds: ["t-menu"], text: "The menu is not covered" }], adjustments: [], ...EXTRAS }
        : tasksFor(role.replace("department_", ""), factId),
    );
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, plan, IDEA, { now });
    if (!result.ok) throw new Error(result.code);
    const [first, second] = result.value.proposals;
    assert.deepEqual(first.notes, ["gap: The menu is not covered"]);
    assert.equal(second.notes, undefined);
  });

  test("requests and questions of a department are notes of its own proposal, with the department's name", async () => {
    const { plan, factId } = setup();
    const model = new RoleModel((role) => {
      if (role === "plan_review") return noReview;
      if (role === "department_legal") {
        return tasksFor("legal", factId, { requests: [{ to: "plan", text: "Confirm the opening date" }], questions: ["Do you want delivery?"] });
      }
      return tasksFor("finance", factId);
    });
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, plan, IDEA, { now });
    if (!result.ok) throw new Error(result.code);
    const legal = result.value.proposals.find((proposal) => proposal.add.tasks[0].primaryDepartmentId === "legal")!;
    assert.deepEqual(legal.notes, ["Request to Plan: Confirm the opening date", "Question: Do you want delivery?"]);
  });

  test("a department with no task makes no proposal: the others still do", async () => {
    const { plan, factId } = setup();
    const model = new RoleModel((role) => {
      if (role === "plan_review") return noReview;
      return role === "department_finance" ? tasksFor("finance", factId, { tasks: [] }) : tasksFor("legal", factId);
    });
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, plan, IDEA, { now });
    if (!result.ok) throw new Error(result.code);
    assert.deepEqual(result.value.proposals.map((proposal) => proposal.add.tasks[0].primaryDepartmentId), ["legal"]);
  });

  test("a department that already has a pending task proposal is skipped, and never asked", async () => {
    const { plan, factId } = setup();
    const withPending: Plan = parsePlan({
      ...plan,
      proposals: [
        {
          id: "agent-legal",
          status: "pending",
          reason: { factId },
          add: {
            tasks: [{ id: "legal-old", phaseId: "f1", primaryDepartmentId: "legal", title: "Old", origin: { kind: "ai" }, confidence: 50, derivedFrom: [factId] }],
            steps: [],
            relations: [],
          },
          createdAt: NOW,
        },
      ],
    });
    assert.deepEqual([...departmentsWithPendingTasks(withPending)], ["legal"]);
    const model = new RoleModel((role) => (role === "plan_review" ? noReview : tasksFor("finance", factId)));
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, withPending, IDEA, { now });
    if (!result.ok) throw new Error(result.code);
    assert.equal(model.roles.includes("department_legal"), false);
    assert.deepEqual(result.value.proposals.map((proposal) => proposal.add.tasks[0].primaryDepartmentId), ["finance"]);
  });

  test("a pending proposal of another department that cites the same fact does not block this one", async () => {
    const { plan, factId } = setup();
    // Legal has a pending proposal citing the fact; finance cites the same fact and must still get its proposal
    const withPending: Plan = parsePlan({
      ...plan,
      proposals: [
        {
          id: "agent-legal",
          status: "pending",
          reason: { factId },
          add: {
            tasks: [{ id: "legal-old", phaseId: "f1", primaryDepartmentId: "legal", title: "Old", origin: { kind: "ai" }, confidence: 50, derivedFrom: [factId] }],
            steps: [],
            relations: [],
          },
          createdAt: NOW,
        },
      ],
    });
    const model = new RoleModel((role) => (role === "plan_review" ? noReview : tasksFor("finance", factId)));
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, withPending, IDEA, { now });
    if (!result.ok) throw new Error(result.code);
    assert.deepEqual(result.value.proposals.map((proposal) => proposal.add.tasks[0].primaryDepartmentId), ["finance"]);
    assert.notEqual(result.value.proposals[0].id, "agent-legal");
  });

  test("the notes are cut to the limit of notes of a proposal", async () => {
    const { plan, factId } = setup();
    const findings = Array.from({ length: 20 }, (_, index) => ({ kind: "gap", taskIds: ["legal-scope"], text: `Finding ${index}` }));
    const requests = Array.from({ length: 5 }, (_, index) => ({ to: "plan", text: `Request ${index}` }));
    const model = new RoleModel((role) => {
      if (role === "plan_review") return { findings, adjustments: [], ...EXTRAS };
      return role === "department_legal" ? tasksFor("legal", factId, { requests }) : tasksFor("finance", factId);
    });
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, plan, IDEA, { now });
    if (!result.ok) throw new Error(result.code);
    const legal = result.value.proposals.find((proposal) => proposal.add.tasks[0].primaryDepartmentId === "legal")!;
    assert.equal(legal.notes!.length, PROPOSAL_NOTE_LIMITS.notes);
    assert.equal(legal.notes![0], "Request to Plan: Request 0");
  });

  test("a department that fails after its attempts fails the whole suggestion", async () => {
    const { plan, factId } = setup();
    const model = new RoleModel((role) => (role === "department_finance" ? new Error("down") : role === "plan_review" ? noReview : tasksFor("legal", factId)));
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 2 }, plan, IDEA, { now });
    assert.deepEqual(result, { ok: false, code: "agent_failed" });
  });

  test("a failing review fails the whole suggestion", async () => {
    const { plan, factId } = setup();
    const model = new RoleModel((role) => (role === "plan_review" ? new Error("down") : tasksFor(role.replace("department_", ""), factId)));
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, plan, IDEA, { now });
    assert.deepEqual(result, { ok: false, code: "agent_failed" });
  });

  test("the facts of the departments come back as they were given (the route drops the known ones)", async () => {
    const { plan, factId } = setup();
    const fact = { key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Local families" } };
    const model = new RoleModel((role) => {
      if (role === "plan_review") return noReview;
      return tasksFor(role.replace("department_", ""), factId, { facts: [fact] });
    });
    const result = await suggestDepartmentTasks({ model, judge: null, attempts: 1 }, plan, IDEA, { now });
    if (!result.ok) throw new Error(result.code);
    assert.equal(result.value.facts.length, 2);
  });
});

describe("the limits of the calls", () => {
  test("the model never runs more calls at once than the limit", async () => {
    let running = 0;
    let most = 0;
    const inner: AgentModel = {
      async complete() {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return {};
      },
    };
    const model = limitedModel(inner, 2);
    await Promise.all(Array.from({ length: 6 }, () => model.complete({ role: "x", system: "", user: "", schema: {} as never })));
    assert.equal(most, 2);
  });

  test("the departments of a plan with seven of them run at most MAX_PARALLEL_DEPARTMENTS at once", async () => {
    const base = restaurantPlan();
    const { factId } = planWithFact();
    const departments = Array.from({ length: 7 }, (_, index) => ({ id: `dept-${index}`, name: `Dept ${index}`, tier: "light" as const }));
    const plan = parsePlan({ ...base, departments, tasks: [], steps: [], relations: [], proposals: undefined, facts: planWithFact().plan.facts });
    let running = 0;
    let most = 0;
    const model: AgentModel = {
      async complete(request) {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        if (request.role === "plan_review") return noReview;
        return tasksFor(request.role.replace("department_", ""), factId);
      },
    };
    const inputs = departments.map((department) => buildDepartmentInput(plan, department.id, IDEA)) as DepartmentInput[];
    const result = await runDepartments({ model, judge: null, attempts: 1 }, inputs, plan, { now });
    assert.equal(result.ok, true);
    assert.equal(most, MAX_PARALLEL_DEPARTMENTS);
  });

  test("withDeadline gives the work's value in time, and undefined when the time is up", async () => {
    assert.equal(await withDeadline(Promise.resolve(7), 1000), 7);
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 100));
    assert.equal(await withDeadline(slow, 5), undefined);
  });
});

