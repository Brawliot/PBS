import { describe, test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, isPlanPath, LOCAL_USER, type PlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import type { PlanRepository } from "../../plan/plan-repository.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { derivePlan } from "../../plan/plan-derived.js";
import type { Plan } from "../../plan/plan-model.js";

const NOW = "2026-10-08T10:00:00Z";
const DEV = { ENABLE_DEV_ROUTES: "1" };
const SECRET = "CONTENIDO-SECRETO-NO-DEBE-SALIR";

/** The restaurant plan with a text no error may echo back */
function secretPlan(): Plan {
  const plan = restaurantPlan();
  plan.steps = plan.steps.map((step) => ({ ...step, text: SECRET }));
  plan.departments = plan.departments.map((department) => ({ ...department, name: SECRET }));
  return plan;
}

function call(
  repo: PlanRepository | undefined,
  method: string,
  path: string,
  body?: unknown,
  env: Record<string, string | undefined> = {},
): Promise<PlanResponse> {
  const request: PlanRequest = {
    method,
    path,
    body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
    repo,
    now: () => NOW,
    env,
  };
  return handlePlanRequest(request);
}

async function createPlan(repo: InMemoryPlanRepository, plan: Plan = restaurantPlan()): Promise<string> {
  return (await repo.create(LOCAL_USER, "Plan", plan)).id;
}

const act = (id: string, step: string, body: unknown) => call(undefined, "POST", `/api/plan/${id}/steps/${step}/actions`, body);
const actOn = (repo: PlanRepository, id: string, step: string, body: unknown) =>
  call(repo, "POST", `/api/plan/${id}/steps/${step}/actions`, body);

describe("isPlanPath", () => {
  test("only the plan and development paths, not the planner", () => {
    assert.equal(isPlanPath("/api/plan"), true);
    assert.equal(isPlanPath("/api/plan/abc/steps/s/actions"), true);
    assert.equal(isPlanPath("/api/dev/demo-plan"), true);
    assert.equal(isPlanPath("/api/planner"), false);
    assert.equal(isPlanPath("/api/planner/abc"), false);
    assert.equal(isPlanPath("/plan"), false);
  });
});

describe("GET /api/plan/:id", () => {
  let repo: InMemoryPlanRepository;
  let id: string;
  beforeEach(async () => {
    repo = new InMemoryPlanRepository();
    id = await createPlan(repo);
  });

  test("200 with the id, title, version, plan and derived values", async () => {
    const got = await call(repo, "GET", `/api/plan/${id}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, {
      id,
      title: "Plan",
      version: 1,
      plan: restaurantPlan(),
      derived: derivePlan(restaurantPlan()),
      catalog: { factKeys: ["product_type", "target_customer", "revenue_model", "launch_channel"], factValues: { product_type: ["mobile_game", "mobile_app", "web_app", "saas", "physical_product", "service", "marketplace"] } },
    });
  });

  test("an id that is not a uuid, or a plan of another user, is 404 not_found", async () => {
    const expected = { status: 404, body: { error: "Plan not found", code: "not_found" } };
    assert.deepEqual(await call(repo, "GET", "/api/plan/not-a-uuid"), expected);
    assert.deepEqual(await call(repo, "GET", "/api/plan/00000000-0000-4000-8000-000000000000"), expected);
    const other = await repo.create("someone-else", "Other", restaurantPlan());
    assert.deepEqual(await call(repo, "GET", `/api/plan/${other.id}`), expected);
  });

  test("without a repository it is 503 storage_unavailable", async () => {
    assert.deepEqual(await call(undefined, "GET", `/api/plan/${id}`), {
      status: 503,
      body: { error: "Plan storage is not configured", code: "storage_unavailable" },
    });
  });
});

describe("POST /api/plan/:id/steps/:stepId/actions", () => {
  let repo: InMemoryPlanRepository;
  let id: string;
  beforeEach(async () => {
    repo = new InMemoryPlanRepository();
    id = await createPlan(repo);
  });

  test("200 applies the action, saves it with its event, and answers the new version", async () => {
    const response = await actOn(repo, id, "s-menu", { action: "launch", expectedVersion: 1 });
    assert.equal(response.status, 200);
    const next = { ...restaurantPlan(), steps: restaurantPlan().steps.map((s) => (s.id === "s-menu" ? { ...s, status: "running", events: [{ at: NOW, actor: "user", action: "launch", from: "not_started", to: "running" }] } : s)) };
    assert.deepEqual(response.body, {
      id,
      version: 2,
      plan: next,
      derived: derivePlan(next as Plan),
      event: { at: NOW, actor: "user", action: "launch", from: "not_started", to: "running" },
    });
    assert.equal(repo.rows.get(id)!.events.length, 1);
    assert.equal(repo.rows.get(id)!.events[0].stepId, "s-menu");
  });

  test("what is read back after a change is the same plan that was answered", async () => {
    const changed = (await actOn(repo, id, "s-menu", { action: "launch", expectedVersion: 1 })) as PlanResponse & { body: { plan: Plan } };
    const read = (await call(repo, "GET", `/api/plan/${id}`)).body as { version: number; plan: Plan };
    assert.equal(read.version, 2);
    assert.deepEqual(read.plan, changed.body.plan);
  });

  test("a stale expectedVersion is 409 version_conflict and the plan does not change", async () => {
    await actOn(repo, id, "s-menu", { action: "launch", expectedVersion: 1 });
    const stale = await actOn(repo, id, "s-menu", { action: "submit_proof", payload: { text: "Recibo" }, expectedVersion: 1 });
    assert.deepEqual(stale, { status: 409, body: { error: "The plan changed since it was loaded", code: "version_conflict" } });
    assert.equal((await repo.get(id, LOCAL_USER))?.version, 2);
  });

  test("a body that tries to set the actor is refused: the server sets it", async () => {
    for (const body of [
      { action: "launch", expectedVersion: 1, actor: "ai" },
      { action: "launch", expectedVersion: 1, actor: "user" },
      { action: "launch", expectedVersion: 1, unexpected: true },
    ]) {
      assert.deepEqual(await actOn(repo, id, "s-viability", body), {
        status: 400,
        body: { error: "Invalid request body", code: "invalid_body" },
      });
    }
    assert.equal((await repo.get(id, LOCAL_USER))?.version, 1);
  });

  test("a body that is not valid JSON, or does not fit the schema, is 400 invalid_body", async () => {
    const expected = { status: 400, body: { error: "Invalid request body", code: "invalid_body" } };
    assert.deepEqual(await actOn(repo, id, "s-menu", "{not json"), expected);
    assert.deepEqual(await actOn(repo, id, "s-menu", "null"), expected);
    assert.deepEqual(await actOn(repo, id, "s-menu", { action: "explode", expectedVersion: 1 }), expected);
    assert.deepEqual(await actOn(repo, id, "s-menu", { action: "launch" }), expected);
    assert.deepEqual(await actOn(repo, id, "s-menu", { action: "launch", expectedVersion: 0 }), expected);
    assert.deepEqual(await actOn(repo, id, "s-menu", { action: "launch", expectedVersion: 1.5 }), expected);
  });

  test("a step that does not exist, or an id of the wrong form, is 404 unknown_step", async () => {
    const expected = { status: 404, body: { error: "Step not found", code: "unknown_step" } };
    assert.deepEqual(await actOn(repo, id, "ghost", { action: "launch", expectedVersion: 1 }), expected);
    assert.deepEqual(await actOn(repo, id, "Bad Step!", { action: "launch", expectedVersion: 1 }), expected);
  });

  test("a plan id of the wrong form is 404 not_found", async () => {
    assert.deepEqual(await actOn(repo, "nope", "s-menu", { action: "launch", expectedVersion: 1 }), {
      status: 404,
      body: { error: "Plan not found", code: "not_found" },
    });
  });

  test("each refusal of the domain has its status and its code", async () => {
    const launchS = (step: string) => actOn(repo, id, step, { action: "launch", expectedVersion: 1 });
    // Not ready: the permits wait for the menu
    assert.deepEqual(await launchS("s-permits"), { status: 409, body: { error: "The step is not ready to start", code: "not_ready" } });
    // Not allowed: a step that has not started cannot be confirmed
    assert.deepEqual(await actOn(repo, id, "s-menu", { action: "confirm_output", expectedVersion: 1 }), {
      status: 409,
      body: { error: "This action is not allowed in the current state of the step", code: "not_allowed" },
    });
    // Invalid executor change: the same executor
    assert.deepEqual(await actOn(repo, id, "s-menu", { action: "change_executor", payload: { executor: "user", mode: "online" }, expectedVersion: 1 }), {
      status: 400,
      body: { error: "The executor change is not valid", code: "invalid_executor_change" },
    });
    // Executor in use: the viability output feeds the permits
    assert.deepEqual(await actOn(repo, id, "s-viability", { action: "change_executor", payload: { executor: "user", mode: "online" }, expectedVersion: 1 }), {
      status: 409,
      body: { error: "Another step uses this step's result, so its executor cannot change", code: "executor_in_use" },
    });
    // Invalid payload: an output needs a summary
    await launchS("s-viability");
    assert.deepEqual(await actOn(repo, id, "s-viability", { action: "attach_output", payload: {}, expectedVersion: 2 }), {
      status: 400,
      body: { error: "The payload does not fit this action", code: "invalid_payload" },
    });
  });

  test("the fake output is for AI steps only: on a user step it is 403 wrong_actor", async () => {
    const response = await call(repo, "POST", `/api/dev/plan/${id}/steps/s-menu/fake-output`, undefined, DEV);
    assert.deepEqual(response, { status: 403, body: { error: "This actor cannot do this action", code: "wrong_actor" } });
  });

  test("rounds run out: the answer after the third output is 409 rounds_exceeded", async () => {
    const step = "s-viability";
    const sequence = [
      { action: "launch", expectedVersion: 1 },
      { action: "attach_output", payload: { summary: "x", questions: [] }, expectedVersion: 2 },
      { action: "answer", payload: { answers: [] }, expectedVersion: 3 },
      { action: "attach_output", payload: { summary: "x", questions: [] }, expectedVersion: 4 },
      { action: "answer", payload: { answers: [] }, expectedVersion: 5 },
      { action: "attach_output", payload: { summary: "x", questions: [] }, expectedVersion: 6 },
    ];
    for (const body of sequence) assert.equal((await actOn(repo, id, step, body)).status, 200);
    assert.deepEqual(await actOn(repo, id, step, { action: "answer", payload: { answers: [] }, expectedVersion: 7 }), {
      status: 409,
      body: { error: "The step has used all its rounds", code: "rounds_exceeded" },
    });
  });

  test("a step that needs a proof is 409 missing_proof until it has one", async () => {
    const plan = restaurantPlan();
    plan.steps = plan.steps.map((s) => (s.id === "s-viability" ? { ...s, evidence: { kind: "receipt" as const } } : s));
    const receiptId = await createPlan(repo, plan);
    const send = (body: unknown) => actOn(repo, receiptId, "s-viability", body);
    await send({ action: "launch", expectedVersion: 1 });
    await send({ action: "attach_output", payload: { summary: "x", questions: [] }, expectedVersion: 2 });
    assert.deepEqual(await send({ action: "confirm_output", expectedVersion: 3 }), {
      status: 409,
      body: { error: "The step needs a proof before it can be closed", code: "missing_proof" },
    });
  });
});

describe("the development routes", () => {
  test("without ENABLE_DEV_ROUTES=1 they are 404, for every method", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await createPlan(repo);
    const notFound = { status: 404, body: { error: "Not found" } };
    for (const env of [{}, { ENABLE_DEV_ROUTES: "0" }, { ENABLE_DEV_ROUTES: "true" }]) {
      assert.deepEqual(await call(repo, "POST", "/api/dev/demo-plan", undefined, env), notFound);
      assert.deepEqual(await call(repo, "POST", `/api/dev/plan/${id}/steps/s-viability/fake-output`, undefined, env), notFound);
    }
  });

  test("with ENABLE_DEV_ROUTES=1 the demo plan is created and can be read", async () => {
    const repo = new InMemoryPlanRepository();
    const created = await call(repo, "POST", "/api/dev/demo-plan", undefined, DEV);
    assert.equal(created.status, 201);
    const { id } = created.body as { id: string };
    const read = await call(repo, "GET", `/api/plan/${id}`);
    assert.equal(read.status, 200);
    assert.deepEqual((read.body as { plan: Plan }).plan, restaurantPlan());
  });

  test("the fake output is an AI output: it goes to a running AI step, and the event says ai", async () => {
    const repo = new InMemoryPlanRepository();
    const { id } = (await call(repo, "POST", "/api/dev/demo-plan", undefined, DEV)).body as { id: string };
    await actOn(repo, id, "s-viability", { action: "launch", expectedVersion: 1 });
    const response = await call(repo, "POST", `/api/dev/plan/${id}/steps/s-viability/fake-output`, undefined, DEV);
    assert.equal(response.status, 200);
    const body = response.body as { version: number; event: Record<string, unknown> };
    assert.equal(body.version, 3);
    assert.deepEqual(body.event, { at: NOW, actor: "ai", action: "attach_output", from: "running", to: "waiting_user" });
  });

  test("unknown development paths are 404", async () => {
    const repo = new InMemoryPlanRepository();
    assert.deepEqual(await call(repo, "GET", "/api/dev/demo-plan", undefined, DEV), { status: 404, body: { error: "Not found" } });
  });
});

describe("the other routes", () => {
  test("POST /api/plan without a database: a valid body is 503; a body that is not valid is 400 first", async () => {
    const storage = { error: "Plan storage is not configured", code: "storage_unavailable" };
    assert.deepEqual(await call(undefined, "POST", "/api/plan", { reportId: "00000000-0000-4000-8000-000000000000" }), { status: 503, body: storage });
    assert.deepEqual(await call(undefined, "POST", "/api/plan", "not json"), { status: 400, body: { error: "Invalid request body", code: "invalid_body" } });
  });

  test("any other path or method is 404", async () => {
    const repo = new InMemoryPlanRepository();
    assert.deepEqual(await call(repo, "DELETE", "/api/plan/x"), { status: 404, body: { error: "Not found" } });
    assert.deepEqual(await call(repo, "GET", "/api/plan"), { status: 404, body: { error: "Not found" } });
  });
});

describe("errors", () => {
  let logged: unknown[][];
  beforeEach(() => {
    logged = [];
    mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  });
  afterEach(() => mock.restoreAll());

  test("a stored row that cannot be read is a generic 500, and the log has only the code", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await createPlan(repo, secretPlan());
    repo.rows.get(id)!.schemaVersion = 99;
    const response = await call(repo, "GET", `/api/plan/${id}`);
    assert.deepEqual(response, { status: 500, body: { error: "Internal server error", code: "internal_error" } });
    assert.deepEqual(logged, [["Plan request failed:", "schema_mismatch"]]);
    assert.ok(!JSON.stringify(logged).includes(SECRET));
  });

  test("an error of another kind from the storage is a generic 500 with the code only", async () => {
    const failing = {
      get: async () => {
        throw Object.assign(new Error(`value ${SECRET}`), { code: "08006" });
      },
    } as unknown as PlanRepository;
    const response = await call(failing, "GET", "/api/plan/00000000-0000-4000-8000-000000000000");
    assert.equal(response.status, 500);
    assert.deepEqual(logged, [["Plan request failed:", "08006"]]);
    assert.ok(!JSON.stringify(response.body).includes(SECRET));
    assert.ok(!JSON.stringify(logged).includes(SECRET));
  });

  test("no error answer carries the content of the plan", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await createPlan(repo, secretPlan());
    const attempts: Promise<PlanResponse>[] = [
      call(repo, "GET", "/api/plan/not-a-uuid"),
      call(repo, "POST", `/api/plan/${id}/steps/ghost/actions`, { action: "launch", expectedVersion: 1 }),
      call(repo, "POST", `/api/plan/${id}/steps/s-permits/actions`, { action: "launch", expectedVersion: 1 }),
      call(repo, "POST", `/api/plan/${id}/steps/s-menu/actions`, { action: "launch", expectedVersion: 9 }),
      call(repo, "POST", `/api/plan/${id}/steps/s-menu/actions`, { action: "attach_output", expectedVersion: 1, payload: { summary: SECRET } }),
      call(repo, "POST", `/api/plan/${id}/steps/s-menu/actions`, { action: "launch", expectedVersion: 1, actor: SECRET }),
      call(repo, "POST", `/api/dev/plan/${id}/steps/s-menu/fake-output`, undefined, DEV),
    ];
    for (const response of await Promise.all(attempts)) {
      assert.ok(response.status >= 400, JSON.stringify(response));
      assert.ok(!JSON.stringify(response.body).includes(SECRET), `leaks: ${response.status}`);
    }
  });
});
