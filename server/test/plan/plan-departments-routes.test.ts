import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import type { AgentModel, AgentRequest, AgentDeps } from "../../plan/agents/contract.js";
import type { Plan } from "../../plan/plan-model.js";
import { reportWith } from "./report-fixtures.js";
import { FakeJudge, NOW } from "./agents/fakes.js";
import { silenceConsoleError } from "../planner/helpers.js";
import "../planner/helpers.js";

const LOCAL = "local";
const IDEA = "A bakery with delivery in the city centre";

interface Store {
  plans: InMemoryPlanRepository;
  reports: InMemoryReportRepository;
}

const setup = (): Store => ({ plans: new InMemoryPlanRepository(), reports: new InMemoryReportRepository() });

function call(store: Store, method: string, path: string, body: unknown = undefined, agents?: AgentDeps, agentTimeoutMs?: number): Promise<PlanResponse> {
  return handlePlanRequest({
    method,
    path,
    body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
    repo: store.plans,
    reports: store.reports,
    agents,
    agentTimeoutMs,
    now: () => NOW,
    env: {},
  });
}

/** A plan made from a report through the real route (so it is linked to its report) */
async function linkedPlan(store: Store): Promise<string> {
  const report = { ...reportWith(), input: { ...reportWith().input, idea: IDEA } };
  const reportId = await store.reports.create(LOCAL, report);
  const created = await call(store, "POST", "/api/plan", { reportId });
  assert.equal(created.status, 201);
  return (created.body as { id: string }).id;
}

const version = async (store: Store, id: string) => (await store.plans.get(id, LOCAL))!.version;

/** Confirms one decision through the real route, so the plan has a confirmed fact (product_type = web_app) */
async function confirmedPlan(store: Store): Promise<{ id: string; version: number }> {
  const id = await linkedPlan(store);
  const at = await version(store, id);
  const confirmed = await call(store, "POST", `/api/plan/${id}/facts`, {
    key: { kind: "catalog", id: "product_type" },
    value: { kind: "catalog", id: "web_app" },
    confirm: true,
    expectedVersion: at,
  });
  assert.equal(confirmed.status, 201);
  return { id, version: await version(store, id) };
}

/** A model that answers from its role. An Error makes that call fail. Every role asked is kept. */
class RoleModel implements AgentModel {
  readonly roles: string[] = [];
  constructor(
    private readonly answer: (role: string) => unknown,
    private readonly beforeAnswer?: (role: string) => Promise<void>,
  ) {}
  async complete(request: AgentRequest): Promise<unknown> {
    this.roles.push(request.role);
    await this.beforeAnswer?.(request.role);
    const answer = this.answer(request.role);
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  }
}

const PRODUCT_TYPE = { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" } };
const TARGET = { key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Local families" } };

/** The answers of the departments and of the review, for the plan of the test: one task each, cited on its confirmed fact */
function answersFor(plan: Plan, factId: string) {
  const [first] = plan.departments;
  const taskIds = plan.departments.map((department) => `${department.id}-scope`);
  return (role: string): unknown => {
    if (role === "plan_review") {
      return { findings: [{ kind: "clash", taskIds, text: "Both need the same budget" }], adjustments: [], facts: [], requests: [], questions: [] };
    }
    const department = role.replace("department_", "");
    const isFirst = department === first.id;
    return {
      tasks: [{ id: `${department}-scope`, phaseId: plan.phases[0].id, title: `Scope of ${department}`, derivedFrom: [factId] }],
      relations: [],
      // The first department proposes the fact the plan already has, the rest the same new one: each is kept once
      facts: isFirst ? [PRODUCT_TYPE, TARGET] : [TARGET],
      requests: isFirst ? [{ to: "plan", text: "Confirm the opening date" }] : [],
      questions: [],
    };
  };
}

async function factIdOf(store: Store, id: string): Promise<string> {
  const stored = (await store.plans.get(id, LOCAL))!;
  return stored.plan.facts!.find((fact) => fact.status === "confirmed")!.id;
}

/** The log of a plan, as the storage kept it: the route writes the kinds and actors of each change here */
const logOf = (store: Store, id: string) => (store.plans as unknown as { rows: Map<string, { log: { kind: string; actor: string }[] }> }).rows.get(id)!.log;

describe("POST /api/plan/:id/agents/departments", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
    silenceConsoleError();
  });

  test("a success saves one pending proposal per department, its notes, and the facts once each, in one write", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const model = new RoleModel(answersFor(plan, await factIdOf(store, id)));
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at }, { model, judge: new FakeJudge([true]) });

    assert.equal(response.status, 201);
    const body = response.body as { version: number; plan: Plan };
    assert.equal(body.version, at + 1);
    const proposals = body.plan.proposals ?? [];
    assert.equal(proposals.length, plan.departments.length);
    for (const proposal of proposals) {
      assert.equal(proposal.status, "pending");
      assert.ok(proposal.notes?.includes("clash: Both need the same budget"));
    }
    const legal = proposals.find((proposal) => proposal.add.tasks[0].primaryDepartmentId === plan.departments[0].id)!;
    assert.ok(legal.notes?.includes("Request to Plan: Confirm the opening date"));

    // The product type is already confirmed, so it is not proposed again; the target customer is proposed once
    const proposed = (body.plan.facts ?? []).filter((fact) => fact.status === "proposed");
    assert.equal(proposed.length, 1);
    assert.deepEqual(proposed[0].from, { kind: "agent", level: "department" });
    assert.deepEqual(proposed[0].key, TARGET.key);

    const log = logOf(store, id).slice(-(plan.departments.length + 1));
    assert.equal(log.filter((entry) => entry.kind === "proposal_created" && entry.actor === "ai").length, plan.departments.length);
    assert.equal(log.filter((entry) => entry.kind === "fact_proposed" && entry.actor === "ai").length, 1);
    assert.equal(model.roles.filter((role) => role.startsWith("department_")).length, plan.departments.length);
  });

  test("a department that fails after its attempts saves nothing and answers 503", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const answer = answersFor(plan, await factIdOf(store, id));
    const model = new RoleModel((role) => (role === `department_${plan.departments[1].id}` ? new Error("down") : answer(role)));
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at }, { model, judge: null });

    assert.deepEqual(response.body, { error: "The assistant is not available right now. Try again later.", code: "assistant_unavailable" });
    assert.equal(response.status, 503);
    assert.equal(await version(store, id), at);
    assert.deepEqual((await store.plans.get(id, LOCAL))!.plan.proposals ?? [], []);
  });

  test("a failing review saves nothing and answers 503", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const answer = answersFor(plan, await factIdOf(store, id));
    const model = new RoleModel((role) => (role === "plan_review" ? new Error("down") : answer(role)));
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at }, { model, judge: null });
    assert.equal(response.status, 503);
    assert.equal(await version(store, id), at);
  });

  test("a plan with no confirmed fact is refused before any call: no_confirmed_facts", async () => {
    const id = await linkedPlan(store);
    const model = new RoleModel(() => ({}));
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: await version(store, id) }, { model, judge: null });
    assert.deepEqual(response.body, {
      error: "Confirm at least one decision first, so the assistant has something to build on.",
      code: "no_confirmed_facts",
    });
    assert.equal(response.status, 409);
    assert.equal(model.roles.length, 0);
  });

  test("a structure waiting for a decision is refused before any call: not_available", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const structure = new RoleModel(() => ({ phases: plan.phases, tiers: [], relations: [], facts: [], requests: [], questions: [] }));
    const suggested = await call(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: at }, { model: structure, judge: null });
    assert.equal(suggested.status, 201);

    const model = new RoleModel(answersFor(plan, await factIdOf(store, id)));
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: await version(store, id) }, { model, judge: null });
    assert.equal((response.body as { code: string }).code, "not_available");
    assert.equal(response.status, 409);
    assert.equal(model.roles.length, 0);
  });

  test("a second press while every department has a pending proposal is refused without a call: duplicate_pending", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const model = new RoleModel(answersFor(plan, await factIdOf(store, id)));
    const first = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at }, { model, judge: null });
    assert.equal(first.status, 201);
    const calls = model.roles.length;

    const second = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at + 1 }, { model, judge: null });
    assert.equal((second.body as { code: string }).code, "duplicate_pending");
    assert.equal(second.status, 409);
    assert.equal(model.roles.length, calls);
  });

  test("a plan that was not made from a report has no idea to work from: no_report", async () => {
    const created = await store.plans.create(LOCAL, "Plan", restaurantPlan());
    const confirmed = await call(store, "POST", `/api/plan/${created.id}/facts`, { ...PRODUCT_TYPE, confirm: true, expectedVersion: created.version });
    assert.equal(confirmed.status, 201);
    const model = new RoleModel(() => ({}));
    const response = await call(store, "POST", `/api/plan/${created.id}/agents/departments`, { expectedVersion: created.version + 1 }, { model, judge: null });
    assert.equal((response.body as { code: string }).code, "no_report");
    assert.equal(model.roles.length, 0);
  });

  test("without the assistant configured: 503 assistant_unavailable, and nothing is called", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at });
    assert.equal(response.status, 503);
    assert.equal((response.body as { code: string }).code, "assistant_unavailable");
  });

  test("a body that is not { expectedVersion } is invalid_body", async () => {
    const { id } = await confirmedPlan(store);
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: 1, extra: true }, { model: new RoleModel(() => ({})), judge: null });
    assert.equal(response.status, 400);
    assert.equal((response.body as { code: string }).code, "invalid_body");
  });

  test("a wrong version is refused before any call: version_conflict", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const model = new RoleModel(() => ({}));
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at - 1 }, { model, judge: null });
    assert.equal((response.body as { code: string }).code, "version_conflict");
    assert.equal(model.roles.length, 0);
  });

  test("a change made while the assistant thinks makes the write refuse: version_conflict, nothing saved", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    let changed = false;
    const model = new RoleModel(answersFor(plan, await factIdOf(store, id)), async (role) => {
      if (role.startsWith("department_") && !changed) {
        changed = true;
        const other = await call(store, "POST", `/api/plan/${id}/facts`, {
          key: { kind: "catalog", id: "launch_channel" },
          value: { kind: "other", text: "Test channel" },
          expectedVersion: at,
        });
        assert.equal(other.status, 201);
      }
    });
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at }, { model, judge: null });
    assert.equal(response.status, 409);
    assert.equal((response.body as { code: string }).code, "version_conflict");
    assert.deepEqual((await store.plans.get(id, LOCAL))!.plan.proposals ?? [], []);
  });

  test("an answer later than the deadline is refused as unavailable, and nothing is saved", async () => {
    const { id, version: at } = await confirmedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const answer = answersFor(plan, await factIdOf(store, id));
    const model = new RoleModel(answer, () => new Promise((resolve) => setTimeout(resolve, 80)));
    const response = await call(store, "POST", `/api/plan/${id}/agents/departments`, { expectedVersion: at }, { model, judge: null }, 10);
    assert.equal(response.status, 503);
    assert.equal((response.body as { code: string }).code, "assistant_unavailable");
    assert.equal(await version(store, id), at);
  });
});
