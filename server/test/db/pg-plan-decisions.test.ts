/**
 * Decisions on a plan against a real PostgreSQL: the log gets its rows, is append-only, and concurrent
 * confirmations of one fact leave one winner. Runs only with TEST_DATABASE_URL, in its own schema.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { PgPlanRepository } from "../../db/pg-plan-repository.js";
import { handlePlanRequest } from "../../plan-routes.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { reportWith } from "../plan/report-fixtures.js";

const url = process.env.TEST_DATABASE_URL;
const NOW = "2026-10-08T10:00:00Z";

describe("plan decisions on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
  let pool: Pool;
  let plans: PgPlanRepository;

  before(async () => {
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 10, options: `-c search_path=${schema}` });
    const client = await pool.connect();
    try {
      await runMigrations(client);
    } finally {
      client.release();
    }
    plans = new PgPlanRepository(pool);
  });

  after(async () => {
    await pool?.end();
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  const post = (path: string, body: unknown) =>
    handlePlanRequest({ method: "POST", path, body: JSON.stringify(body), repo: plans, reports: undefined, now: () => NOW, env: {} });

  async function newPlan(): Promise<string> {
    const built = buildPlanSkeleton(reportWith());
    if (!built.ok) throw new Error("no plan");
    return (await plans.create("local", `Plan ${randomUUID()}`, built.plan)).id;
  }

  test("each decision adds its log rows, in order, with the actor the server set", async () => {
    const id = await newPlan();
    await post(`/api/plan/${id}/facts`, { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" }, confirm: true, expectedVersion: 1 });
    const { rows } = await pool.query("SELECT kind, actor, ref_id FROM plan_log WHERE plan_id = $1 ORDER BY id", [id]);
    assert.deepEqual(rows, [
      { kind: "fact_proposed", actor: "user", ref_id: "fact-product_type" },
      { kind: "fact_confirmed", actor: "user", ref_id: "fact-product_type" },
    ]);
  });

  test("the log refuses UPDATE and DELETE", async () => {
    const id = await newPlan();
    await post(`/api/plan/${id}/facts`, { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" }, expectedVersion: 1 });
    await assert.rejects(pool.query("UPDATE plan_log SET ref_id = 'x' WHERE plan_id = $1", [id]), /append-only/);
    await assert.rejects(pool.query("DELETE FROM plan_log WHERE plan_id = $1", [id]), /append-only/);
  });

  test("eight confirmations of the same fact at once: one wins, the rest are 409 version_conflict", async () => {
    const id = await newPlan();
    await post(`/api/plan/${id}/facts`, { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" }, expectedVersion: 1 });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => post(`/api/plan/${id}/facts/fact-product_type/confirm`, { expectedVersion: 2 })),
    );
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [200, 409, 409, 409, 409, 409, 409, 409]);
    assert.equal(responses.filter((response) => response.status === 409).every((response) => (response.body as { code: string }).code === "version_conflict"), true);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM plan_log WHERE plan_id = $1 AND kind = 'fact_confirmed'", [id]);
    assert.equal(rows[0].n, 1, "one confirmation in the log");
  });
});
