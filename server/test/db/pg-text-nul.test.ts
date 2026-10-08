/**
 * A text with the NUL character never reaches PostgreSQL: the plan and the report are refused before the write,
 * so the tables stay as they were. Runs only with TEST_DATABASE_URL, in its own schema.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { runMigrations } from "../../db/migrate.js";
import { PgPlanRepository } from "../../db/pg-plan-repository.js";
import { PgReportRepository } from "../../db/pg-report-repository.js";
import { ReportStoreError } from "../../plan/report-repository.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { reportWith } from "../plan/report-fixtures.js";

const url = process.env.TEST_DATABASE_URL;

describe("NUL never reaches PostgreSQL", { skip: url ? false : "TEST_DATABASE_URL is not set" }, () => {
  const schema = `pbs_test_${randomUUID().replace(/-/g, "")}`;
  let pool: Pool;
  let plans: PgPlanRepository;
  let reports: PgReportRepository;

  const count = async (table: "plans" | "reports") => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

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

  test("a plan with NUL in a step is refused by create: no row is written", async () => {
    const plan = restaurantPlan();
    plan.steps[0] = { ...plan.steps[0], text: "Mesa\u0000junto" };
    await assert.rejects(plans.create("local", "Restaurante", plan));
    assert.equal(await count("plans"), 0);
  });

  test("a plan with NUL in its title is refused by create: no row is written", async () => {
    await assert.rejects(plans.create("local", "Restaurante\u0000", restaurantPlan()));
    assert.equal(await count("plans"), 0);
  });

  test("an update with NUL is refused: the version and the document do not change", async () => {
    const created = await plans.create("local", "Restaurante", restaurantPlan());
    const plan = restaurantPlan();
    plan.tasks[0] = { ...plan.tasks[0], title: "Permiso\u0000local" };
    await assert.rejects(plans.update(created.id, "local", created.version, plan, []));
    assert.deepEqual(await plans.get(created.id, "local"), created);
  });

  test("a report with NUL is refused by create: no row is written", async () => {
    const report = reportWith() as unknown as { input: { idea: string } };
    report.input.idea = "Pan\u0000";
    await assert.rejects(reports.create("local", report), ReportStoreError);
    assert.equal(await count("reports"), 0);
  });
});
