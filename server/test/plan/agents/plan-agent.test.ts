import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyPlanGenerate, runPlanGenerate, runPlanReview, reviewReferencesValid, PlanGenerateSchema, PlanReviewSchema, adjustmentRelations } from "../../../plan/agents/plan-agent.js";
import { contextOf, MAX_AGENT_ATTEMPTS } from "../../../plan/agents/contract.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import { FakeJudge, FakeModel, planWithFact } from "./fakes.js";

const base = restaurantPlan();
const context = contextOf("A Japanese restaurant with delivery", base);
const firstDept = base.departments[0];
const secondDept = base.departments[1];

/** A valid generate answer: the current phases and tiers, plus one department relation */
const validGenerate = () => ({
  phases: base.phases,
  tiers: [{ departmentId: firstDept.id, tier: "core" }],
  relations: [{ level: "department", from: firstDept.id, to: secondDept.id, type: "blocks", aspect: { kind: "other", note: "needs the licence first" } }],
  facts: [],
  requests: [],
  questions: [],
});

describe("the plan level: generate", () => {
  test("a valid answer is accepted and it says whether Jev judged it", async () => {
    const model = new FakeModel([validGenerate()]);
    const judge = new FakeJudge([true]);
    const result = await runPlanGenerate({ model, judge, attempts: 1 }, context, base);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value.checked, true);
    assert.equal(judge.calls, 1);
  });

  test("with no judge the answer is accepted, marked as not checked", async () => {
    const result = await runPlanGenerate({ model: new FakeModel([validGenerate()]), judge: null }, context, base);
    assert.equal(result.ok && result.value.checked, false);
  });

  test("a shape that does not fit is invalid_output, and it is tried the full policy number of times", async () => {
    const model = new FakeModel([{ phases: [], tiers: [], relations: [] }]);
    const result = await runPlanGenerate({ model, judge: null }, context, base);
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
  });

  test("a model failure is agent_failed, after the attempts", async () => {
    const model = new FakeModel([new Error("provider down")]);
    const result = await runPlanGenerate({ model, judge: null }, context, base);
    assert.deepEqual(result, { ok: false, code: "agent_failed" });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
  });

  test("removing a phase that tasks sit in breaks the plan: invalid_result, nothing returned", async () => {
    const answer = { ...validGenerate(), phases: base.phases.slice(1) };
    const result = await runPlanGenerate({ model: new FakeModel([answer]), judge: null, attempts: 1 }, context, base);
    assert.deepEqual(result, { ok: false, code: "invalid_result" });
  });

  test("a tier for a department that does not exist is invalid_result", async () => {
    const answer = { ...validGenerate(), tiers: [{ departmentId: "no-such-dept", tier: "core" }] };
    assert.deepEqual(await runPlanGenerate({ model: new FakeModel([answer]), judge: null, attempts: 1 }, context, base), { ok: false, code: "invalid_result" });
  });

  test("a relation that is not a department relation is invalid_result", async () => {
    const answer = { ...validGenerate(), relations: [{ level: "task", from: "a", to: "b", type: "blocks" }] };
    assert.deepEqual(await runPlanGenerate({ model: new FakeModel([answer]), judge: null, attempts: 1 }, context, base), { ok: false, code: "invalid_result" });
  });

  test("a judge that says no is not_relevant after the attempts; one that is down is relevance_unavailable", async () => {
    const no = await runPlanGenerate({ model: new FakeModel([validGenerate()]), judge: new FakeJudge([false]) }, context, base);
    assert.deepEqual(no, { ok: false, code: "not_relevant" });
    const down = await runPlanGenerate({ model: new FakeModel([validGenerate()]), judge: new FakeJudge([new Error("Jev down")]) }, context, base);
    assert.deepEqual(down, { ok: false, code: "relevance_unavailable" });
  });

  test("a failed attempt followed by a good one succeeds: the retry is used", async () => {
    const model = new FakeModel([{ phases: [] }, validGenerate()]);
    const result = await runPlanGenerate({ model, judge: null }, context, base);
    assert.equal(result.ok, true);
    assert.equal(model.requests.length, 2);
  });

  test("applying an answer changes the departments and the phases of a copy only; the base is untouched", () => {
    const before = JSON.stringify(base);
    const applied = applyPlanGenerate(base, PlanGenerateSchema.parse(validGenerate()));
    assert.ok(applied);
    assert.equal(applied.departments.find((d) => d.id === firstDept.id)?.tier, "core");
    assert.equal(JSON.stringify(base), before);
  });

  test("the prompt carries the idea between tags and only confirmed facts", () => {
    const { plan } = planWithFact();
    const model = new FakeModel([validGenerate()]);
    return runPlanGenerate({ model, judge: null, attempts: 1 }, contextOf("Idea text", plan), plan).then(() => {
      const user = model.requests[0].user;
      assert.match(user, /<idea>\nIdea text\n<\/idea>/);
      assert.match(user, /<confirmed_facts>/);
      assert.equal(model.requests[0].role, "plan_generate");
    });
  });
});

describe("the plan level: review", () => {
  const proposed = [
    { id: "legal-a", title: "Draft terms", departmentId: firstDept.id, phaseId: base.phases[0].id },
    { id: "legal-b", title: "Publish terms", departmentId: firstDept.id, phaseId: base.phases[0].id },
  ];
  const review = {
    findings: [{ kind: "missing_order", taskIds: ["legal-a", "legal-b"], text: "Publish needs the draft first" }],
    adjustments: [{ from: "legal-a", to: "legal-b", type: "blocks" }],
    facts: [],
    requests: [],
    questions: [],
  };

  test("a review of two proposed tasks is accepted; its adjustments become task relations (proposal only)", async () => {
    const result = await runPlanReview({ model: new FakeModel([review]), judge: null, attempts: 1 }, { idea: "idea", proposed }, base);
    assert.equal(result.ok, true);
    if (result.ok) {
      const relations = adjustmentRelations(PlanReviewSchema.parse(review));
      assert.deepEqual(relations, [{ level: "task", from: "legal-a", to: "legal-b", type: "blocks" }]);
    }
  });

  test("a finding that names a task that does not exist is invalid_output", () => {
    const bad = PlanReviewSchema.parse({ ...review, findings: [{ kind: "clash", taskIds: ["ghost"], text: "x" }] });
    assert.equal(reviewReferencesValid(base, proposed, bad), false);
  });

  test("an adjustment that repeats a stored task relation, or joins a task to itself, is refused", () => {
    const self = PlanReviewSchema.parse({ ...review, adjustments: [{ from: "legal-a", to: "legal-a", type: "blocks" }] });
    assert.equal(reviewReferencesValid(base, proposed, self), false);
    const storedTasks = base.relations.filter((r) => r.level === "task");
    if (storedTasks.length > 0) {
      const repeat = PlanReviewSchema.parse({ ...review, adjustments: [{ from: storedTasks[0].from, to: storedTasks[0].to, type: storedTasks[0].type }] });
      assert.equal(reviewReferencesValid(base, proposed, repeat), false);
    }
  });

  test("a review never edits the plan: the input plan is the same afterwards", async () => {
    const before = JSON.stringify(base);
    await runPlanReview({ model: new FakeModel([review]), judge: null, attempts: 1 }, { idea: "idea", proposed }, base);
    assert.equal(JSON.stringify(base), before);
  });
});
