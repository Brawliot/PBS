import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { checkPlan } from "../../plan/plan-check.js";
import { reportWith } from "./report-fixtures.js";
import { silenceConsoleError } from "../planner/helpers.js";
import "../planner/helpers.js";

const NOW = "2026-10-08T10:00:00Z";
const MISSING = "00000000-0000-4000-8000-000000000000";
const IDEA = "Sentinel bakery idea 91 with delivery and a long description ".repeat(3).trim();

function setup() {
  return { plans: new InMemoryPlanRepository(), reports: new InMemoryReportRepository() };
}

function call(store: ReturnType<typeof setup> | undefined, body: unknown): Promise<PlanResponse> {
  return handlePlanRequest({
    method: "POST",
    path: "/api/plan",
    body: typeof body === "string" ? body : JSON.stringify(body),
    repo: store?.plans,
    reports: store?.reports,
    now: () => NOW,
    env: {},
  });
}

const reportOf = (idea = IDEA) => ({ ...reportWith(), input: { ...reportWith().input, idea } });

describe("POST /api/plan: the answers", () => {
  test("a report without a plan gives a plan, linked to the report: 201 with the id", async () => {
    const store = setup();
    const reportId = await store.reports.create("local", reportOf());
    const response = await call(store, { reportId });
    assert.equal(response.status, 201);
    const { id } = response.body as { id: string };
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal((await store.reports.get(reportId, "local"))?.planId, id);
    const plan = await store.plans.get(id, "local");
    assert.ok(plan);
    assert.deepEqual(checkPlan(plan.plan), [], "the plan has no problems");
  });

  test("the title is the idea, cut to 80 characters", async () => {
    const store = setup();
    const reportId = await store.reports.create("local", reportOf());
    const { id } = (await call(store, { reportId })).body as { id: string };
    const title = (await store.plans.get(id, "local"))!.title;
    assert.equal(title, [...IDEA].slice(0, 80).join(""));
    assert.equal([...title].length, 80);
  });

  test("a second request for the same report gives the same plan: 200, and no new plan is stored", async () => {
    const store = setup();
    const reportId = await store.reports.create("local", reportOf());
    const first = (await call(store, { reportId })).body as { id: string };
    const second = await call(store, { reportId });
    assert.deepEqual(second, { status: 200, body: { id: first.id } });
    assert.equal(store.plans.rows.size, 1);
  });

  test("two requests at once for the same report: one plan in the store, and both answer with its id", async () => {
    const store = setup();
    const reportId = await store.reports.create("local", reportOf());
    const responses = await Promise.all([call(store, { reportId }), call(store, { reportId }), call(store, { reportId })]);
    assert.equal(store.plans.rows.size, 1, "the losers removed their own plans");
    const ids = new Set(responses.map((response) => (response.body as { id: string }).id));
    assert.equal(ids.size, 1);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 201]);
    assert.equal((await store.reports.get(reportId, "local"))?.planId, [...ids][0]);
  });

  test("no database: 503 as the other plan routes, whatever the body", async () => {
    const body = { status: 503, body: { error: "Plan storage is not configured", code: "storage_unavailable" } };
    assert.deepEqual(await call(undefined, { reportId: MISSING }), body);
    assert.deepEqual(await call({ plans: new InMemoryPlanRepository(), reports: undefined } as never, { reportId: MISSING }), body);
  });
});

describe("POST /api/plan: refusals, each with its exact body", () => {
  test("a body that is not JSON, or has keys it does not take, is 400 invalid_body", async () => {
    const store = setup();
    const reportId = await store.reports.create("local", reportOf());
    const invalid = { status: 400, body: { error: "Invalid request body", code: "invalid_body" } };
    assert.deepEqual(await call(store, "not json"), invalid);
    assert.deepEqual(await call(store, { reportId, extra: true }), invalid);
    assert.deepEqual(await call(store, {}), invalid);
    assert.equal(store.plans.rows.size, 0);
  });

  test("a reportId that is not a UUID is 400 invalid_body", async () => {
    const store = setup();
    for (const reportId of ["abc", 42, null, "00000000-0000-4000-8000-00000000000Z", ""]) {
      assert.deepEqual(await call(store, { reportId }), { status: 400, body: { error: "Invalid request body", code: "invalid_body" } }, String(reportId));
    }
  });

  test("a report that does not exist is 404 report_not_found", async () => {
    const store = setup();
    assert.deepEqual(await call(store, { reportId: MISSING }), { status: 404, body: { error: "Report not found", code: "report_not_found" } });
    assert.equal(store.plans.rows.size, 0);
  });

  test("another user's report is the same 404: nothing shows that it exists, and nothing is linked", async () => {
    const store = setup();
    const reportId = await store.reports.create("someone-else", reportOf());
    assert.deepEqual(await call(store, { reportId }), { status: 404, body: { error: "Report not found", code: "report_not_found" } });
    assert.equal(store.plans.rows.size, 0);
    assert.equal((await store.reports.get(reportId, "someone-else"))?.planId, null);
  });

  test("a report the rules cannot build is 500 skeleton_failed, with a fixed text", async () => {
    const store = setup();
    const report = reportOf();
    report.validation.departments = [{ name: "Department nobody knows", confidence: 50, tier: "core" }];
    const reportId = await store.reports.create("local", report);
    const response = await call(store, { reportId });
    assert.deepEqual(response, { status: 500, body: { error: "Could not build the plan", code: "skeleton_failed" } });
    assert.equal(store.plans.rows.size, 0);
    assert.equal((await store.reports.get(reportId, "local"))?.planId, null);
  });

  test("no error body carries the content of the report", async () => {
    const store = setup();
    const reportId = await store.reports.create("local", reportOf());
    const bodies = [
      await call(store, "not json"),
      await call(store, { reportId: MISSING }),
      await call(store, { reportId, [IDEA]: IDEA }),
      await call(undefined, { reportId }),
    ];
    for (const response of bodies) {
      assert.equal(JSON.stringify(response.body).includes("Sentinel bakery"), false);
    }
  });

  test("a storage failure in the middle is a generic 500 with no content, and the detail is only logged as a code", async () => {
    const store = setup();
    const reportId = await store.reports.create("local", reportOf());
    store.reports.attachPlan = async () => {
      throw Object.assign(new Error("connection to db failed: Sentinel bakery"), { code: "08006" });
    };
    const log = silenceConsoleError();
    const response = await call(store, { reportId });
    assert.deepEqual(response, { status: 500, body: { error: "Internal server error", code: "internal_error" } });
    assert.equal(JSON.stringify(log.mock.calls).includes("Sentinel bakery"), false);
  });
});
