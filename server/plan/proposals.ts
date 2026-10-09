/**
 * Proposals: what a gap or a confirmed fact can grow the plan into. Nothing is added until the person
 * accepts it. Pure: each function returns a new plan, and checkPlan decides whether the result is valid.
 * A proposal is checked when it is created and again when it is accepted (the facts may have changed).
 */

import { checkPlan } from "./plan-check.js";
import { newProblems } from "./plan-actions.js";
import { parsePlan, PROPOSAL_LIMITS, type Plan, type Proposal, type Task } from "./plan-model.js";
import { templateFor, type ProposalAdd } from "./proposal-templates.js";
import { materializeStructure } from "./plan-structure.js";

export const PROPOSAL_ERRORS = [
  "wrong_actor",
  "invalid_proposal",
  "unknown_reason",
  "not_confirmed",
  "not_expandable",
  "duplicate_pending",
  "too_large",
  "id_taken",
  "unknown_proposal",
  "already_decided",
  "invalid_result",
  "needs_ai",
  "not_available",
] as const;
export type ProposalError = (typeof PROPOSAL_ERRORS)[number];

export type ProposalReason = Proposal["reason"];

/** What the caller gives: the id, the reason, the gap it resolves, and what it adds */
export interface ProposalInput {
  id: string;
  reason: ProposalReason;
  resolves?: string;
  add: ProposalAdd;
}

export type ProposalResult = { ok: true; plan: Plan; proposal: Proposal } | { ok: false; code: ProposalError };
export type DecisionResult = { ok: true; plan: Plan; proposal: Proposal } | { ok: false; code: ProposalError };

const fail = (code: ProposalError) => ({ ok: false as const, code });

const confirmedFactIds = (plan: Plan) => new Set((plan.facts ?? []).filter((fact) => fact.status === "confirmed").map((fact) => fact.id));

const isPlaceholder = (task: Task | undefined) => task?.placeholder !== undefined;

/** How many ids a new proposal for the same gap and value tries before it gives up with id_taken */
export const EXPANSION_ID_ATTEMPTS = 20;

/**
 * The facts that the items of a proposal come from, and that are no longer confirmed. This is the one
 * test of "confirmed" for a proposal: accepting uses it (not_confirmed) and so does isObsolete.
 */
export function unconfirmedSources(plan: Plan, add: Proposal["add"]): string[] {
  const confirmed = confirmedFactIds(plan);
  return [...add.tasks, ...add.steps].flatMap((item) => item.derivedFrom ?? []).filter((factId) => !confirmed.has(factId));
}

/** A pending proposal is obsolete when a fact it comes from is no longer confirmed: accepting it would fail */
export function isObsolete(plan: Plan, proposal: Proposal): boolean {
  return proposal.status === "pending" && unconfirmedSources(plan, proposal.add).length > 0;
}

/** A gap is expandable when every key it waits for has a confirmed fact */
export function expandable(plan: Plan, taskId: string): boolean {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!isPlaceholder(task)) return false;
  return task!.placeholder!.waitsFor.every((keyId) =>
    (plan.facts ?? []).some((fact) => fact.status === "confirmed" && fact.key.kind === "catalog" && fact.key.id === keyId),
  );
}

/** The plan as it would be after accepting the proposal: items added, the gap's placeholder removed */
export function materialize(plan: Plan, proposal: Proposal, at: string): Plan {
  const resolves = proposal.resolves;
  const tasks = plan.tasks.map((task) => {
    if (task.id !== resolves) return task;
    const { placeholder: _resolved, ...rest } = task;
    return rest;
  });
  return {
    ...plan,
    tasks: [...tasks, ...proposal.add.tasks],
    steps: [...plan.steps, ...proposal.add.steps],
    relations: [...plan.relations, ...proposal.add.relations],
    proposals: (plan.proposals ?? []).map((item) =>
      item.id === proposal.id ? { ...item, status: "accepted", decidedAt: at } : item,
    ),
  };
}

const ADD_TOTALS = (add: ProposalAdd) => ({ tasks: add.tasks.length, steps: add.steps.length, relations: add.relations.length });

/** Checks what makes a proposal acceptable now, against the plan it would join */
function acceptable(
  plan: Plan,
  input: { id: string; reason: ProposalReason; resolves?: string; add: ProposalAdd },
  ownId?: string,
): ProposalError | undefined {
  // The proposal's own id is not a clash when it is checked for acceptance: it is already in the list
  const taken = new Set([
    ...plan.tasks.map((task) => task.id),
    ...plan.steps.map((step) => step.id),
    ...(plan.proposals ?? []).map((proposal) => proposal.id).filter((id) => id !== ownId),
  ]);
  if (taken.has(input.id)) return "id_taken";

  const reason = input.reason;
  // A reason of the plan scope belongs to a structure (plan-structure.ts), never to an ordinary proposal
  if ("scope" in reason) return "invalid_proposal";
  if ("factId" in reason) {
    const fact = (plan.facts ?? []).find((candidate) => candidate.id === reason.factId);
    if (!fact) return "unknown_reason";
    if (fact.status !== "confirmed") return "not_confirmed";
  } else {
    if (!plan.tasks.some((task) => task.id === reason.taskId)) return "unknown_reason";
    if (!expandable(plan, reason.taskId)) return "not_expandable";
  }
  if (input.resolves !== undefined && !expandable(plan, input.resolves)) return "not_expandable";

  const totals = ADD_TOTALS(input.add);
  if (totals.tasks > PROPOSAL_LIMITS.tasks || totals.steps > PROPOSAL_LIMITS.steps || totals.relations > PROPOSAL_LIMITS.relations) {
    return "too_large";
  }
  const addedIds = [...input.add.tasks.map((task) => task.id), ...input.add.steps.map((step) => step.id)];
  if (new Set(addedIds).size !== addedIds.length || addedIds.some((id) => taken.has(id))) return "id_taken";
  for (const item of [...input.add.tasks, ...input.add.steps]) {
    if (!item.derivedFrom || item.derivedFrom.length === 0) return "invalid_proposal";
  }
  if (unconfirmedSources(plan, input.add).length > 0) return "not_confirmed";
  return undefined;
}

export function createProposal(plan: Plan, input: ProposalInput, options: { now: () => string }): ProposalResult {
  const reasonKey = JSON.stringify(input.reason);
  const pendingSame = (plan.proposals ?? []).some((item) => item.status === "pending" && JSON.stringify(item.reason) === reasonKey);
  if (pendingSame) return fail("duplicate_pending");

  // A reason that is a gap: the proposal resolves it, so the gap is its own id
  const resolves = "taskId" in input.reason ? input.reason.taskId : input.resolves;
  const checked = acceptable(plan, { ...input, resolves });
  if (checked) return fail(checked);

  const proposal: Proposal = {
    id: input.id,
    status: "pending",
    reason: input.reason,
    ...(resolves !== undefined && { resolves }),
    add: input.add,
    createdAt: options.now(),
  };
  const next: Plan = { ...plan, proposals: [...(plan.proposals ?? []), proposal] };
  try {
    parsePlan(next);
  } catch {
    return fail("invalid_proposal");
  }
  // Simulated acceptance: it must not add a problem the plan did not already have
  const accepted = materialize(plan, proposal, options.now());
  if (newProblems(checkPlan(plan), checkPlan(accepted)).length > 0) return fail("invalid_result");
  return { ok: true, plan: next, proposal };
}

export function applyProposalAction(
  plan: Plan,
  proposalId: string,
  action: "accept" | "reject",
  options: { now: () => string; actor: "user" | "ai" | "system" },
): DecisionResult {
  if (options.actor !== "user") return fail("wrong_actor");
  const proposal = (plan.proposals ?? []).find((item) => item.id === proposalId);
  if (!proposal) return fail("unknown_proposal");
  if (proposal.status !== "pending") return fail("already_decided");

  const at = options.now();
  if (action === "reject") {
    const rejected: Proposal = { ...proposal, status: "rejected", decidedAt: at };
    return { ok: true, plan: { ...plan, proposals: plan.proposals!.map((item) => (item.id === proposalId ? rejected : item)) }, proposal: rejected };
  }

  // A structure is applied as a whole, and checked again against the plan as it is now
  if (proposal.structure !== undefined) {
    const accepted = materializeStructure(plan, proposal, at);
    if (!accepted || newProblems(checkPlan(plan), checkPlan(accepted)).length > 0) return fail("invalid_result");
    return { ok: true, plan: accepted, proposal: accepted.proposals!.find((item) => item.id === proposalId)! };
  }

  // Accepting checks again: the facts or the gap may have changed since the proposal was made
  const checkedAgain = acceptable(
    plan,
    { id: proposal.id, reason: proposal.reason, resolves: proposal.resolves, add: proposal.add },
    proposal.id,
  );
  if (checkedAgain) return fail(checkedAgain);
  const accepted = materialize(plan, proposal, at);
  if (newProblems(checkPlan(plan), checkPlan(accepted)).length > 0) return fail("invalid_result");
  const result = accepted.proposals!.find((item) => item.id === proposalId)!;
  return { ok: true, plan: accepted, proposal: result };
}

/**
 * The proposal that expands a gap, from the confirmed value of its product_type. A value without a
 * template needs the AI (not built yet). A gap that is not expandable has nothing to propose yet.
 */
export function proposeExpansion(plan: Plan, taskId: string): { ok: true; proposal: ProposalInput } | { ok: false; code: ProposalError } {
  if (!expandable(plan, taskId)) return fail("not_expandable");
  const task = plan.tasks.find((candidate) => candidate.id === taskId)!;
  const fact = (plan.facts ?? []).find(
    (candidate) => candidate.status === "confirmed" && candidate.key.kind === "catalog" && candidate.key.id === "product_type",
  );
  if (!fact || fact.value.kind !== "catalog") return fail("needs_ai");
  const template = templateFor(fact.value.id);
  if (!template) return fail("needs_ai");
  // The first proposal of a value for a gap takes the plain id; each new one after a rejection takes -2, -3...
  // A candidate is used only when none of its ids (proposal, tasks, steps) is in the plan already.
  const base = `expand-${fact.value.id.replaceAll("_", "-")}`;
  const taken = new Set([
    ...plan.tasks.map((item) => item.id),
    ...plan.steps.map((item) => item.id),
    ...(plan.proposals ?? []).map((item) => item.id),
  ]);
  for (let attempt = 1; attempt <= EXPANSION_ID_ATTEMPTS; attempt++) {
    const prefix = attempt === 1 ? base : `${base}-${attempt}`;
    const add = template({ phaseId: task.phaseId, prefix, factId: fact.id });
    const id = `${prefix}-${task.id}`;
    const ids = [id, ...add.tasks.map((item) => item.id), ...add.steps.map((item) => item.id)];
    if (ids.some((candidate) => taken.has(candidate))) continue;
    return { ok: true, proposal: { id, reason: { taskId }, resolves: taskId, add } };
  }
  return fail("id_taken");
}
