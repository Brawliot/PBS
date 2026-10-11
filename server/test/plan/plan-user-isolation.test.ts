/**
 * Two users, one plan: every family of plan routes answers 404 to the other user, and the plan of its owner
 * does not change. The owner's own requests are checked too, so the 404s are not a broken route.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import type { PlanRepository, StoredPlan } from "../../plan/plan-repository.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import type { ReportRepository } from "../../plan/report-repository.js";
import type { AgentDeps } from "../../plan/agents/contract.js";
import { OTHER_USER, USER } from "../user-ids.js";
import { reportWith } from "./report-fixtures.js";
import { NOW } from "./agents/fakes.js";
import { randomUUID } from "node:crypto";

interface Store {
  plans: PlanRepository;
  reports: ReportRepository;
}

/** The assistant must never be called for the other user: a call would be a leak, so it throws */
const agents: AgentDeps = {
  model: {
    complete: async () => {
      throw new Error("the assistant must not run for another user");
    },
  },
  judge: null,
};

function call(store: Store, userId: string, method: string, path: string, body?: unknown): Promise<PlanResponse> {
  const request: PlanRequest = {
    userId,
    method,
    path,
    body: body === undefined ? "" : JSON.stringify(body),
    repo: store.plans,
    reports: store.reports,
    agents,
    agentTimeoutMs: 1000,
    now: () => NOW,
    env: {},
  };
  return handlePlanRequest(request);
}

/** The plan of USER, made from USER's report through the real route */
async function ownedPlan(store: Store): Promise<string> {
  const reportId = await store.reports.create(USER, reportWith());
  const created = await call(store, USER, "POST", "/api/plan", { reportId });
  assert.equal(created.status, 201);
  return (created.body as { id: string }).id;
}

/** The request of each family of routes, as the owner would make it */
const FAMILIES: { family: string; method: string; path: (id: string) => string; body?: unknown }[] = [
  { family: "read a plan", method: "GET", path: (id) => `/api/plan/${id}` },
  {
    family: "add a fact",
    method: "POST",
    path: (id) => `/api/plan/${id}/facts`,
    body: { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" }, confirm: true, expectedVersion: 1 },
  },
  { family: "confirm or reject a fact", method: "POST", path: (id) => `/api/plan/${id}/facts/fact-product_type/confirm`, body: { expectedVersion: 1 } },
  { family: "ask for a proposal for a task", method: "POST", path: (id) => `/api/plan/${id}/gaps/plan-product-development/proposal`, body: { expectedVersion: 1 } },
  { family: "accept or reject a proposal", method: "POST", path: (id) => `/api/plan/${id}/proposals/prop-1/accept`, body: { expectedVersion: 1 } },
  { family: "ask the assistant for a structure", method: "POST", path: (id) => `/api/plan/${id}/agents/structure`, body: { expectedVersion: 1 } },
  { family: "ask the assistant for departments", method: "POST", path: (id) => `/api/plan/${id}/agents/departments`, body: { expectedVersion: 1 } },
  { family: "ask the assistant for a task's steps", method: "POST", path: (id) => `/api/plan/${id}/agents/tasks/t-opening/steps`, body: { expectedVersion: 1 } },
  { family: "run an AI step", method: "POST", path: (id) => `/api/plan/${id}/agents/steps/s-viability/run`, body: { action: "launch", expectedVersion: 1 } },
  { family: "act on a step", method: "POST", path: (id) => `/api/plan/${id}/steps/s-viability/actions`, body: { action: "launch", expectedVersion: 1 } },
];

describe("two users: the routes of a plan answer 404 to anyone but its owner", () => {
  for (const { family, method, path, body } of FAMILIES) {
    test(`${family}: the other user gets 404, the same answer as for a plan that does not exist, and the owner's plan does not change`, async () => {
      const store: Store = { plans: new InMemoryPlanRepository(), reports: new InMemoryReportRepository() };
      const id = await ownedPlan(store);
      const before: StoredPlan | undefined = await store.plans.get(id, USER);

      const other = await call(store, OTHER_USER, method, path(id), body);
      const missing = await call(store, OTHER_USER, method, path(randomUUID()), body);
      assert.equal(other.status, 404);
      // The other user cannot tell a plan of someone else from a plan that does not exist
      assert.deepEqual(other, missing);
      assert.deepEqual(await store.plans.get(id, USER), before);
    });

    test(`${family}: the owner is not refused`, async () => {
      const store: Store = { plans: new InMemoryPlanRepository(), reports: new InMemoryReportRepository() };
      const id = await ownedPlan(store);
      const mine = await call(store, USER, method, path(id), body);
      // Some steps do not exist in a new plan, so a 404 can be right: it must not be the plan's own "not found"
      assert.notEqual((mine.body as { code?: string }).code, "not_found", JSON.stringify(mine.body));
    });
  }

  test("a plan made from another user's report is not made: the report is not found", async () => {
    const store: Store = { plans: new InMemoryPlanRepository(), reports: new InMemoryReportRepository() };
    const reportId = await store.reports.create(USER, reportWith());
    const response = await call(store, OTHER_USER, "POST", "/api/plan", { reportId });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Report not found", code: "report_not_found" });
    // The report stays free: its owner can still make the plan
    assert.equal((await call(store, USER, "POST", "/api/plan", { reportId })).status, 201);
  });
});
