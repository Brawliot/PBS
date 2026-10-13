/**
 * The project list: the summary of each plan (progress and status), the order, the owner's own plans only,
 * and the report route's not-found answer. The rules are the summary's; the routes are answered in memory.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { countSteps, summarizeProject } from "../../plan/project-summary.js";
import { handlePlanRequest } from "../../plan-routes.js";
import type { Plan } from "../../plan/plan-model.js";

const request = (repo: InMemoryPlanRepository, userId: string, path: string, reports = new InMemoryReportRepository()) =>
  handlePlanRequest({ method: "GET", path, userId, body: "", env: {}, repo, reports, now: () => new Date().toISOString() });

describe("project summary", () => {
  it("counts done steps against the steps that are not rejected", () => {
    const plan: Plan = restaurantPlan();
    const steps = plan.steps.map((step, index) => ({ ...step, status: index === 0 ? ("done" as const) : step.status }));
    const summary = summarizeProject({ id: "p", title: "t", updatedAt: "2026-10-13T00:00:00.000Z", counts: countSteps({ ...plan, steps }) });
    const rejected = steps.filter((step) => step.status === "rejected").length;
    assert.equal(summary.total, steps.length - rejected);
    assert.equal(summary.done, 1);
    assert.equal(summary.status, "in_progress");
  });

  it("a plan with no step started is not started", () => {
    const plan: Plan = restaurantPlan();
    const steps = plan.steps.map((step) => ({ ...step, status: "not_started" as const }));
    const summary = summarizeProject({ id: "p", title: "t", updatedAt: "x", counts: countSteps({ ...plan, steps }) });
    assert.equal(summary.status, "not_started");
    assert.equal(summary.percent, 0);
  });

  it("a rejected step that was started is neither counted as started nor as done", () => {
    const plan: Plan = restaurantPlan();
    const steps = plan.steps.map((step, index) => ({ ...step, status: index === 0 ? ("rejected" as const) : ("not_started" as const) }));
    assert.deepEqual(countSteps({ ...plan, steps }), { total: steps.length - 1, done: 0, started: 0 });
  });
});

describe("GET /api/projects", () => {
  it("lists only the user's plans, latest change first, as summaries without the document", async () => {
    const repo = new InMemoryPlanRepository();
    const older = await repo.create("ana", "Older", restaurantPlan());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await repo.create("ana", "Newer", restaurantPlan());
    await repo.create("ben", "Not Ana's", restaurantPlan());

    const response = await request(repo, "ana", "/api/projects");
    assert.equal(response.status, 200);
    const body = response.body as { projects: Array<Record<string, unknown>> };
    assert.deepEqual(body.projects.map((project) => project.id), [newer.id, older.id]);
    assert.deepEqual(Object.keys(body.projects[0]).sort(), ["done", "id", "percent", "status", "title", "total", "updatedAt"]);
  });

  it("an empty list is an empty answer, not an error", async () => {
    const response = await request(new InMemoryPlanRepository(), "ana", "/api/projects");
    assert.deepEqual(response.body, { projects: [] });
  });
});

describe("GET /api/reports/:id", () => {
  it("a report that does not exist, or is not a UUID, is not found", async () => {
    const repo = new InMemoryPlanRepository();
    const missing = await request(repo, "ana", "/api/reports/11111111-1111-4111-8111-111111111111");
    const malformed = await request(repo, "ana", "/api/reports/not-an-id");
    assert.equal(missing.status, 404);
    assert.equal(malformed.status, 404);
    assert.deepEqual(missing.body, malformed.body);
  });
});
