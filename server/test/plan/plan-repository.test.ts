import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { applyPlanAction } from "../../plan/plan-actions.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { PLAN_SCHEMA_VERSION, StoredPlanError, readStoredPlan } from "../../plan/plan-repository.js";

const NOW = "2026-10-08T10:00:00Z";

describe("InMemoryPlanRepository", () => {
  test("create stores a valid plan at version 1 and get reads it back equal", async () => {
    const repo = new InMemoryPlanRepository();
    const created = await repo.create("local", "  Restaurante  ", restaurantPlan());
    assert.equal(created.title, "Restaurante");
    assert.equal(created.version, 1);
    assert.deepEqual(created.plan, restaurantPlan());
    assert.deepEqual(await repo.get(created.id, "local"), created);
  });

  test("every method filters by user: another user sees nothing and changes nothing", async () => {
    const repo = new InMemoryPlanRepository();
    const { id } = await repo.create("local", "Mine", restaurantPlan());
    assert.equal(await repo.get(id, "someone-else"), undefined);
    const next = applyPlanAction(restaurantPlan(), "s-menu", "launch", { now: () => NOW, actor: "user" });
    assert.ok(next.ok);
    assert.deepEqual(await repo.update(id, "someone-else", 1, next.plan, []), { ok: false, code: "not_found" });
    assert.equal((await repo.get(id, "local"))?.version, 1);
  });

  test("update with the current version saves the plan, adds the version and appends the events", async () => {
    const repo = new InMemoryPlanRepository();
    const { id } = await repo.create("local", "Plan", restaurantPlan());
    const result = applyPlanAction(restaurantPlan(), "s-menu", "launch", { now: () => NOW, actor: "user" });
    assert.ok(result.ok);

    const saved = await repo.update(id, "local", 1, result.plan, [{ stepId: "s-menu", event: result.event }]);
    assert.ok(saved.ok);
    assert.equal(saved.stored.version, 2);
    assert.deepEqual(saved.stored.plan, result.plan);
    assert.deepEqual(await repo.get(id, "local"), saved.stored);
    assert.deepEqual(repo.rows.get(id)!.events, [{ stepId: "s-menu", event: result.event }]);
  });

  test("update with an old version is a version conflict and changes nothing", async () => {
    const repo = new InMemoryPlanRepository();
    const { id } = await repo.create("local", "Plan", restaurantPlan());
    const result = applyPlanAction(restaurantPlan(), "s-menu", "launch", { now: () => NOW, actor: "user" });
    assert.ok(result.ok);
    assert.ok((await repo.update(id, "local", 1, result.plan, [])).ok);

    assert.deepEqual(await repo.update(id, "local", 1, restaurantPlan(), []), { ok: false, code: "version_conflict" });
    assert.equal((await repo.get(id, "local"))?.version, 2);
  });

  test("update of an unknown id is not_found", async () => {
    const repo = new InMemoryPlanRepository();
    assert.deepEqual(await repo.update("00000000-0000-4000-8000-000000000000", "local", 1, restaurantPlan(), []), {
      ok: false,
      code: "not_found",
    });
  });

  test("create refuses an empty or long title, and a plan that has problems", async () => {
    const repo = new InMemoryPlanRepository();
    await assert.rejects(repo.create("local", "   ", restaurantPlan()), /Invalid plan title/);
    await assert.rejects(repo.create("local", "x".repeat(201), restaurantPlan()), /Invalid plan title/);
    const broken = restaurantPlan();
    broken.relations.push({ level: "step", from: "s-menu", to: "ghost", type: "blocks" });
    await assert.rejects(repo.create("local", "Plan", broken), /must have no problems/);
  });

  test("a row with another schema version is not read, and the error carries only the code", async () => {
    const repo = new InMemoryPlanRepository();
    const { id } = await repo.create("local", "Plan", restaurantPlan());
    repo.rows.get(id)!.schemaVersion = PLAN_SCHEMA_VERSION + 1;
    const error = await repo.get(id, "local").catch((e: unknown) => e);
    assert.ok(error instanceof StoredPlanError);
    assert.equal(error.code, "schema_mismatch");
    assert.equal(error.message, "Stored plan could not be read");
  });

  test("a row whose document does not validate is not read, and the error carries only the code", async () => {
    const repo = new InMemoryPlanRepository();
    const { id } = await repo.create("local", "Plan", restaurantPlan());
    repo.rows.get(id)!.document = JSON.stringify({ departments: [{ id: "legal", name: "Secret name" }] });
    const error = await repo.get(id, "local").catch((e: unknown) => e);
    assert.ok(error instanceof StoredPlanError);
    assert.equal(error.code, "invalid_document");
    assert.ok(!error.message.includes("Secret"));
  });

  test("readStoredPlan accepts the current version and refuses the rest", () => {
    assert.deepEqual(readStoredPlan(PLAN_SCHEMA_VERSION, JSON.parse(JSON.stringify(restaurantPlan()))), restaurantPlan());
    assert.throws(() => readStoredPlan(0, restaurantPlan()), { code: "schema_mismatch" });
  });
});
