/**
 * The problems of what the plan grows with: facts, the references to them (derivedFrom), the gaps
 * (placeholders) and the proposals. Pure, and it does not import checkPlan (plan-check.ts calls it),
 * so the proposals can be checked before they are accepted without a loop of imports.
 */

import type { PlanProblem } from "./plan-check.js";
import { factKeyId, isAllowedFact, isFactKeyId } from "./fact-catalog.js";
import type { Plan } from "./plan-model.js";

export function factProblems(plan: Plan): PlanProblem[] {
  const facts = plan.facts ?? [];
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const stepIds = new Set(plan.steps.map((step) => step.id));
  const problems: PlanProblem[] = [];

  facts.forEach((fact, index) => {
    if (fact.key.kind === "catalog" && !isFactKeyId(fact.key.id)) {
      problems.push({ code: "fact_unknown_key", level: "fact", index, ids: [fact.id] });
    } else if (!isAllowedFact(fact.key, fact.value)) {
      problems.push({ code: "fact_value_not_allowed", level: "fact", index, ids: [fact.id] });
    }
    if (fact.from.kind === "step" && !stepIds.has(fact.from.stepId)) {
      problems.push({ code: "fact_unknown_step", level: "fact", index, ids: [fact.id, fact.from.stepId] });
    }
    if (fact.status === "superseded") {
      const successor = byId.get(fact.supersededBy ?? "");
      if (!successor || factKeyId(successor.key) !== factKeyId(fact.key)) {
        problems.push({ code: "fact_superseded_by_broken", level: "fact", index, ids: [fact.id, fact.supersededBy ?? ""] });
      }
    }
  });

  // One confirmed fact per key: the second one is the problem
  const confirmed = new Set<string>();
  facts.forEach((fact, index) => {
    if (fact.status !== "confirmed") return;
    const key = factKeyId(fact.key);
    if (confirmed.has(key)) problems.push({ code: "fact_duplicate_confirmed", level: "fact", index, ids: [fact.id] });
    confirmed.add(key);
  });
  return problems;
}

/** derivedFrom must name facts that exist; a gap has no steps and waits only for catalog keys */
export function derivationProblems(plan: Plan): PlanProblem[] {
  const facts = new Set((plan.facts ?? []).map((fact) => fact.id));
  const problems: PlanProblem[] = [];
  const check = (owner: { id: string; derivedFrom?: string[] }) => {
    for (const factId of owner.derivedFrom ?? []) {
      if (!facts.has(factId)) problems.push({ code: "derived_from_unknown_fact", level: "fact", ids: [owner.id, factId] });
    }
  };
  plan.tasks.forEach((task, index) => {
    check(task);
    if (task.placeholder === undefined) return;
    if (plan.steps.some((step) => step.taskId === task.id)) {
      problems.push({ code: "placeholder_has_steps", level: "task", index, ids: [task.id] });
    }
    for (const key of task.placeholder.waitsFor) {
      if (!isFactKeyId(key)) problems.push({ code: "placeholder_unknown_key", level: "task", index, ids: [task.id, key] });
    }
  });
  plan.steps.forEach((step) => check(step));
  return problems;
}

/** Proposals: a reason that exists, a gap that is still a gap, the time of the decision, and no pending ids in the plan */
export function proposalProblems(plan: Plan): PlanProblem[] {
  const facts = new Set((plan.facts ?? []).map((fact) => fact.id));
  const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
  const taskIds = new Set(tasks.keys());
  const stepIds = new Set(plan.steps.map((step) => step.id));
  const problems: PlanProblem[] = [];

  (plan.proposals ?? []).forEach((proposal, index) => {
    const reasonKnown = "factId" in proposal.reason ? facts.has(proposal.reason.factId) : taskIds.has(proposal.reason.taskId);
    if (!reasonKnown) problems.push({ code: "proposal_reason_unknown", level: "proposal", index, ids: [proposal.id] });

    // A pending proposal resolves a gap that is still open; a decided one names a task that exists (its gap may be closed)
    if (proposal.resolves !== undefined) {
      const target = tasks.get(proposal.resolves);
      const ok = proposal.status === "pending" ? target?.placeholder !== undefined : target !== undefined;
      if (!ok) problems.push({ code: "proposal_resolves_unknown_task", level: "proposal", index, ids: [proposal.id, proposal.resolves] });
    }

    if (proposal.status === "pending") {
      if (proposal.decidedAt !== undefined) problems.push({ code: "proposal_pending_has_time", level: "proposal", index, ids: [proposal.id] });
      const clash = [...proposal.add.tasks.map((task) => task.id), ...proposal.add.steps.map((step) => step.id)].some(
        (id) => taskIds.has(id) || stepIds.has(id),
      );
      if (clash) problems.push({ code: "proposal_pending_ids_exist", level: "proposal", index, ids: [proposal.id] });
    } else if (proposal.decidedAt === undefined) {
      problems.push({ code: "proposal_decided_without_time", level: "proposal", index, ids: [proposal.id] });
    }
  });
  return problems;
}

export function growthProblems(plan: Plan): PlanProblem[] {
  return [...factProblems(plan), ...derivationProblems(plan), ...proposalProblems(plan)];
}
