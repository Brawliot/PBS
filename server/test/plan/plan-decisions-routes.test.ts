import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository, type MemoryRow } from "../../plan/plan-repository-memory.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { checkPlan } from "../../plan/plan-check.js";
import type { Plan } from "../../plan/plan-model.js";
import { reportWith } from "./report-fixtures.js";

const NOW = "2026-10-08T10:00:00Z";
const LOCAL = "local";
const GAP = "plan-product-development";
const PRODUCT = { kind: "catalog", id: "product_type" } as const;
const catalog = (id: string) => ({ kind: "catalog", id }) as const;

async function call(repo: InMemoryPlanRepository, method: string, path: string, body?: unknown, env: Record<string, string> = {}): Promise<PlanResponse> {
  return handlePlanRequest({
    method,
    path,
    body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
    repo,
    reports: undefined,
    now: () => NOW,
    env,
  });
}

/** A plan from the rules, saved: its id, and the memory row to look at the log */
async function skeletonPlan(repo: InMemoryPlanRepository): Promise<string> {
  const built = buildPlanSkeleton(reportWith());
  if (!built.ok) throw new Error("no plan");
  return (await repo.create(LOCAL, "Plan", built.plan)).id;
}

const rowOf = (repo: InMemoryPlanRepository, id: string): MemoryRow => repo.rows.get(id)!;
const versionOf = async (repo: InMemoryPlanRepository, id: string) => (await repo.get(id, LOCAL))!.version;

describe("facts: create, confirm, reject", () => {
  test("a proposed fact is stored with one log entry, and the version goes up by one", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    const response = await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("mobile_game"), expectedVersion: 1 });
    assert.equal(response.status, 201);
    const body = response.body as { id: string; version: number; plan: Plan };
    assert.equal(body.version, 2);
    assert.deepEqual(body.plan.facts, [
      { id: "fact-product_type", key: PRODUCT, value: catalog("mobile_game"), status: "proposed", from: { kind: "user" }, createdAt: NOW },
    ]);
    assert.deepEqual(rowOf(repo, id).log, [{ kind: "fact_proposed", actor: "user", refId: "fact-product_type", at: NOW }]);
  });

  test("confirm: true is one write: one version up, and two entries in the log", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    const response = await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("mobile_game"), confirm: true, expectedVersion: 1 });
    assert.equal(response.status, 201);
    assert.equal((response.body as { version: number }).version, 2);
    assert.equal((await versionOf(repo, id)), 2);
    assert.deepEqual(
      rowOf(repo, id).log.map((entry) => [entry.kind, entry.actor, entry.refId]),
      [
        ["fact_proposed", "user", "fact-product_type"],
        ["fact_confirmed", "user", "fact-product_type"],
      ],
    );
  });

  test("the response has the shape of a step action: id, version, plan and derived", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    const body = (await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("web_app"), expectedVersion: 1 })).body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["derived", "id", "plan", "version"]);
  });

  test("a body that names an actor, or has any other key, is 400 invalid_body", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    const invalid = { status: 400, body: { error: "Invalid request body", code: "invalid_body" } };
    for (const extra of [{ actor: "ai" }, { actor: "user" }, { stepId: "x" }]) {
      assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("web_app"), expectedVersion: 1, ...extra }), invalid);
    }
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts/fact-x/confirm`, { expectedVersion: 1, actor: "user" }), invalid);
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/proposals/p/accept`, { expectedVersion: 1, actor: "user" }), invalid);
    assert.equal(rowOf(repo, id).version, 1, "nothing was written");
  });

  test("an old version is 409 version_conflict, and nothing changes", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("web_app"), expectedVersion: 1 });
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("saas"), expectedVersion: 1 }), {
      status: 409,
      body: { error: "The plan changed since it was loaded", code: "version_conflict" },
    });
    assert.equal(rowOf(repo, id).log.length, 1);
  });

  test("a key or value outside the catalogue is 400 invalid_fact; product_type takes no free text", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    const invalid = { status: 400, body: { error: "The fact does not fit the catalogue", code: "invalid_fact" } };
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts`, { key: catalog("shoe_size"), value: { kind: "other", text: "42" }, expectedVersion: 1 }), invalid);
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: { kind: "other", text: "A game" }, expectedVersion: 1 }), invalid);
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("not_a_type"), expectedVersion: 1 }), invalid);
  });

  test("confirming a fact that is not there is 404 unknown_fact; an id that is not valid too", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    const unknown = { status: 404, body: { error: "Fact not found", code: "unknown_fact" } };
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts/fact-none/confirm`, { expectedVersion: 1 }), unknown);
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts/BAD%20ID/reject`, { expectedVersion: 1 }), unknown);
  });

  test("a fact already confirmed is 409 not_proposed when confirmed again", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("web_app"), confirm: true, expectedVersion: 1 });
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/facts/fact-product_type/confirm`, { expectedVersion: 2 }), {
      status: 409,
      body: { error: "This fact is not waiting for a decision", code: "not_proposed" },
    });
  });

  test("reject marks the fact rejected and logs it; confirm then is refused", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("web_app"), expectedVersion: 1 });
    const rejected = await call(repo, "POST", `/api/plan/${id}/facts/fact-product_type/reject`, { expectedVersion: 2 });
    assert.equal(rejected.status, 200);
    assert.equal(((rejected.body as { plan: Plan }).plan.facts ?? [])[0].status, "rejected");
    assert.equal(rowOf(repo, id).log.at(-1)?.kind, "fact_rejected");
    assert.equal((await call(repo, "POST", `/api/plan/${id}/facts/fact-product_type/confirm`, { expectedVersion: 3 })).status, 409);
  });
});

describe("proposals: from a gap, accept and reject", () => {
  async function withConfirmed(repo: InMemoryPlanRepository, value: string): Promise<{ id: string; version: number }> {
    const id = await skeletonPlan(repo);
    await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog(value), confirm: true, expectedVersion: 1 });
    return { id, version: 2 };
  }

  test("a gap with its fact confirmed gets a proposal: 201, pending, listed in derived with its titles", async () => {
    const repo = new InMemoryPlanRepository();
    const { id, version } = await withConfirmed(repo, "mobile_game");
    const response = await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: version });
    assert.equal(response.status, 201);
    const body = response.body as { derived: { proposals: Record<string, { titles: string[] }> }; plan: Plan };
    const proposal = body.plan.proposals?.[0];
    assert.equal(proposal?.status, "pending");
    assert.deepEqual(body.derived.proposals[proposal!.id].titles, ["Design the game", "Prototype the game", "Publish the game to the stores"]);
    assert.deepEqual(rowOf(repo, id).log.at(-1), { kind: "proposal_created", actor: "user", refId: proposal!.id, at: NOW });
  });

  test("a second proposal for the same gap while one waits is 409 duplicate_pending", async () => {
    const repo = new InMemoryPlanRepository();
    const { id, version } = await withConfirmed(repo, "mobile_game");
    await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: version });
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: version + 1 }), {
      status: 409,
      body: { error: "A proposal for this task is already waiting for a decision", code: "duplicate_pending" },
    });
  });

  test("a gap whose fact is not confirmed is 409 not_expandable; a task that is not a gap or not in the plan", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: 1 }), {
      status: 409,
      body: { error: "This task cannot be expanded yet", code: "not_expandable" },
    });
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/gaps/no-such-task/proposal`, { expectedVersion: 1 }), {
      status: 404,
      body: { error: "Task not found", code: "unknown_task" },
    });
  });

  test("a confirmed value without a ready-made suggestion is 409 needs_ai, with a fixed text", async () => {
    const repo = new InMemoryPlanRepository();
    const { id, version } = await withConfirmed(repo, "mobile_app");
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: version }), {
      status: 409,
      body: { error: "There is no ready-made suggestion for this decision yet.", code: "needs_ai" },
    });
    assert.equal(rowOf(repo, id).version, version, "nothing was written");
  });

  test("accept adds the tasks, removes the gap's placeholder and logs it", async () => {
    const repo = new InMemoryPlanRepository();
    const { id, version } = await withConfirmed(repo, "mobile_game");
    const made = (await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: version })).body as { plan: Plan };
    const proposalId = made.plan.proposals![0].id;
    const accepted = await call(repo, "POST", `/api/plan/${id}/proposals/${proposalId}/accept`, { expectedVersion: version + 1 });
    assert.equal(accepted.status, 200);
    const plan = (accepted.body as { plan: Plan }).plan;
    assert.equal(plan.tasks.find((task) => task.id === GAP)?.placeholder, undefined);
    assert.ok(plan.tasks.some((task) => task.id === "expand-mobile-game-design"));
    assert.deepEqual(checkPlan(plan), []);
    assert.equal(rowOf(repo, id).log.at(-1)?.kind, "proposal_accepted");
  });

  test("a second accept of the same proposal is 409 already_decided", async () => {
    const repo = new InMemoryPlanRepository();
    const { id, version } = await withConfirmed(repo, "mobile_game");
    const made = (await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: version })).body as { plan: Plan };
    const proposalId = made.plan.proposals![0].id;
    await call(repo, "POST", `/api/plan/${id}/proposals/${proposalId}/accept`, { expectedVersion: version + 1 });
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/proposals/${proposalId}/accept`, { expectedVersion: version + 2 }), {
      status: 409,
      body: { error: "This proposal was already decided", code: "already_decided" },
    });
  });

  test("reject keeps the gap as it was, and logs the rejection", async () => {
    const repo = new InMemoryPlanRepository();
    const { id, version } = await withConfirmed(repo, "mobile_game");
    const made = (await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: version })).body as { plan: Plan };
    const proposalId = made.plan.proposals![0].id;
    const rejected = await call(repo, "POST", `/api/plan/${id}/proposals/${proposalId}/reject`, { expectedVersion: version + 1 });
    assert.equal(rejected.status, 200);
    const plan = (rejected.body as { plan: Plan }).plan;
    assert.equal(plan.proposals![0].status, "rejected");
    assert.ok(plan.tasks.find((task) => task.id === GAP)?.placeholder, "the gap still waits");
    assert.equal(rowOf(repo, id).log.at(-1)?.kind, "proposal_rejected");
  });

  test("an unknown proposal is 404 unknown_proposal", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    assert.deepEqual(await call(repo, "POST", `/api/plan/${id}/proposals/nope/accept`, { expectedVersion: 1 }), {
      status: 404,
      body: { error: "Proposal not found", code: "unknown_proposal" },
    });
  });
});

describe("the plans that are not there, and the development route", () => {
  test("a plan id that is not a uuid, a plan of another user, or no database: 404, 404 and 503", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    assert.deepEqual(await call(repo, "POST", "/api/plan/not-a-uuid/facts", { key: PRODUCT, value: catalog("web_app"), expectedVersion: 1 }), {
      status: 404,
      body: { error: "Plan not found", code: "not_found" },
    });
    const other = new InMemoryPlanRepository();
    assert.equal((await call(other, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("web_app"), expectedVersion: 1 })).status, 404);
    const none = await handlePlanRequest({ method: "POST", path: `/api/plan/${id}/facts`, body: JSON.stringify({ key: PRODUCT, value: catalog("web_app"), expectedVersion: 1 }), repo: undefined, reports: undefined, now: () => NOW, env: {} });
    assert.equal(none.status, 503);
  });

  test("the development route is 404 unless ENABLE_DEV_ROUTES=1; enabled, it proposes a fact from the AI", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    assert.equal((await call(repo, "POST", `/api/dev/plan/${id}/facts/fake-proposal`)).status, 404);
    const enabled = await call(repo, "POST", `/api/dev/plan/${id}/facts/fake-proposal`, undefined, { ENABLE_DEV_ROUTES: "1" });
    assert.equal(enabled.status, 201);
    assert.equal(rowOf(repo, id).log.at(-1)?.actor, "ai");
  });

  test("no error body carries the content of the plan", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);
    await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: { kind: "other", text: "SENTINEL-plan-content" }, expectedVersion: 1 });
    const responses = [
      await call(repo, "POST", `/api/plan/${id}/facts/fact-none/confirm`, { expectedVersion: 1 }),
      await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: 9 }),
      await call(repo, "POST", `/api/plan/${id}/facts`, { key: catalog("shoe_size"), value: { kind: "other", text: "SENTINEL-plan-content" }, expectedVersion: 1 }),
    ];
    for (const response of responses) assert.equal(JSON.stringify(response.body).includes("SENTINEL"), false);
  });
});

describe("the mobile game, end to end at the API", () => {
  test("a fact, a proposal, the acceptance, a new fact that makes the old items stale: the whole path", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await skeletonPlan(repo);

    // 1. The person confirms the product type, and the gap becomes expandable
    const confirmed = await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("mobile_game"), confirm: true, expectedVersion: 1 });
    assert.equal(confirmed.status, 201);
    assert.equal((confirmed.body as { derived: { placeholders: Record<string, { expandable: boolean }> } }).derived.placeholders[GAP].expandable, true);

    // 2. The proposal is asked for and listed
    const asked = (await call(repo, "POST", `/api/plan/${id}/gaps/${GAP}/proposal`, { expectedVersion: 2 })).body as { plan: Plan; derived: { proposals: Record<string, { tasks: number; steps: number; relations: number }> } };
    const proposalId = asked.plan.proposals![0].id;
    assert.deepEqual(asked.derived.proposals[proposalId], { tasks: 3, steps: 6, relations: 5, titles: ["Design the game", "Prototype the game", "Publish the game to the stores"] } as never);

    // 3. Accepted: the development tasks come from the fact
    const accepted = (await call(repo, "POST", `/api/plan/${id}/proposals/${proposalId}/accept`, { expectedVersion: 3 })).body as { plan: Plan };
    const gameTasks = accepted.plan.tasks.filter((task) => task.derivedFrom?.includes("fact-product_type"));
    assert.deepEqual(gameTasks.map((task) => task.id), ["expand-mobile-game-design", "expand-mobile-game-prototype", "expand-mobile-game-publish"]);
    assert.deepEqual(checkPlan(accepted.plan), []);

    // 4. A new product type: the old fact is superseded, and what came from it is listed as stale
    const changed = await call(repo, "POST", `/api/plan/${id}/facts`, { key: PRODUCT, value: catalog("web_app"), confirm: true, expectedVersion: 4 });
    const body = changed.body as { plan: Plan; derived: { stale: { taskIds: string[]; stepIds: string[] } } };
    assert.equal(body.plan.facts!.find((fact) => fact.id === "fact-product_type")?.status, "superseded");
    assert.deepEqual(body.derived.stale.taskIds.sort(), gameTasks.map((task) => task.id).sort());
    assert.deepEqual(body.derived.stale.stepIds.sort(), accepted.plan.steps.filter((step) => step.derivedFrom?.includes("fact-product_type")).map((step) => step.id).sort());
    assert.equal(body.derived.stale.stepIds.length, 6);
  });
});
