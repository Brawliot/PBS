import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import type { AgentModel, AgentRequest, AgentDeps } from "../../plan/agents/contract.js";
import type { Plan } from "../../plan/plan-model.js";
import { reportWith } from "./report-fixtures.js";
import { FakeJudge, FakeModel, NOW } from "./agents/fakes.js";
import { silenceConsoleError } from "../planner/helpers.js";
import "../planner/helpers.js";

const LOCAL = "local";
const IDEA = "A bakery with delivery in the city centre";

interface Store {
  plans: InMemoryPlanRepository;
  reports: InMemoryReportRepository;
}

function setup(): Store {
  return { plans: new InMemoryPlanRepository(), reports: new InMemoryReportRepository() };
}

function route(store: Store, method: string, path: string, body: unknown = undefined, agents?: AgentDeps): Promise<PlanResponse> {
  return handlePlanRequest({
    method,
    path,
    body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
    repo: store.plans,
    reports: store.reports,
    agents,
    now: () => NOW,
    env: {},
  });
}

/** A plan made from a report with the idea above, through the real route (so it is linked to its report) */
async function linkedPlan(store: Store): Promise<{ id: string; version: number }> {
  const report = { ...reportWith(), input: { ...reportWith().input, idea: IDEA } };
  const reportId = await store.reports.create(LOCAL, report);
  const created = await route(store, "POST", "/api/plan", { reportId });
  assert.equal(created.status, 201);
  const id = (created.body as { id: string }).id;
  return { id, version: (await store.plans.get(id, LOCAL))!.version };
}

/** The answer the plan level would give for this plan: its own phases, one tier, one relation and one fact */
function answerFor(plan: Plan, facts: unknown[] = [{ key: { kind: "catalog", id: "launch_channel" }, value: { kind: "other", text: "Delivery app" } }]) {
  const [first, second] = plan.departments;
  return {
    phases: plan.phases,
    tiers: [{ departmentId: first.id, tier: "core" }],
    relations: second ? [{ level: "department", from: first.id, to: second.id, type: "blocks", aspect: { kind: "catalog", id: "budget" } }] : [],
    facts,
    requests: [{ to: "plan", text: "Confirm the opening date" }],
    questions: ["Do you want delivery?"],
  };
}

/** A model that answers from a function of the plan, so the answer can match the plan of the test */
class PlanAwareModel implements AgentModel {
  readonly requests: AgentRequest[] = [];
  constructor(private readonly answer: () => unknown, private readonly beforeAnswer?: () => Promise<void>) {}
  async complete(request: AgentRequest): Promise<unknown> {
    this.requests.push(request);
    await this.beforeAnswer?.();
    return structuredClone(this.answer());
  }
}

const agentsWith = (model: AgentModel, verdicts: (boolean | Error)[] = [true]): AgentDeps => ({ model, judge: new FakeJudge(verdicts) });

// A failed suggestion is logged by its code: the log is silenced here and read by the tests that check it
let log: ReturnType<typeof silenceConsoleError>;
beforeEach(() => {
  log = silenceConsoleError();
});

describe("POST /api/plan/:id/agents/structure: a suggestion that is saved", () => {
  test("the structure and the facts are proposed, with their logs, and nothing else changes", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const before = (await store.plans.get(id, LOCAL))!.plan;
    const model = new PlanAwareModel(() => answerFor(before));
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agentsWith(model));

    assert.equal(response.status, 201);
    const body = response.body as { version: number; plan: Plan; derived: { proposals: Record<string, { structure?: { tiers: unknown[] } }> } };
    assert.equal(body.version, version + 1);
    assert.equal(model.requests.length, 1);
    assert.equal(model.requests[0].role, "plan_generate");

    const pending = body.plan.proposals?.find((item) => item.status === "pending");
    assert.ok(pending, "a pending structure proposal");
    assert.deepEqual(pending.reason, { scope: "plan" });
    assert.equal(body.derived.proposals[pending.id].structure?.tiers.length, 1);

    const fact = body.plan.facts?.[0];
    assert.equal(fact?.status, "proposed");
    assert.deepEqual(fact?.from, { kind: "agent", level: "plan" });

    assert.deepEqual(body.plan.phases, before.phases, "the phases are not changed until the person accepts");
    assert.deepEqual(body.plan.departments, before.departments, "the tiers are not changed until the person accepts");

    const logs = store.plans.rows.get(id)!.log;
    assert.deepEqual(
      logs.map((entry) => [entry.kind, entry.actor]),
      [
        ["proposal_created", "ai"],
        ["fact_proposed", "ai"],
      ],
    );
  });

  test("a suggestion with no facts still makes the structure proposal", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agentsWith(new FakeModel([answerFor(plan, [])])));
    assert.equal(response.status, 201);
    assert.equal(store.plans.rows.get(id)!.log.length, 1);
  });
});

describe("POST /api/plan/:id/agents/structure: failures save nothing", () => {
  test("the model fails on every try: 503 after three calls, nothing saved", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const model = new FakeModel([new Error("provider down")]);
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agentsWith(model));
    assert.deepEqual(response.body, { error: "The assistant is not available right now. Try again later.", code: "assistant_unavailable" });
    assert.equal(response.status, 503);
    assert.equal(model.requests.length, 3, "the call is tried three times");
    assert.equal((await store.plans.get(id, LOCAL))!.version, version);
    assert.deepEqual(log.mock.calls.map((call) => call.arguments), [["Plan structure suggestion failed:", "agent_failed"]]);
  });

  test("Jev is unavailable on every try: 503, nothing saved", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const model = new FakeModel([answerFor(plan)]);
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agentsWith(model, [new Error("Jev down")]));
    assert.equal(response.status, 503);
    assert.equal((response.body as { code: string }).code, "assistant_unavailable");
    assert.equal(model.requests.length, 3);
    assert.equal((await store.plans.get(id, LOCAL))!.version, version);
  });

  test("an answer that does not fit the plan is retried, then 502, nothing saved", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const broken = { ...answerFor(plan), tiers: [{ departmentId: "ghost", tier: "light" }] };
    const model = new FakeModel([broken]);
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agentsWith(model));
    assert.equal(response.status, 502);
    assert.equal((response.body as { code: string }).code, "suggestion_invalid");
    assert.equal(model.requests.length, 3);
    assert.equal((await store.plans.get(id, LOCAL))!.plan.proposals, undefined);
  });

  test("a fact that does not fit the catalogue fails the whole suggestion: 502, no half-saved structure", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const badFact = [{ key: { kind: "catalog", id: "launch_channel" }, value: { kind: "catalog", id: "not_a_real_value" } }];
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agentsWith(new FakeModel([answerFor(plan, badFact)])));
    assert.equal(response.status, 502);
    const stored = await store.plans.get(id, LOCAL);
    assert.equal(stored!.version, version);
    assert.equal(stored!.plan.proposals, undefined, "the structure is not kept without its facts");
  });

  test("the plan changed while the assistant was thinking: 409 version_conflict, nothing from the suggestion saved", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    // Another window saves the plan (a version bump) before the answer comes back
    const racing = new PlanAwareModel(
      () => answerFor(plan),
      async () => {
        const current = await store.plans.get(id, LOCAL);
        await store.plans.update(id, LOCAL, current!.version, current!.plan, []);
      },
    );
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agentsWith(racing));
    assert.equal(response.status, 409);
    assert.equal((response.body as { code: string }).code, "version_conflict");
    const stored = await store.plans.get(id, LOCAL);
    assert.equal(stored!.version, version + 1, "only the other window's save is there");
    assert.equal(stored!.plan.proposals, undefined);
  });
});

describe("POST /api/plan/:id/agents/structure: refusals before the assistant is called", () => {
  test("the assistant is not configured: 503 and no call", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version });
    assert.equal(response.status, 503);
    assert.equal((response.body as { code: string }).code, "assistant_unavailable");
  });

  test("a plan with no report has no idea to work from: 409 no_report, no call", async () => {
    const store = setup();
    const plan = await store.plans.create(LOCAL, "Demo", restaurantPlan());
    const model = new FakeModel([answerFor(plan.plan)]);
    const response = await route(store, "POST", `/api/plan/${plan.id}/agents/structure`, { expectedVersion: 1 }, agentsWith(model));
    assert.equal(response.status, 409);
    assert.equal((response.body as { code: string }).code, "no_report");
    assert.equal(model.requests.length, 0);
  });

  test("a second suggestion while one is pending is refused before the assistant is called", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const model = new FakeModel([answerFor(plan)]);
    const agents = agentsWith(model);
    assert.equal((await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version }, agents)).status, 201);
    const nextVersion = (await store.plans.get(id, LOCAL))!.version;
    assert.equal(model.requests.length, 1);

    const second = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: nextVersion }, agents);
    assert.equal(second.status, 409);
    assert.equal((second.body as { code: string }).code, "duplicate_pending");
    assert.equal(model.requests.length, 1, "the assistant was not called again");
  });

  test("an old version is refused with version_conflict, and no call is made", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const plan = (await store.plans.get(id, LOCAL))!.plan;
    const model = new FakeModel([answerFor(plan)]);
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version + 5 }, agentsWith(model));
    assert.equal(response.status, 409);
    assert.equal((response.body as { code: string }).code, "version_conflict");
    assert.equal(model.requests.length, 0);
  });

  test("an unknown body field is refused: 400 invalid_body", async () => {
    const store = setup();
    const { id, version } = await linkedPlan(store);
    const response = await route(store, "POST", `/api/plan/${id}/agents/structure`, { expectedVersion: version, actor: "ai" }, agentsWith(new FakeModel([{}])));
    assert.equal(response.status, 400);
  });
});
