/**
 * POST /api/plan against a real PostgreSQL: the race of two requests for the same report leaves one plan.
 * Runs only when TEST_DATABASE_URL is set, in its own schema, dropped at the end.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { PgPlanRepository } from "../../db/pg-plan-repository.js";
import { PgReportRepository } from "../../db/pg-report-repository.js";
import { handlePlanRequest, type PlanRequest } from "../../plan-routes.js";
import { reportWith } from "../plan/report-fixtures.js";

const url = process.env.TEST_DATABASE_URL;

describe("POST /api/plan on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
  let pool: Pool;
  let plans: PgPlanRepository;
  let reports: PgReportRepository;

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
    reports = new PgReportRepository(pool);
  });

  after(async () => {
    await pool?.end();
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  const post = (reportId: string) =>
    handlePlanRequest({ method: "POST", path: "/api/plan", body: JSON.stringify({ reportId }), repo: plans, reports, now: () => "2026-10-08T10:00:00Z", env: {} } as PlanRequest);

  test("eight requests at once for one report: one plan row, one link, and all of them answer with it", async () => {
    const reportId = await reports.create("local", reportWith());
    const responses = await Promise.all(Array.from({ length: 8 }, () => post(reportId)));
    const { rows } = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM plans WHERE user_id = 'local'");
    assert.equal(rows[0].n, "1");
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    const ids = new Set(responses.map((response) => (response.body as { id: string }).id));
    assert.deepEqual([...ids], [(await reports.get(reportId, "local"))?.planId]);
  });

  test("a later request gives the same plan, and a plan is never linked to a second report", async () => {
    const reportId = await reports.create("local", reportWith());
    const first = (await post(reportId)).body as { id: string };
    assert.deepEqual(await post(reportId), { status: 200, body: { id: first.id } });
    const other = await reports.create("local", reportWith());
    await assert.rejects(pool.query("UPDATE reports SET plan_id = $1 WHERE id = $2", [first.id, other]), { code: "23505" });
  });
});
