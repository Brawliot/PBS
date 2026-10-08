/**
 * A plan made from a report is removed when it is not linked to that report: when linking fails with an error, and
 * when the report is no longer there. No plan is left in the store without its report.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { reportWith } from "./report-fixtures.js";
import { silenceConsoleError } from "../planner/helpers.js";
import "../planner/helpers.js";

const NOW = "2026-10-08T10:00:00Z";

async function setup() {
  const plans = new InMemoryPlanRepository();
  const reports = new InMemoryReportRepository();
  const reportId = await reports.create("local", reportWith());
  return { plans, reports, reportId };
}

function create(plans: InMemoryPlanRepository, reports: InMemoryReportRepository, reportId: string): Promise<PlanResponse> {
  return handlePlanRequest({
    method: "POST",
    path: "/api/plan",
    body: JSON.stringify({ reportId }),
    repo: plans,
    reports,
    now: () => NOW,
    env: {},
  });
}

describe("a plan that is not linked to its report is removed", () => {
  test("the plan is linked and kept when the link works (baseline)", async () => {
    const { plans, reports, reportId } = await setup();
    const response = await create(plans, reports, reportId);
    assert.equal(response.status, 201);
    assert.equal(plans.rows.size, 1);
  });

  test("when linking throws, the plan is removed and the error goes on (500, no plan left)", async () => {
    const { plans, reports, reportId } = await setup();
    reports.attachPlan = async () => {
      throw new Error("connection lost");
    };
    const log = silenceConsoleError();
    const response = await create(plans, reports, reportId);
    assert.deepEqual(response, { status: 500, body: { error: "Internal server error", code: "internal_error" } });
    assert.equal(plans.rows.size, 0, "no orphan plan");
    log.mock.restore();
  });

  test("when the report is gone at the link, the plan is removed and the answer is report_not_found", async () => {
    const { plans, reports, reportId } = await setup();
    reports.attachPlan = async () => ({ ok: false, code: "not_found" });
    const response = await create(plans, reports, reportId);
    assert.deepEqual(response, { status: 404, body: { error: "Report not found", code: "report_not_found" } });
    assert.equal(plans.rows.size, 0, "no orphan plan");
  });
});
