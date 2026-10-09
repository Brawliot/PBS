/**
 * The structure of the plan the plan level proposes: its phases, the tier of each department, and the relations
 * between departments. Pure, like proposals.ts: a plan goes in, a new plan comes out, and checkPlan decides
 * whether the result is valid. The same function applies the structure to a copy (when it is proposed, and when
 * the person accepts it), so the rule is written once.
 */

import { checkPlan } from "./plan-check.js";
import { newProblems } from "./plan-actions.js";
import { parsePlan, type Plan, type Proposal, type Structure } from "./plan-model.js";

/** The part of a structure that changes the plan. The requests and questions are text for the person only. */
export type PlanStructure = Pick<Structure, "phases" | "tiers" | "relations">;

/**
 * The structure applied to a copy of the base plan: its phases replace the old ones, the tiers change the
 * departments, and its relations are added to the plan's own. Undefined when a department is unknown or the
 * result does not parse; checkPlan decides the rest (see the callers).
 */
export function applyStructure(base: Plan, structure: PlanStructure): Plan | undefined {
  const known = new Set(base.departments.map((department) => department.id));
  if (structure.tiers.some((item) => !known.has(item.departmentId))) return undefined;
  const departments = base.departments.map((department) => ({
    ...department,
    tier: structure.tiers.find((item) => item.departmentId === department.id)?.tier ?? department.tier,
  }));
  try {
    return parsePlan({
      ...base,
      departments,
      phases: structure.phases,
      relations: [...base.relations, ...structure.relations],
    });
  } catch {
    return undefined;
  }
}

/** The plan as it is after the person accepts a structure proposal (the proposal is marked accepted). Undefined when it no longer fits. */
export function materializeStructure(plan: Plan, proposal: Proposal, at: string): Plan | undefined {
  if (proposal.structure === undefined) return undefined;
  const applied = applyStructure(plan, proposal.structure);
  if (!applied) return undefined;
  return {
    ...applied,
    proposals: (applied.proposals ?? []).map((item) => (item.id === proposal.id ? { ...item, status: "accepted", decidedAt: at } : item)),
  };
}

/** Whether the plan has a structure waiting for a decision: at most one at a time */
export function hasPendingStructure(plan: Plan): boolean {
  return (plan.proposals ?? []).some((item) => item.status === "pending" && item.structure !== undefined);
}

export const STRUCTURE_PROPOSAL_ERRORS = ["duplicate_pending", "invalid_proposal", "invalid_result"] as const;
export type StructureProposalError = (typeof STRUCTURE_PROPOSAL_ERRORS)[number];

export type StructureProposalResult = { ok: true; plan: Plan; proposal: Proposal } | { ok: false; code: StructureProposalError };

const STRUCTURE_ID = "plan-structure";

/**
 * A pending proposal of the structure. Refused when another structure is waiting (duplicate_pending). The
 * structure is applied to a copy first: it must not add a problem the plan did not have (invalid_result).
 * Nothing is added until the person accepts it.
 */
export function createStructureProposal(plan: Plan, structure: Structure, options: { now: () => string }): StructureProposalResult {
  if (hasPendingStructure(plan)) return { ok: false, code: "duplicate_pending" };

  const taken = new Set([
    ...plan.tasks.map((task) => task.id),
    ...plan.steps.map((step) => step.id),
    ...(plan.proposals ?? []).map((proposal) => proposal.id),
  ]);
  let id = STRUCTURE_ID;
  for (let n = 2; taken.has(id); n++) id = `${STRUCTURE_ID}-${n}`;

  const at = options.now();
  const proposal: Proposal = {
    id,
    status: "pending",
    reason: { scope: "plan" },
    add: { tasks: [], steps: [], relations: [] },
    structure,
    createdAt: at,
  };
  const next: Plan = { ...plan, proposals: [...(plan.proposals ?? []), proposal] };
  try {
    parsePlan(next);
  } catch {
    return { ok: false, code: "invalid_proposal" };
  }
  const accepted = materializeStructure(plan, proposal, at);
  if (!accepted || newProblems(checkPlan(plan), checkPlan(accepted)).length > 0) return { ok: false, code: "invalid_result" };
  return { ok: true, plan: next, proposal };
}
