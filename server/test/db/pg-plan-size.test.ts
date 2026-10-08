/**
 * The size limit on PostgreSQL: a plan over MAX_DOCUMENT_BYTES is refused before the write, so the version, the
 * document and the rows of plan_events and plan_log stay as they were. Runs only with TEST_DATABASE_URL.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { PgPlanRepository } from "../../db/pg-plan-repository.js";
import { MAX_DOCUMENT_BYTES, MAX_STEP_TEXT, type Plan } from "../../plan/plan-model.js";
import { BENCH_SIZES, syntheticPlan } from "../perf/generate.js";

const url = process.env.TEST_DATABASE_URL;

/** The same padding as plan-size.test.ts: a valid plan of exactly `target` bytes */
function plannedBytes(target: number): Plan {
  const plan = syntheticPlan(BENCH_SIZES.maximum);
  let deficit = target - Buffer.byteLength(JSON.stringify(plan));
  for (const step of plan.steps) {
    if (deficit === 0) break;
    const add = Math.min(MAX_STEP_TEXT - step.text.length, deficit);
    (step as { text: string }).text += "x".repeat(add);
    deficit -= add;
  }
  assert.equal(deficit, 0);
  return plan;
}

describe("the size limit on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
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

  test("an update one byte over the limit changes neither the version nor the rows", async () => {
    const created = await repo.create("local", "Grande", plannedBytes(MAX_DOCUMENT_BYTES - 1000));
    const counts = async () =>
      (await pool.query(
        "SELECT (SELECT count(*) FROM plan_events) AS events, (SELECT count(*) FROM plan_log) AS logs, (SELECT version FROM plans WHERE id = $1) AS version, (SELECT document::text FROM plans WHERE id = $1) AS document",
        [created.id],
      )).rows[0];
    const before = await counts();

    const event = { at: "2026-10-08T10:00:00Z", actor: "user" as const, action: "launch" as const, from: "not_started" as const, to: "running" as const };
    const result = await repo.update(created.id, "local", 1, plannedBytes(MAX_DOCUMENT_BYTES + 1), [{ stepId: "s-x", event }], [
      { kind: "fact_proposed", actor: "user", refId: "f-x", at: "2026-10-08T10:00:00Z" },
    ]);

    assert.deepEqual(result, { ok: false, code: "plan_too_large" });
    assert.deepEqual(await counts(), before);
  });

  test("a plan one byte over the limit is not created", async () => {
    const before = Number((await pool.query("SELECT count(*) FROM plans")).rows[0].count);
    await assert.rejects(repo.create("local", "Grande", plannedBytes(MAX_DOCUMENT_BYTES + 1)), { code: "plan_too_large" });
    assert.equal(Number((await pool.query("SELECT count(*) FROM plans")).rows[0].count), before);
  });
});
