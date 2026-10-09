import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PlanSchema, StructureSchema, parsePlan, type Plan, type Structure } from "../../plan/plan-model.js";
import { applyProposalAction } from "../../plan/proposals.js";
import { createStructureProposal, hasPendingStructure } from "../../plan/plan-structure.js";
import { confirmFact, proposeFact } from "../../plan/fact-actions.js";
import { derivePlan } from "../../plan/plan-derived.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { now, NOW } from "./agents/fakes.js";

/** A structure the restaurant plan accepts: its own phases, finance becomes core, and one department relation */
function validStructure(plan: Plan = restaurantPlan()): Structure {
  return {
    phases: plan.phases,
    tiers: [{ departmentId: "finance", tier: "core" }],
    relations: [{ level: "department", from: "finance", to: "legal", type: "follows", aspect: { kind: "catalog", id: "budget" } }],
    requests: ["Plan: Confirm the opening date"],
    questions: ["Do you want delivery?"],
  };
}

const tierOf = (plan: Plan, id: string) => plan.departments.find((department) => department.id === id)?.tier;

describe("the structure in the plan model", () => {
  test("a valid structure is accepted", () => {
    assert.equal(StructureSchema.safeParse(validStructure()).success, true);
  });

  test("an extra field, a long list or an unsafe id is refused", () => {
    const valid = validStructure();
    assert.equal(StructureSchema.safeParse({ ...valid, extra: 1 }).success, false);
    assert.equal(StructureSchema.safeParse({ ...valid, questions: Array.from({ length: 6 }, () => "Why?") }).success, false);
    assert.equal(StructureSchema.safeParse({ ...valid, requests: Array.from({ length: 6 }, () => "Ask") }).success, false);
    assert.equal(StructureSchema.safeParse({ ...valid, tiers: [{ departmentId: "Bad Id", tier: "core" }] }).success, false);
    assert.equal(StructureSchema.safeParse({ ...valid, phases: [] }).success, false);
  });

  test("a structure relation must be a department one", () => {
    const valid = validStructure();
    const phaseRelation = { level: "phase", from: "f2", to: "f1", type: "follows" };
    assert.equal(StructureSchema.safeParse({ ...valid, relations: [phaseRelation] }).success, false);
  });

  test("a proposal of the plan scope needs its structure, and a structure needs the scope with nothing added", () => {
    const plan = restaurantPlan();
    const proposal = { id: "plan-structure", status: "pending", reason: { scope: "plan" }, add: { tasks: [], steps: [], relations: [] }, structure: validStructure(plan), createdAt: NOW };
    assert.equal(PlanSchema.safeParse({ ...plan, proposals: [proposal] }).success, true);
    assert.equal(PlanSchema.safeParse({ ...plan, proposals: [{ ...proposal, structure: undefined }] }).success, false, "scope without structure");
    assert.equal(PlanSchema.safeParse({ ...plan, proposals: [{ ...proposal, reason: { taskId: "t-menu" } }] }).success, false, "structure with a task reason");
    assert.equal(PlanSchema.safeParse({ ...plan, proposals: [{ ...proposal, resolves: "t-menu" }] }).success, false, "structure that resolves a gap");
    const withTask = { ...proposal, add: { ...proposal.add, relations: [{ level: "task", from: "t-menu", to: "t-permits", type: "blocks" }] } };
    assert.equal(PlanSchema.safeParse({ ...plan, proposals: [withTask] }).success, false, "structure that adds a relation");
  });

  test("a plan stored before the structure existed still reads", () => {
    assert.doesNotThrow(() => parsePlan(restaurantPlan()));
  });
});

describe("creating a structure proposal", () => {
  test("a pending proposal of the plan scope, the plan itself untouched", () => {
    const plan = restaurantPlan();
    const made = createStructureProposal(plan, validStructure(plan), { now });
    assert.equal(made.ok, true);
    if (!made.ok) return;
    assert.equal(made.proposal.status, "pending");
    assert.deepEqual(made.proposal.reason, { scope: "plan" });
    assert.deepEqual(made.proposal.add, { tasks: [], steps: [], relations: [] });
    assert.equal(hasPendingStructure(made.plan), true);
    assert.equal(hasPendingStructure(plan), false);
    assert.equal(plan.proposals, undefined, "the base plan is not changed");
  });

  test("a second structure while one waits is refused: duplicate_pending", () => {
    const plan = restaurantPlan();
    const first = createStructureProposal(plan, validStructure(plan), { now });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(createStructureProposal(first.plan, validStructure(plan), { now }), { ok: false, code: "duplicate_pending" });
  });

  test("a structure that would break the plan is refused: invalid_result", () => {
    const plan = restaurantPlan();
    const broken = { ...validStructure(plan), phases: plan.phases.slice(1) };
    assert.deepEqual(createStructureProposal(plan, broken, { now }), { ok: false, code: "invalid_result" });
  });

  test("a structure that names a department the plan does not have is refused: invalid_result", () => {
    const plan = restaurantPlan();
    const unknown = { ...validStructure(plan), tiers: [{ departmentId: "ghost", tier: "light" as const }] };
    assert.deepEqual(createStructureProposal(plan, unknown, { now }), { ok: false, code: "invalid_result" });
  });
});

describe("accepting and rejecting a structure", () => {
  test("accepting applies phases, tiers and relations, and marks the proposal accepted", () => {
    const plan = restaurantPlan();
    const structure = { ...validStructure(plan), phases: plan.phases.map((phase) => (phase.id === "f3" ? { ...phase, name: "Launch" } : phase)) };
    const made = createStructureProposal(plan, structure, { now });
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const accepted = applyProposalAction(made.plan, made.proposal.id, "accept", { now, actor: "user" });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.plan.phases.find((phase) => phase.id === "f3")?.name, "Launch");
    assert.equal(tierOf(accepted.plan, "finance"), "core");
    assert.equal(accepted.plan.relations.length, plan.relations.length + 1);
    assert.equal(accepted.proposal.status, "accepted");
    assert.ok(accepted.proposal.decidedAt);
  });

  test("rejecting keeps the plan as it was", () => {
    const plan = restaurantPlan();
    const made = createStructureProposal(plan, validStructure(plan), { now });
    if (!made.ok) assert.fail("the structure is valid");
    const rejected = applyProposalAction(made.plan, made.proposal.id, "reject", { now, actor: "user" });
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    assert.equal(rejected.proposal.status, "rejected");
    assert.deepEqual(rejected.plan.phases, plan.phases);
    assert.deepEqual(rejected.plan.departments, plan.departments);
    assert.deepEqual(rejected.plan.relations, plan.relations);
  });

  test("accepting after the plan changed so that the structure no longer fits fails and changes nothing", () => {
    const plan = restaurantPlan();
    const made = createStructureProposal(plan, validStructure(plan), { now });
    if (!made.ok) assert.fail("the structure is valid");
    // The department the structure names is gone from the plan
    const changed: Plan = { ...made.plan, departments: made.plan.departments.filter((department) => department.id !== "finance") };
    const before = structuredClone(changed);
    assert.deepEqual(applyProposalAction(changed, made.proposal.id, "accept", { now, actor: "user" }), { ok: false, code: "invalid_result" });
    assert.deepEqual(changed, before);
    assert.equal(changed.proposals?.[0].status, "pending");
  });

  test("the assistant cannot accept or reject a structure", () => {
    const plan = restaurantPlan();
    const made = createStructureProposal(plan, validStructure(plan), { now });
    if (!made.ok) assert.fail("the structure is valid");
    assert.deepEqual(applyProposalAction(made.plan, made.proposal.id, "accept", { now, actor: "ai" }), { ok: false, code: "wrong_actor" });
  });
});

describe("facts proposed by an agent of a level", () => {
  const launch = { key: { kind: "catalog" as const, id: "launch_channel" as const }, value: { kind: "other" as const, text: "Delivery app" } };

  test("the assistant proposes a fact from its level, with no step", () => {
    const made = proposeFact(restaurantPlan(), { ...launch, agentLevel: "plan" }, { now, actor: "ai" });
    assert.equal(made.ok, true);
    if (!made.ok) return;
    assert.equal(made.fact.status, "proposed");
    assert.deepEqual(made.fact.from, { kind: "agent", level: "plan" });
  });

  test("an agent fact with a step is refused, and so is a level given for the person", () => {
    const plan = restaurantPlan();
    assert.deepEqual(proposeFact(plan, { ...launch, agentLevel: "plan", stepId: "s-viability" }, { now, actor: "ai" }), { ok: false, code: "invalid_fact" });
    assert.deepEqual(proposeFact(plan, { ...launch, agentLevel: "plan" }, { now, actor: "user" }), { ok: false, code: "invalid_fact" });
  });

  test("only the person confirms an agent's fact", () => {
    const made = proposeFact(restaurantPlan(), { ...launch, agentLevel: "department" }, { now, actor: "ai" });
    if (!made.ok) assert.fail("the fact is valid");
    assert.deepEqual(confirmFact(made.plan, made.fact.id, { now, actor: "ai" }), { ok: false, code: "wrong_actor" });
    const confirmed = confirmFact(made.plan, made.fact.id, { now, actor: "user" });
    assert.equal(confirmed.ok, true);
  });
});

describe("the derived view of a structure", () => {
  test("a pending structure shows names, tier changes and relations as text", () => {
    const plan = restaurantPlan();
    const made = createStructureProposal(plan, validStructure(plan), { now });
    if (!made.ok) assert.fail("the structure is valid");
    const summary = derivePlan(made.plan).proposals[made.proposal.id];
    assert.deepEqual(summary.structure, {
      phases: ["Preparation", "Permits and premises", "Opening"],
      tiers: [{ department: "Finance", from: "important", to: "core" }],
      relations: [{ from: "Finance", to: "Legal & Compliance", type: "follows", aspect: "budget" }],
      requests: ["Plan: Confirm the opening date"],
      questions: ["Do you want delivery?"],
    });
    assert.equal(summary.tasks, 0);
  });

  test("a plan with no pending structure has no structure entry in its derived view", () => {
    const plan = restaurantPlan();
    const withoutStructure = derivePlan(plan);
    assert.deepEqual(Object.keys(withoutStructure.proposals), []);
    const made = createStructureProposal(plan, validStructure(plan), { now });
    if (!made.ok) assert.fail("the structure is valid");
    const accepted = applyProposalAction(made.plan, made.proposal.id, "accept", { now, actor: "user" });
    if (!accepted.ok) assert.fail("the structure is accepted");
    assert.deepEqual(Object.keys(derivePlan(accepted.plan).proposals), [], "a decided proposal is not listed as pending");
  });
});
