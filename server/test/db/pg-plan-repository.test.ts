/**
 * Integration tests against a real PostgreSQL. They run only when TEST_DATABASE_URL is set, and each
 * run works in its own schema, created here and dropped at the end: no table of the database is touched.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { PgPlanRepository } from "../../db/pg-plan-repository.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { applyPlanAction } from "../../plan/plan-actions.js";

const url = process.env.TEST_DATABASE_URL;
const NOW = "2026-10-08T10:00:00Z";

describe("PgPlanRepository on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
  let pool: Pool;
  let repo: PgPlanRepository;

  before(async () => {
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();

    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    const client = await pool.connect();
    try {
      await runMigrations(client);
    } finally {
      client.release();
    }
    repo = new PgPlanRepository(pool);
  });

  after(async () => {
    await pool?.end();
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  test("the migrations are applied once: a second run changes nothing", async () => {
    const client = await pool.connect();
    try {
      assert.deepEqual(await runMigrations(client), []);
    } finally {
      client.release();
    }
  });

  test("create, get and the user filter", async () => {
    const created = await repo.create("local", "Restaurante", restaurantPlan());
    assert.equal(created.version, 1);
    assert.deepEqual(created.plan, restaurantPlan());
    assert.deepEqual(await repo.get(created.id, "local"), created);
    assert.equal(await repo.get(created.id, "someone-else"), undefined);
  });

  test("update adds the version and writes the events with the plan", async () => {
    const { id } = await repo.create("local", "Plan", restaurantPlan());
    const result = applyPlanAction(restaurantPlan(), "s-viability", "launch", { now: () => NOW, actor: "user" });
    assert.ok(result.ok);

    const saved = await repo.update(id, "local", 1, result.plan, [{ stepId: "s-viability", event: result.event }]);
    assert.ok(saved.ok);
    assert.equal(saved.stored.version, 2);
    assert.deepEqual((await repo.get(id, "local"))?.plan, result.plan);

    const { rows } = await pool.query("SELECT step_id, actor, action, status_from, status_to, executor_from, executor_to FROM plan_events WHERE plan_id = $1", [id]);
    assert.deepEqual(rows, [
      { step_id: "s-viability", actor: "user", action: "launch", status_from: "not_started", status_to: "running", executor_from: null, executor_to: null },
    ]);
  });

  test("a stale version is a version conflict, an unknown id or another user is not_found, and nothing is written", async () => {
    const { id } = await repo.create("local", "Plan", restaurantPlan());
    const result = applyPlanAction(restaurantPlan(), "s-menu", "launch", { now: () => NOW, actor: "user" });
    assert.ok(result.ok);
    assert.ok((await repo.update(id, "local", 1, result.plan, [])).ok);

    assert.deepEqual(await repo.update(id, "local", 1, restaurantPlan(), [{ stepId: "s-menu", event: result.event }]), {
      ok: false,
      code: "version_conflict",
    });
    assert.deepEqual(await repo.update(randomUUID(), "local", 1, result.plan, []), { ok: false, code: "not_found" });
    assert.deepEqual(await repo.update(id, "someone-else", 2, result.plan, []), { ok: false, code: "not_found" });

    const { rowCount } = await pool.query("SELECT 1 FROM plan_events WHERE plan_id = $1", [id]);
    assert.equal(rowCount, 0);
  });

  test("the history is append-only: an update or a delete of an event is refused", async () => {
    const { id } = await repo.create("local", "Plan", restaurantPlan());
    const result = applyPlanAction(restaurantPlan(), "s-menu", "launch", { now: () => NOW, actor: "user" });
    assert.ok(result.ok);
    await repo.update(id, "local", 1, result.plan, [{ stepId: "s-menu", event: result.event }]);

    await assert.rejects(pool.query("UPDATE plan_events SET actor = 'ai' WHERE plan_id = $1", [id]), /append-only/);
    await assert.rejects(pool.query("DELETE FROM plan_events WHERE plan_id = $1", [id]), /append-only/);
  });
});
