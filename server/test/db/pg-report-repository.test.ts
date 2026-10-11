/**
 * Integration tests of PgReportRepository and migration 002 against a real PostgreSQL. They run only when
 * TEST_DATABASE_URL is set, each in its own schema, dropped at the end (the same setup as the plan tests).
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { addOtherUser, OTHER_USER, PROVISIONAL_USER } from "./users.js";
import { PgPlanRepository } from "../../db/pg-plan-repository.js";
import { PgReportRepository } from "../../db/pg-report-repository.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { ReportStoreError } from "../../plan/report-repository.js";
import { reportWith } from "../plan/report-fixtures.js";

const url = process.env.TEST_DATABASE_URL;
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("PgReportRepository on PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
  let pool: Pool;
  let reports: PgReportRepository;
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
      await addOtherUser(client);
    } finally {
      client.release();
    }
    reports = new PgReportRepository(pool);
    plans = new PgPlanRepository(pool);
  });

  after(async () => {
    await pool?.end();
    const admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  test("a report is stored and read back equal, with no plan", async () => {
    const report = reportWith();
    const id = await reports.create(PROVISIONAL_USER, report);
    assert.deepEqual(await reports.get(id, PROVISIONAL_USER), { id, report, planId: null });
  });

  test("a report that does not pass is refused before it reaches the table", async () => {
    await assert.rejects(reports.create(PROVISIONAL_USER, { ...reportWith(), extra: 1 }), (error: unknown) => {
      return error instanceof ReportStoreError && error.code === "invalid_report";
    });
  });

  test("another user's report and an unknown id are not found", async () => {
    const id = await reports.create(PROVISIONAL_USER, reportWith());
    assert.equal(await reports.get(id, OTHER_USER), undefined);
    assert.equal(await reports.get(MISSING, PROVISIONAL_USER), undefined);
  });

  test("the first plan is linked; the second attach returns the first plan and links nothing", async () => {
    const id = await reports.create(PROVISIONAL_USER, reportWith());
    const first = await plans.create(PROVISIONAL_USER, "First", restaurantPlan());
    const second = await plans.create(PROVISIONAL_USER, "Second", restaurantPlan());
    assert.deepEqual(await reports.attachPlan(id, PROVISIONAL_USER, first.id), { ok: true, planId: first.id, attached: true });
    assert.deepEqual(await reports.attachPlan(id, PROVISIONAL_USER, second.id), { ok: true, planId: first.id, attached: false });
    assert.equal((await reports.get(id, PROVISIONAL_USER))?.planId, first.id);
  });

  test("ten attaches at once: exactly one links a plan, and all of them answer with that plan", async () => {
    const id = await reports.create(PROVISIONAL_USER, reportWith());
    const candidates = await Promise.all(Array.from({ length: 10 }, (_, i) => plans.create(PROVISIONAL_USER, `Race ${i}`, restaurantPlan())));
    const results = await Promise.all(candidates.map((plan) => reports.attachPlan(id, PROVISIONAL_USER, plan.id)));
    assert.equal(results.filter((result) => result.ok && result.attached).length, 1);
    const linked = (await reports.get(id, PROVISIONAL_USER))?.planId;
    assert.ok(linked);
    for (const result of results) assert.deepEqual(result, { ok: true, planId: linked, attached: result.ok && result.attached });
  });

  test("a plan can belong to only one report (unique key), and a missing plan is refused", async () => {
    const plan = await plans.create(PROVISIONAL_USER, "Shared", restaurantPlan());
    const a = await reports.create(PROVISIONAL_USER, reportWith());
    const b = await reports.create(PROVISIONAL_USER, reportWith());
    await reports.attachPlan(a, PROVISIONAL_USER, plan.id);
    await assert.rejects(pool.query("UPDATE reports SET plan_id = $1 WHERE id = $2", [plan.id, b]), { code: "23505" });
    await assert.rejects(reports.attachPlan(b, PROVISIONAL_USER, MISSING), { code: "23503" });
    assert.equal((await reports.get(b, PROVISIONAL_USER))?.planId, null);
  });

  test("a report of another user cannot be linked", async () => {
    const id = await reports.create(PROVISIONAL_USER, reportWith());
    const plan = await plans.create(PROVISIONAL_USER, "Mine", restaurantPlan());
    assert.deepEqual(await reports.attachPlan(id, OTHER_USER, plan.id), { ok: false, code: "not_found" });
  });

  test("the report of a plan is found by the plan's id, for its owner only; a plan with no report has none", async () => {
    const report = reportWith();
    const id = await reports.create(PROVISIONAL_USER, report);
    const plan = await plans.create(PROVISIONAL_USER, "Linked", restaurantPlan());
    await reports.attachPlan(id, PROVISIONAL_USER, plan.id);
    assert.deepEqual(await reports.getByPlanId(plan.id, PROVISIONAL_USER), { id, report, planId: plan.id });
    assert.equal(await reports.getByPlanId(plan.id, OTHER_USER), undefined);
    const demo = await plans.create(PROVISIONAL_USER, "Demo", restaurantPlan());
    assert.equal(await reports.getByPlanId(demo.id, PROVISIONAL_USER), undefined);
  });
});
