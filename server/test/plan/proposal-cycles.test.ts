import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan } from "../../plan/plan-check.js";
import { confirmFact, proposeFact } from "../../plan/fact-actions.js";
import { applyProposalAction, createProposal, EXPANSION_ID_ATTEMPTS, isObsolete, proposeExpansion, unconfirmedSources } from "../../plan/proposals.js";
import { derivePlan } from "../../plan/plan-derived.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import type { Plan, Proposal } from "../../plan/plan-model.js";
import { reportWith } from "./report-fixtures.js";

const NOW = "2026-10-08T10:00:00Z";
const GAP = "plan-product-development";
const opts = { now: () => NOW, actor: "user" as const };
const catalog = (id: string) => ({ kind: "catalog" as const, id });

/** The rules' plan with its product type confirmed */
function planWith(value: string): Plan {
  const built = buildPlanSkeleton(reportWith());
  if (!built.ok) throw new Error("no plan");
  const proposed = proposeFact(built.plan, { key: catalog("product_type"), value: catalog(value) }, opts);
  if (!proposed.ok) throw new Error("fact");
  const confirmed = confirmFact(proposed.plan, proposed.fact.id, opts);
  if (!confirmed.ok) throw new Error("confirm");
  return confirmed.plan;
}

/** The plan after a decision, or a failure of the test itself */
function decided(result: ReturnType<typeof applyProposalAction>): Plan {
  if (!result.ok) throw new Error(result.code);
  return result.plan;
}

/** Suggests for the gap, and returns the plan with the new proposal and the proposal itself */
function suggest(plan: Plan): { plan: Plan; proposal: Proposal } {
  const expansion = proposeExpansion(plan, GAP);
  if (!expansion.ok) throw new Error(`expansion: ${expansion.code}`);
  const created = createProposal(plan, expansion.proposal, { now: () => NOW });
  if (!created.ok) throw new Error(`proposal: ${created.code}`);
  return { plan: created.plan, proposal: created.proposal };
}

const idsOf = (plan: Plan) => [...plan.tasks.map((t) => t.id), ...plan.steps.map((s) => s.id), ...(plan.proposals ?? []).map((p) => p.id)];

describe("a rejected suggestion can be asked again with the same value", () => {
  test("four cycles of suggest and reject: -1 is the plain id, then -2, -3 and -4; every plan stays valid", () => {
    let plan = planWith("mobile_game");
    const ids: string[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      const made = suggest(plan);
      ids.push(made.proposal.id);
      plan = decided(applyProposalAction(made.plan, made.proposal.id, "reject", opts));
      assert.deepEqual(checkPlan(plan), [], `cycle ${cycle + 1}`);
    }
    assert.deepEqual(ids, [
      `expand-mobile-game-${GAP}`,
      `expand-mobile-game-2-${GAP}`,
      `expand-mobile-game-3-${GAP}`,
      `expand-mobile-game-4-${GAP}`,
    ]);
    assert.equal(plan.proposals?.filter((p) => p.status === "rejected").length, 4, "the rejected ones stay as history");
  });

  test("a new suggestion never repeats an id of a proposal, a task or a step", () => {
    let plan = planWith("mobile_game");
    for (let cycle = 0; cycle < 3; cycle++) {
      const made = suggest(plan);
      plan = decided(applyProposalAction(made.plan, made.proposal.id, "reject", opts));
    }
    const ids = idsOf(plan);
    assert.equal(new Set(ids).size, ids.length, "no id is used twice");
  });

  test("an id that a task already has is skipped: the next free one is used, and its tasks get the same suffix", () => {
    const plan = planWith("mobile_game");
    const squatter = { ...plan, tasks: [...plan.tasks, { id: "expand-mobile-game-design", phaseId: "prepare", primaryDepartmentId: "product", title: "Taken", origin: { kind: "rule" as const }, confidence: 100 }] };
    const expansion = proposeExpansion(squatter, GAP);
    assert.ok(expansion.ok);
    assert.equal(expansion.ok && expansion.proposal.id, `expand-mobile-game-2-${GAP}`);
    assert.equal(expansion.ok && expansion.proposal.add.tasks[0].id, "expand-mobile-game-2-design");
  });

  test("the attempts are capped: when every candidate is taken the answer is id_taken", () => {
    const plan = planWith("mobile_game");
    const fake = (n: number) => ({
      id: n === 1 ? `expand-mobile-game-${GAP}` : `expand-mobile-game-${n}-${GAP}`,
      status: "rejected" as const,
      reason: { taskId: GAP },
      resolves: GAP,
      add: { tasks: [], steps: [], relations: [] },
      createdAt: NOW,
      decidedAt: NOW,
    });
    const all = (count: number) => ({ ...plan, proposals: Array.from({ length: count }, (_, index) => fake(index + 1)) }) as Plan;
    // One candidate per attempt: with all but the last one taken, the last attempt is still free
    const last = proposeExpansion(all(EXPANSION_ID_ATTEMPTS - 1), GAP);
    assert.ok(last.ok);
    assert.equal(last.ok && last.proposal.id, `expand-mobile-game-${EXPANSION_ID_ATTEMPTS}-${GAP}`);
    assert.deepEqual(proposeExpansion(all(EXPANSION_ID_ATTEMPTS), GAP), { ok: false, code: "id_taken" });
  });
});

describe("a pending suggestion is obsolete when a fact it comes from is no longer confirmed", () => {
  test("confirmed fact: pending, not obsolete", () => {
    const { plan, proposal } = suggest(planWith("mobile_game"));
    assert.equal(isObsolete(plan, proposal), false);
    assert.equal(derivePlan(plan).proposals[proposal.id].obsolete, false);
    assert.deepEqual(unconfirmedSources(plan, proposal.add), []);
  });

  test("the fact is replaced by another value: obsolete in derived, and accepting is refused", () => {
    const { plan: withProposal, proposal } = suggest(planWith("mobile_game"));
    const changed = proposeFact(withProposal, { key: catalog("product_type"), value: catalog("web_app") }, opts);
    if (!changed.ok) throw new Error("fact");
    const replaced = confirmFact(changed.plan, changed.fact.id, opts);
    if (!replaced.ok) throw new Error("confirm");
    assert.equal(derivePlan(replaced.plan).proposals[proposal.id].obsolete, true);
    assert.equal(isObsolete(replaced.plan, replaced.plan.proposals![0]), true);
    assert.deepEqual(applyProposalAction(replaced.plan, proposal.id, "accept", opts), { ok: false, code: "not_confirmed" });
  });

  test("a decided proposal is never obsolete, even if its fact was replaced", () => {
    const { plan: withProposal, proposal } = suggest(planWith("mobile_game"));
    const accepted = decided(applyProposalAction(withProposal, proposal.id, "accept", opts));
    const changed = proposeFact(accepted, { key: catalog("product_type"), value: catalog("web_app") }, opts);
    if (!changed.ok) throw new Error("fact");
    const replaced = confirmFact(changed.plan, changed.fact.id, opts);
    if (!replaced.ok) throw new Error("confirm");
    assert.equal(isObsolete(replaced.plan, replaced.plan.proposals![0]), false);
    assert.equal(derivePlan(replaced.plan).proposals[proposal.id], undefined, "decided ones are not listed as pending");
  });

  test("a rejected proposal is never obsolete", () => {
    const { plan: withProposal, proposal } = suggest(planWith("mobile_game"));
    const rejected = decided(applyProposalAction(withProposal, proposal.id, "reject", opts));
    assert.equal(isObsolete(rejected, rejected.proposals![0]), false);
  });

  test("the shared test gives the same answer in derived and in the acceptance, in every case above", () => {
    const { plan, proposal } = suggest(planWith("mobile_game"));
    const changed = proposeFact(plan, { key: catalog("product_type"), value: catalog("web_app") }, opts);
    if (!changed.ok) throw new Error("fact");
    const replaced = confirmFact(changed.plan, changed.fact.id, opts);
    if (!replaced.ok) throw new Error("confirm");
    for (const candidate of [plan, replaced.plan]) {
      const obsolete = derivePlan(candidate).proposals[proposal.id].obsolete;
      const accepted = applyProposalAction(candidate, proposal.id, "accept", opts);
      assert.equal(obsolete, !accepted.ok && accepted.code === "not_confirmed");
    }
  });
});
