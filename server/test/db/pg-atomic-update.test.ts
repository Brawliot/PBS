/**
 * The update of a plan is one transaction: the plan, its step events and its decision log are written together or
 * not at all. A write that fails in the middle must leave no trace, and the connection must be usable afterwards.
 * The pool has one connection on purpose: a transaction left open would break the next query. Runs only with
 * TEST_DATABASE_URL, in its own schema.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { PgPlanRepository } from "../../db/pg-plan-repository.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { applyPlanAction } from "../../plan/plan-actions.js";
import type { PlanLogRecord } from "../../plan/plan-repository.js";

const url = process.env.TEST_DATABASE_URL;
const NOW = "2026-10-08T10:00:00Z";

describe("the update of a plan is atomic on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
  let pool: Pool;
  let repo: PgPlanRepository;

  before(async () => {
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` });
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

  /** The state the update must not change: the version, the document, and the number of rows of each history table */
  async function snapshot(id: string) {
    const { rows } = await pool.query(
      `SELECT (SELECT version FROM plans WHERE id = $1) AS version,
              (SELECT document::text FROM plans WHERE id = $1) AS document,
              (SELECT count(*) FROM plan_events WHERE plan_id = $1)::int AS events,
              (SELECT count(*) FROM plan_log WHERE plan_id = $1)::int AS logs`,
      [id],
    );
    return rows[0];
  }

  /** A real step change: its event is valid, and the plan is the one the action produces */
  function launchChange(plan = restaurantPlan()) {
    const stepId = plan.steps.find((step) => step.id === "s-viability")?.id ?? plan.steps[0].id;
    const changed = applyPlanAction(plan, stepId, "launch", { now: () => NOW, actor: "user" });
    if (!changed.ok) assert.fail(`launch refused: ${changed.code}`);
    return { plan: changed.plan, stepId, event: changed.event };
  }

  test("a failing decision log entry rolls back the plan and its events", async () => {
    const created = await repo.create("local", "Atomic", restaurantPlan());
    const before = await snapshot(created.id);
    const { plan, stepId, event } = launchChange();
    // The event is valid and is written first; the log entry has a kind the CHECK refuses
    const badLog = [{ kind: "not_a_kind", actor: "user", refId: "f-1", at: NOW } as unknown as PlanLogRecord];

    await assert.rejects(repo.update(created.id, "local", created.version, plan, [{ stepId, event }], badLog));
    assert.deepEqual(await snapshot(created.id), before);
    // The single connection is still usable: a real update of the same plan goes through
    assert.equal((await repo.update(created.id, "local", created.version, plan, [{ stepId, event }])).ok, true);
  });

  test("a failing step event rolls back the plan, and nothing of the log is kept", async () => {
    const created = await repo.create("local", "Atomic", restaurantPlan());
    const before = await snapshot(created.id);
    const { plan, stepId, event } = launchChange();
    const goodLog: PlanLogRecord[] = [{ kind: "fact_proposed", actor: "user", refId: "f-2", at: NOW }];
    // An action the CHECK refuses: the plan's UPDATE has already run when this insert fails
    const badEvent = { ...event, action: "not_an_action" } as unknown as typeof event;

    await assert.rejects(repo.update(created.id, "local", created.version, plan, [{ stepId, event: badEvent }], goodLog));
    assert.deepEqual(await snapshot(created.id), before);
    assert.equal((await repo.get(created.id, "local"))?.version, created.version);
    assert.equal((await repo.update(created.id, "local", created.version, plan, [{ stepId, event }], goodLog)).ok, true);
  });
});
