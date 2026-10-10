import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import type { AgentDeps, AgentModel, AgentRequest } from "../../plan/agents/contract.js";
import { MAX_AGENT_ATTEMPTS } from "../../plan/agents/contract.js";
import type { Plan } from "../../plan/plan-model.js";
import type { PlanEventRecord, PlanLogRecord } from "../../plan/plan-repository.js";
import { reportWith } from "./report-fixtures.js";
import { FakeJudge, NOW, planWithFact } from "./agents/fakes.js";
import { silenceConsoleError } from "../planner/helpers.js";
import "../planner/helpers.js";

const LOCAL = "local";
const IDEA = "A restaurant in the city centre";
const TARGET = { key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Local families" } };

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

/** A stored plan with its report (the idea), so the assistant has what it needs */
async function seed(store: Store, plan: Plan, linked = true): Promise<{ id: string }> {
  const stored = await store.plans.create(LOCAL, "Restaurant", plan);
  if (linked) {
    const reportId = await store.reports.create(LOCAL, { ...reportWith(), input: { ...reportWith().input, idea: IDEA } });
    await store.reports.attachPlan(reportId, LOCAL, stored.id);
  }
  return { id: stored.id };
}

const version = async (store: Store, id: string) => (await store.plans.get(id, LOCAL))!.version;
const current = async (store: Store, id: string) => (await store.plans.get(id, LOCAL))!.plan;
/** The history and the log as they were saved (the memory repository keeps them in its rows) */
const rowOf = (store: Store, id: string) => (store.plans as unknown as { rows: Map<string, { events: PlanEventRecord[]; log: PlanLogRecord[] }> }).rows.get(id)!;

/** A model that answers from its role, and keeps every request. An Error makes that call fail. */
class RoleModel implements AgentModel {
  readonly requests: AgentRequest[] = [];
  constructor(
    private readonly answer: (request: AgentRequest) => unknown,
    private readonly delayMs = 0,
  ) {}
  async complete(request: AgentRequest): Promise<unknown> {
    this.requests.push(request);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const answer = this.answer(request);
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  }
}

/** The steps the assistant proposes for one task: one AI step, derived from the confirmed fact */
const taskStepsAnswer = (taskId: string, factId: string, extra: Record<string, unknown> = {}) => ({
  steps: [{ id: `${taskId}-research`, text: "Compare the rent of three streets", executor: "ai", evidence: "accepted_output", effortHours: 2, waitDays: 0, derivedFrom: [factId] }],
  relations: [],
  facts: [TARGET],
  requests: [],
  questions: [],
  ...extra,
});

/** One round of an AI step: a document, a question per round, a request, and a proposed fact */
const stepAnswer = (round: number, extra: Record<string, unknown> = {}) => ({
  summary: `Summary of round ${round}`,
  document: `Document of round ${round}`,
  questions: ["Which city?"],
  facts: [TARGET],
  requests: [{ to: "legal", text: "Check the licence" }],
  ...extra,
});

/** The restaurant plan with a confirmed fact and no steps: every task is free for the assistant to plan */
function noSteps(): Plan {
  const { plan } = planWithFact();
  return { ...plan, steps: [], relations: plan.relations.filter((relation) => relation.level !== "step") };
}

const agents = (model: AgentModel, judge: AgentDeps["judge"] = new FakeJudge([true])): AgentDeps => ({ model, judge, attempts: MAX_AGENT_ATTEMPTS });

describe("POST /api/plan/:id/agents/tasks/:taskId/steps", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
  });

  test("success: one pending proposal of steps and the proposed fact, saved in one write, logged as the assistant", async () => {
    const { id } = await seed(store, noSteps());
    const factId = (await current(store, id)).facts![0].id;
    const model = new RoleModel(() => taskStepsAnswer("t-opening", factId));
    const response = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1 }, agents(model));

    assert.equal(response.status, 201);
    assert.equal(await version(store, id), 2);
    assert.deepEqual(model.requests.map((request) => request.role), ["task_steps"]);
    const plan = await current(store, id);
    const proposal = plan.proposals!.find((item) => item.status === "pending")!;
    assert.equal(proposal.add.steps[0].id, "t-opening-research");
    assert.equal(proposal.add.steps[0].executor, "ai");
    assert.equal(plan.steps.length, 0, "nothing is in the plan until the person accepts");
    const fact = plan.facts!.find((item) => item.status === "proposed")!;
    assert.deepEqual(fact.from, { kind: "agent", level: "department" });
    assert.deepEqual(
      rowOf(store, id).log.map((entry) => [entry.kind, entry.actor]),
      [
        ["proposal_created", "ai"],
        ["fact_proposed", "ai"],
      ],
    );
  });

  test("the same fact is not proposed again: a second task with the same answer adds no duplicate", async () => {
    const { id } = await seed(store, noSteps());
    const factId = (await current(store, id)).facts![0].id;
    const model = new RoleModel(() => taskStepsAnswer("t-opening", factId));
    await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1 }, agents(model));
    const second = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-permits/steps`, { expectedVersion: 2 }, agents(new RoleModel(() => taskStepsAnswer("t-permits", factId))));
    assert.equal(second.status, 201);
    const plan = await current(store, id);
    assert.equal(plan.facts!.filter((fact) => fact.status === "proposed").length, 1);
    assert.equal(plan.proposals!.filter((item) => item.status === "pending").length, 2);
  });

  test("the cheap checks answer without calling the assistant", async () => {
    const withSteps = await seed(store, planWithFact().plan);
    const gap = { ...noSteps(), tasks: noSteps().tasks.map((task) => (task.id === "t-opening" ? { ...task, placeholder: { waitsFor: ["launch_channel"] } } : task)) };
    const gapped = await seed(store, gap);
    const bare = await seed(store, { ...noSteps(), facts: undefined });
    const unlinked = await seed(store, noSteps(), false);
    const model = new RoleModel(() => taskStepsAnswer("t-opening", "fact-product_type"));
    const cases: [string, string, number, PlanResponse["body"]][] = [
      [withSteps.id, "t-viability", 1, { error: "This is not available in the current state of the plan", code: "not_available" }],
      [gapped.id, "t-opening", 1, { error: "This is not available in the current state of the plan", code: "not_available" }],
      [bare.id, "t-opening", 1, { error: "Confirm at least one decision first, so the assistant has something to build on.", code: "no_confirmed_facts" }],
      [unlinked.id, "t-opening", 1, { error: "This plan was not made from a report, so there is no idea to work from", code: "no_report" }],
    ];
    for (const [id, task, expected, body] of cases) {
      const response = await call(store, "POST", `/api/plan/${id}/agents/tasks/${task}/steps`, { expectedVersion: expected }, agents(model));
      assert.equal(response.status, 409, `${task}: 409`);
      assert.deepEqual(response.body, body);
    }
    const unknown = await call(store, "POST", `/api/plan/${withSteps.id}/agents/tasks/t-nope/steps`, { expectedVersion: 1 }, agents(model));
    assert.deepEqual(unknown, { status: 404, body: { error: "Task not found", code: "unknown_task" } });
    const conflict = await call(store, "POST", `/api/plan/${bare.id}/agents/tasks/t-opening/steps`, { expectedVersion: 9 }, agents(model));
    assert.equal((conflict.body as { code: string }).code, "version_conflict");
    assert.equal(model.requests.length, 0, "no call was made for any of them");
  });

  test("a second suggestion for a task with steps waiting is refused before the assistant is called", async () => {
    const { id } = await seed(store, noSteps());
    const factId = (await current(store, id)).facts![0].id;
    await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1 }, agents(new RoleModel(() => taskStepsAnswer("t-opening", factId))));
    const model = new RoleModel(() => taskStepsAnswer("t-opening", factId));
    const again = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 2 }, agents(model));
    assert.deepEqual(again, { status: 409, body: { error: "A suggestion of this kind is already waiting for a decision", code: "duplicate_pending" } });
    assert.equal(model.requests.length, 0);
  });

  test("the assistant fails after its tries: 503, and nothing is saved", async () => {
    const { id } = await seed(store, noSteps());
    const model = new RoleModel(() => new Error("provider down"));
    const response = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1 }, agents(model));
    silenceConsoleError();
    assert.equal(response.status, 503);
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
    assert.equal(await version(store, id), 1);
    assert.equal((await current(store, id)).proposals, undefined);
  });

  test("an answer that does not fit the plan: 502, and nothing is saved", async () => {
    const { id } = await seed(store, noSteps());
    const bad = { steps: [{ id: "other-step", text: "x", executor: "ai", evidence: "none", effortHours: 1, waitDays: 0, derivedFrom: ["fact-product_type"] }], relations: [], facts: [], requests: [], questions: [] };
    const response = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1 }, agents(new RoleModel(() => bad)));
    silenceConsoleError();
    assert.equal(response.status, 502);
    assert.equal(await version(store, id), 1);
  });

  test("a wait longer than the limit: 503, and nothing is saved even if the answer comes later", async () => {
    const { id } = await seed(store, noSteps());
    const factId = (await current(store, id)).facts![0].id;
    const model = new RoleModel(() => taskStepsAnswer("t-opening", factId), 50);
    const response = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1 }, agents(model), 5);
    silenceConsoleError();
    assert.equal(response.status, 503);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(await version(store, id), 1);
  });

  test("the assistant has nothing to add: 200, nothing saved", async () => {
    const { id } = await seed(store, noSteps());
    const response = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1 }, agents(new RoleModel(() => taskStepsAnswer("t-opening", "fact-product_type", { steps: [] }))));
    assert.equal(response.status, 200);
    assert.equal(await version(store, id), 1);
  });

  test("the body is strict: an extra field is refused", async () => {
    const { id } = await seed(store, noSteps());
    const response = await call(store, "POST", `/api/plan/${id}/agents/tasks/t-opening/steps`, { expectedVersion: 1, text: "x" }, agents(new RoleModel(() => ({}))));
    assert.deepEqual(response, { status: 400, body: { error: "Invalid request body", code: "invalid_body" } });
  });
});

describe("POST /api/plan/:id/agents/steps/:stepId/run", () => {
  let store: Store;
  beforeEach(() => {
    store = setup();
  });

  /** The restaurant plan with a confirmed fact: s-viability is an AI step, ready to start */
  const aiPlan = () => planWithFact().plan;
  const run = (id: string, stepId: string, body: unknown, model: AgentModel, timeout?: number) =>
    call(store, "POST", `/api/plan/${id}/agents/steps/${stepId}/run`, body, agents(model), timeout);
  const stepOf = async (id: string, stepId: string) => (await current(store, id)).steps.find((step) => step.id === stepId)!;

  test("launch: the person's start and the assistant's output are saved in one write, as two history entries", async () => {
    const { id } = await seed(store, aiPlan());
    const model = new RoleModel((request) => (request.role === "step_run" ? stepAnswer(1) : undefined));
    const response = await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, model);

    assert.equal(response.status, 200);
    assert.equal(await version(store, id), 2);
    assert.equal(model.requests.length, 1);
    const step = await stepOf(id, "s-viability");
    assert.equal(step.status, "waiting_user");
    assert.deepEqual(
      step.events.map((event) => [event.actor, event.action, event.from, event.to]),
      [
        ["user", "launch", "not_started", "running"],
        ["ai", "attach_output", "running", "waiting_user"],
      ],
    );
    assert.deepEqual(
      rowOf(store, id).events.map((record) => [record.stepId, record.event.action]),
      [
        ["s-viability", "launch"],
        ["s-viability", "attach_output"],
      ],
    );
    const output = step.outputs![0];
    assert.equal(output.summary, "Summary of round 1");
    assert.equal(output.document, "Document of round 1");
    assert.equal(output.requests?.[0].text, "Check the licence");
    assert.deepEqual(output.questions, [{ question: "Which city?" }]);
    const fact = (await current(store, id)).facts!.find((item) => item.status === "proposed")!;
    assert.deepEqual(fact.from, { kind: "step", stepId: "s-viability", version: 1 });
    assert.deepEqual(
      rowOf(store, id).log.map((entry) => [entry.kind, entry.actor]),
      [["fact_proposed", "ai"]],
    );
  });

  test("the assistant gets the step, the idea, the confirmed fact and the task; the round is 1", async () => {
    const { id } = await seed(store, aiPlan());
    const model = new RoleModel(() => stepAnswer(1));
    await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, model);
    const user = model.requests[0].user;
    assert.match(user, /<idea>\nA restaurant in the city centre\n<\/idea>/);
    assert.match(user, /<task>\n\{"title":"Viability"\}\n<\/task>/);
    assert.match(user, /"round":1/);
    assert.match(user, /"value":\{"kind":"catalog","id":"web_app"\}/, "the confirmed fact is in the context");
  });

  test("answer in round 2: the answers and the round reach the assistant, and only the latest output keeps its document", async () => {
    const { id } = await seed(store, aiPlan());
    await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, new RoleModel(() => stepAnswer(1)));
    const model = new RoleModel(() => stepAnswer(2));
    const response = await run(id, "s-viability", { action: "answer", payload: { answers: ["Milan"] }, expectedVersion: 2 }, model);
    assert.equal(response.status, 200);
    assert.match(model.requests[0].user, /"answer":"Milan"/);
    assert.match(model.requests[0].user, /"round":2/);
    const outputs = (await stepOf(id, "s-viability")).outputs!;
    assert.equal(outputs.length, 2);
    assert.equal(outputs[0].document, undefined);
    assert.equal(outputs[1].document, "Document of round 2");
    assert.equal(outputs[0].summary, "Summary of round 1");
  });

  test("the facts of a later round are not proposed twice", async () => {
    const { id } = await seed(store, aiPlan());
    await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, new RoleModel(() => stepAnswer(1)));
    await run(id, "s-viability", { action: "answer", payload: { answers: ["Milan"] }, expectedVersion: 2 }, new RoleModel(() => stepAnswer(2)));
    const facts = (await current(store, id)).facts!.filter((fact) => fact.status === "proposed");
    assert.equal(facts.length, 1);
  });

  test("a third round works; a fourth is rounds_exceeded and the assistant is not called", async () => {
    const { id } = await seed(store, aiPlan());
    await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, new RoleModel(() => stepAnswer(1)));
    await run(id, "s-viability", { action: "answer", payload: { answers: ["a"] }, expectedVersion: 2 }, new RoleModel(() => stepAnswer(2)));
    const third = await run(id, "s-viability", { action: "answer", payload: { answers: ["b"] }, expectedVersion: 3 }, new RoleModel(() => stepAnswer(3)));
    assert.equal(third.status, 200);
    assert.equal((await stepOf(id, "s-viability")).outputs!.length, 3);

    const model = new RoleModel(() => stepAnswer(4));
    const fourth = await run(id, "s-viability", { action: "answer", payload: { answers: ["c"] }, expectedVersion: 4 }, model);
    assert.deepEqual(fourth, { status: 409, body: { error: "The step has used all its rounds", code: "rounds_exceeded" } });
    assert.equal(model.requests.length, 0);
  });

  test("a step that is not ready is refused before the assistant is called", async () => {
    const plan = aiPlan();
    const blocked = { ...plan, relations: [...plan.relations, { level: "step" as const, from: "s-menu", to: "s-viability", type: "blocks" as const }] };
    const { id } = await seed(store, blocked);
    const model = new RoleModel(() => stepAnswer(1));
    const response = await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, model);
    assert.deepEqual(response, { status: 409, body: { error: "The step is not ready to start", code: "not_ready" } });
    assert.equal(model.requests.length, 0);
  });

  test("a step that is not AI is not_allowed, and an unknown step is 404", async () => {
    const { id } = await seed(store, aiPlan());
    const model = new RoleModel(() => stepAnswer(1));
    assert.deepEqual(await run(id, "s-menu", { action: "launch", expectedVersion: 1 }, model), { status: 409, body: { error: "This action is not allowed in the current state of the step", code: "not_allowed" } });
    assert.equal((await run(id, "s-nope", { action: "launch", expectedVersion: 1 }, model)).status, 404);
    assert.equal(model.requests.length, 0);
  });

  test("the answers must match the questions: a wrong count is invalid_payload, before any call", async () => {
    const { id } = await seed(store, aiPlan());
    await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, new RoleModel(() => stepAnswer(1)));
    const model = new RoleModel(() => stepAnswer(2));
    const response = await run(id, "s-viability", { action: "answer", payload: { answers: ["a", "b"] }, expectedVersion: 2 }, model);
    assert.equal((response.body as { code: string }).code, "invalid_payload");
    assert.equal(model.requests.length, 0);
  });

  test("the assistant fails: 503, and the step is exactly as it was (no running step, no events)", async () => {
    const { id } = await seed(store, aiPlan());
    const before = await current(store, id);
    const model = new RoleModel(() => new Error("provider down"));
    const response = await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, model);
    silenceConsoleError();
    assert.deepEqual(response, { status: 503, body: { error: "The assistant is not available right now. Try again later.", code: "assistant_unavailable" } });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
    assert.equal(await version(store, id), 1);
    assert.deepEqual(await current(store, id), before);
    assert.equal(rowOf(store, id).events.length, 0);
    assert.equal(rowOf(store, id).log.length, 0);
  });

  test("an output that does not fit: 502, and the step is exactly as it was", async () => {
    const { id } = await seed(store, aiPlan());
    const before = await current(store, id);
    const response = await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, new RoleModel(() => stepAnswer(1, { questions: Array(9).fill("Q?") })));
    silenceConsoleError();
    assert.equal(response.status, 502);
    assert.deepEqual(await current(store, id), before);
  });

  test("a wait longer than the limit: 503, and nothing is saved", async () => {
    const { id } = await seed(store, aiPlan());
    const response = await run(id, "s-viability", { action: "launch", expectedVersion: 1 }, new RoleModel(() => stepAnswer(1), 50), 5);
    silenceConsoleError();
    assert.equal(response.status, 503);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(await version(store, id), 1);
  });

  test("a version that changed: version_conflict, before any call", async () => {
    const { id } = await seed(store, aiPlan());
    const model = new RoleModel(() => stepAnswer(1));
    assert.equal(((await run(id, "s-viability", { action: "launch", expectedVersion: 7 }, model)).body as { code: string }).code, "version_conflict");
    assert.equal(model.requests.length, 0);
  });

  test("the body is strict: an action other than launch or answer is refused", async () => {
    const { id } = await seed(store, aiPlan());
    const model = new RoleModel(() => stepAnswer(1));
    assert.equal(((await run(id, "s-viability", { action: "confirm_output", expectedVersion: 1 }, model)).body as { code: string }).code, "invalid_body");
    assert.equal(model.requests.length, 0);
  });
});
