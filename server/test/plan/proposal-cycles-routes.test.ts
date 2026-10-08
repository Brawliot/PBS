import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { handlePlanRequest, type PlanResponse } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { checkPlan } from "../../plan/plan-check.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import type { Plan } from "../../plan/plan-model.js";
import { reportWith } from "./report-fixtures.js";

const NOW = "2026-10-08T10:00:00Z";
const GAP = "plan-product-development";
const PRODUCT = { kind: "catalog", id: "product_type" };

async function call(repo: InMemoryPlanRepository, path: string, body: unknown): Promise<PlanResponse> {
  return handlePlanRequest({ method: "POST", path, body: JSON.stringify(body), repo, reports: undefined, now: () => NOW, env: {} });
}

async function newPlan(repo: InMemoryPlanRepository): Promise<string> {
  const built = buildPlanSkeleton(reportWith());
  if (!built.ok) throw new Error("no plan");
  return (await repo.create("local", "Plan", built.plan)).id;
}

describe("the whole path through the API: a suggestion goes obsolete, is rejected, and is suggested again", () => {
  test("mobile game, then web app: the old suggestion is obsolete, refused with its text, rejected, and replaced", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await newPlan(repo);
    const base = `/api/plan/${id}`;

    // mobile_game confirmed, and suggested (version 1 -> 2 -> 3)
    assert.equal((await call(repo, `${base}/facts`, { key: PRODUCT, value: { kind: "catalog", id: "mobile_game" }, confirm: true, expectedVersion: 1 })).status, 201);
    const asked = await call(repo, `${base}/gaps/${GAP}/proposal`, { expectedVersion: 2 });
    assert.equal(asked.status, 201);
    const mobileProposal = (asked.body as { plan: Plan }).plan.proposals![0].id;
    assert.equal(mobileProposal, `expand-mobile-game-${GAP}`);

    // web_app confirmed: the mobile suggestion is now obsolete
    const changed = await call(repo, `${base}/facts`, { key: PRODUCT, value: { kind: "catalog", id: "web_app" }, confirm: true, expectedVersion: 3 });
    assert.equal((changed.body as { derived: { proposals: Record<string, { obsolete: boolean }> } }).derived.proposals[mobileProposal].obsolete, true);

    // Accepting it is refused, with the text of the cause
    assert.deepEqual(await call(repo, `${base}/proposals/${mobileProposal}/accept`, { expectedVersion: 4 }), {
      status: 409,
      body: { error: "The decision behind this suggestion is no longer confirmed", code: "not_confirmed" },
    });

    // Rejected, and the gap asks again with the current value
    assert.equal((await call(repo, `${base}/proposals/${mobileProposal}/reject`, { expectedVersion: 4 })).status, 200);
    const again = await call(repo, `${base}/gaps/${GAP}/proposal`, { expectedVersion: 5 });
    assert.equal(again.status, 201);
    const webProposal = (again.body as { plan: Plan }).plan.proposals!.at(-1)!.id;
    assert.equal(webProposal, `expand-web-app-${GAP}`, "a different value takes the plain id");

    // Accepted: the tasks come from the web app fact, and the plan is valid
    const accepted = await call(repo, `${base}/proposals/${webProposal}/accept`, { expectedVersion: 6 });
    assert.equal(accepted.status, 200);
    const plan = (accepted.body as { plan: Plan }).plan;
    const webFact = plan.facts!.find((fact) => fact.status === "confirmed")!;
    assert.deepEqual(
      plan.tasks.filter((task) => task.derivedFrom).map((task) => [task.id, task.derivedFrom]),
      [
        ["expand-web-app-design", [webFact.id]],
        ["expand-web-app-build", [webFact.id]],
        ["expand-web-app-deploy", [webFact.id]],
      ],
    );
    assert.deepEqual(checkPlan(plan), []);
  });

  test("reject and suggest again with the same value, four times in a row: each id is new and the plan stays valid", async () => {
    const repo = new InMemoryPlanRepository();
    const id = await newPlan(repo);
    const base = `/api/plan/${id}`;
    let version = 1;
    assert.equal((await call(repo, `${base}/facts`, { key: PRODUCT, value: { kind: "catalog", id: "mobile_game" }, confirm: true, expectedVersion: version })).status, 201);
    version += 1;

    const ids: string[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      const asked = await call(repo, `${base}/gaps/${GAP}/proposal`, { expectedVersion: version });
      assert.equal(asked.status, 201, `suggest ${cycle + 1}`);
      version += 1;
      const plan = (asked.body as { plan: Plan }).plan;
      ids.push(plan.proposals!.at(-1)!.id);
      const rejected = await call(repo, `${base}/proposals/${ids[cycle]}/reject`, { expectedVersion: version });
      assert.equal(rejected.status, 200, `reject ${cycle + 1}`);
      version += 1;
      assert.deepEqual(checkPlan((rejected.body as { plan: Plan }).plan), []);
    }
    assert.deepEqual(ids, [
      `expand-mobile-game-${GAP}`,
      `expand-mobile-game-2-${GAP}`,
      `expand-mobile-game-3-${GAP}`,
      `expand-mobile-game-4-${GAP}`,
    ]);

    // The fourth one is accepted: the gap is resolved
    const asked = await call(repo, `${base}/gaps/${GAP}/proposal`, { expectedVersion: version });
    version += 1;
    const last = (asked.body as { plan: Plan }).plan.proposals!.at(-1)!.id;
    const accepted = await call(repo, `${base}/proposals/${last}/accept`, { expectedVersion: version });
    assert.equal(accepted.status, 200);
    assert.deepEqual(checkPlan((accepted.body as { plan: Plan }).plan), []);
  });
});
