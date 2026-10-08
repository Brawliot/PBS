/**
 * The largest plan document that is stored: MAX_DOCUMENT_BYTES of JSON text. The plans below are built from the
 * perf generator and padded with text to the exact number of bytes, so the limit is tested at its edge.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DOCUMENT_BYTES, MAX_STEP_TEXT, parsePlan, type Plan } from "../../plan/plan-model.js";
import { PlanTooLargeError, preparePlan } from "../../plan/plan-repository.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { readiness } from "../../plan/step-graph.js";
import { handlePlanRequest } from "../../plan-routes.js";
import { BENCH_SIZES, syntheticPlan } from "../perf/generate.js";

const bytes = (plan: Plan) => Buffer.byteLength(JSON.stringify(plan));

/** A valid plan of exactly `target` bytes: the largest synthetic plan, with filler text added to its steps */
function plannedBytes(target: number): Plan {
  const plan = syntheticPlan(BENCH_SIZES.maximum);
  let deficit = target - bytes(plan);
  assert.ok(deficit >= 0, "the base plan is already larger than the target");
  for (const step of plan.steps) {
    if (deficit === 0) break;
    const add = Math.min(MAX_STEP_TEXT - step.text.length, deficit);
    (step as { text: string }).text += "x".repeat(add);
    deficit -= add;
  }
  assert.equal(deficit, 0, "not enough room in the steps for the filler");
  assert.equal(bytes(plan), target);
  return plan;
}

const EVENT = { at: "2026-10-08T10:00:00Z", actor: "user" as const, action: "launch" as const, from: "not_started" as const, to: "running" as const };

describe("the document size limit, at its edge", () => {
  test("the limit is 5 MiB of JSON", () => {
    assert.equal(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024);
  });

  test("a plan one byte under the limit is created", async () => {
    const stored = await new InMemoryPlanRepository().create("local", "Grande", plannedBytes(MAX_DOCUMENT_BYTES - 1));
    assert.equal(stored.version, 1);
  });

  test("a plan exactly at the limit is created", async () => {
    const stored = await new InMemoryPlanRepository().create("local", "Grande", plannedBytes(MAX_DOCUMENT_BYTES));
    assert.equal(stored.version, 1);
  });

  test("a plan one byte over the limit is refused by create, with its code, and nothing is stored", async () => {
    const repo = new InMemoryPlanRepository();
    await assert.rejects(repo.create("local", "Grande", plannedBytes(MAX_DOCUMENT_BYTES + 1)), (error: unknown) => {
      assert.ok(error instanceof PlanTooLargeError);
      assert.equal(error.code, "plan_too_large");
      return true;
    });
    assert.equal(repo.rows.size, 0);
  });

  test("preparePlan applies the same limit", () => {
    assert.doesNotThrow(() => preparePlan("Grande", plannedBytes(MAX_DOCUMENT_BYTES)));
    assert.throws(() => preparePlan("Grande", plannedBytes(MAX_DOCUMENT_BYTES + 1)), PlanTooLargeError);
  });

  test("an update one byte over the limit is refused: the version, the document and the rows do not change", async () => {
    const repo = new InMemoryPlanRepository();
    const created = await repo.create("local", "Grande", plannedBytes(MAX_DOCUMENT_BYTES - 1000));
    const before = repo.rows.get(created.id)!;
    const documentBefore = before.document;

    const refused = await repo.update(created.id, "local", 1, plannedBytes(MAX_DOCUMENT_BYTES + 1), [{ stepId: "x", event: EVENT }], []);
    assert.deepEqual(refused, { ok: false, code: "plan_too_large" });
    assert.equal(repo.rows.get(created.id)!.version, 1);
    assert.equal(repo.rows.get(created.id)!.document, documentBefore);
    assert.equal(repo.rows.get(created.id)!.events.length, 0);
  });

  test("an update exactly at the limit is accepted", async () => {
    const repo = new InMemoryPlanRepository();
    const created = await repo.create("local", "Grande", plannedBytes(MAX_DOCUMENT_BYTES - 1000));
    const saved = await repo.update(created.id, "local", 1, plannedBytes(MAX_DOCUMENT_BYTES), []);
    assert.equal(saved.ok, true);
  });

  test("an action that would take the plan over the limit answers 409 plan_too_large, and the plan is unchanged", async () => {
    const plan = plannedBytes(MAX_DOCUMENT_BYTES - 20);
    const step = plan.steps.find((candidate) => candidate.status === "not_started" && readiness(candidate, plan.steps, plan.relations) === "ready");
    assert.ok(step, "the synthetic plan has a ready step");
    const repo = new InMemoryPlanRepository();
    const stored = await repo.create("local", "Grande", plan);

    const response = await handlePlanRequest({
      method: "POST",
      path: `/api/plan/${stored.id}/steps/${step.id}/actions`,
      body: JSON.stringify({ action: "launch", expectedVersion: 1 }),
      repo,
      reports: undefined,
      now: () => "2026-10-08T10:00:00Z",
      env: {},
    });
    assert.deepEqual(response, { status: 409, body: { error: "This change would make the plan too large to store", code: "plan_too_large" } });
    const after = await repo.get(stored.id, "local");
    assert.equal(after?.version, 1);
    assert.equal(after?.plan.steps.find((candidate) => candidate.id === step.id)?.status, "not_started");
    assert.doesNotThrow(() => parsePlan(after?.plan));
  });
});
