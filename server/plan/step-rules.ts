/**
 * Rules of the step level: which status changes are allowed, which output other steps
 * may read, the invariants a step must always keep, and the order between steps. Pure
 * functions; every rule answers with a code, never with plan content.
 */

import { MAX_ROUNDS, type Plan, type Step, type StepExecutor, type StepOutput, type StepStatus } from "./plan-model.js";

/**
 * The only source of truth for status changes, per executor. Anything not listed is
 * refused. "done" is final. "ready" and "blocked" are not stored, so they are not here.
 */
export const TRANSITIONS: Record<StepExecutor, Record<StepStatus, readonly StepStatus[]>> = {
  ai: {
    not_started: ["running"],
    running: ["waiting_user"],
    waiting_user: ["running", "done", "rejected"],
    waiting_third_party: [],
    done: [],
    rejected: ["not_started"],
  },
  user: {
    not_started: ["running"],
    running: ["done", "waiting_third_party", "rejected"],
    waiting_user: [],
    waiting_third_party: ["running", "rejected"],
    done: [],
    rejected: ["not_started"],
  },
  third_party: {
    not_started: ["waiting_third_party"],
    running: [],
    waiting_user: [],
    waiting_third_party: ["done", "rejected"],
    done: [],
    rejected: ["not_started"],
  },
};

export type TransitionRefusal = "not_allowed" | "not_launched_by_user" | "rounds_exceeded" | "evidence_missing";

export type TransitionResult = { allowed: true } | { allowed: false; reason: TransitionRefusal };

export interface StepContext {
  step: Step;
  /** True only when the person asked for it: the launch of an AI step, or another round */
  launchedByUser: boolean;
}

const refuse = (reason: TransitionRefusal): TransitionResult => ({ allowed: false, reason });

/** The current output of an AI step, if it is the one the person confirmed: other steps may read it */
export function readableOutput(step: Step): StepOutput | undefined {
  const current = step.outputs?.at(-1);
  return step.executor === "ai" && current?.state === "confirmed" ? current : undefined;
}

function hasEvidence(step: Step): boolean {
  switch (step.evidence.kind) {
    case "none":
      return true;
    case "accepted_output":
      return readableOutput(step)?.confirmedAt !== undefined;
    default:
      return step.proof !== undefined;
  }
}

/** Whether a step may go from one status to another, with the reason when it may not */
export function canTransition(from: StepStatus, to: StepStatus, context: StepContext): TransitionResult {
  const { step } = context;
  if (!TRANSITIONS[step.executor][from].includes(to)) return refuse("not_allowed");
  if (step.executor === "ai" && to === "running") {
    if (!context.launchedByUser) return refuse("not_launched_by_user");
    // Every run ends in a new version of the output: the existing versions are the rounds used
    if ((step.outputs?.length ?? 0) >= MAX_ROUNDS) return refuse("rounds_exceeded");
  }
  if (to === "done" && !hasEvidence(step)) return refuse("evidence_missing");
  return { allowed: true };
}

/** Indexes of "feeds" relations whose source is not an AI step */
export function feedsFromNonAi(plan: Plan): number[] {
  const ai = new Set(plan.steps.filter((step) => step.executor === "ai").map((step) => step.id));
  return plan.relations.flatMap((relation, index) =>
    relation.level === "step" && relation.type === "feeds" && !ai.has(relation.from) ? [index] : [],
  );
}

/**
 * The order between steps as edges [before, after], with blocks, follows and feeds together.
 * "from blocks to" and "from feeds to" keep their direction; "from follows to" is the reverse.
 */
export function orderEdges(relations: Plan["relations"]): [string, string][] {
  return relations.flatMap((relation): [string, string][] => {
    if (relation.level !== "step") return [];
    return relation.type === "follows" ? [[relation.to, relation.from]] : [[relation.from, relation.to]];
  });
}

/** Ids of one cycle in order (the last one leads back to the first), or undefined */
export function cycleIn(edges: readonly (readonly [string, string])[]): string[] | undefined {
  const next = new Map<string, string[]>();
  for (const [before, after] of edges) next.set(before, [...(next.get(before) ?? []), after]);

  const done = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const at = path.indexOf(id);
    if (at >= 0) return path.slice(at);
    if (done.has(id)) return undefined;
    path.push(id);
    for (const target of next.get(id) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(id);
    return undefined;
  };

  for (const id of next.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return undefined;
}

/** Looks for a cycle among steps, with blocks, follows and feeds together */
export function findStepCycle(relations: Plan["relations"]): string[] | undefined {
  return cycleIn(orderEdges(relations));
}

export const STEP_PROBLEMS = [
  "done_without_evidence",
  "multiple_drafts",
  "draft_not_last",
  "versions_not_consecutive",
  "events_go_back",
  "events_not_chained",
  "status_not_last_event",
  "too_many_rounds",
  "outputs_on_non_ai",
  "mode_on_non_user",
  "user_without_mode",
] as const;

export type StepProblem = (typeof STEP_PROBLEMS)[number];

/**
 * The invariants a step must always keep, checked on their own (not through the schema) so
 * they can be used to audit what the actions produce. Returns the broken ones as codes, in a
 * fixed order and without repeats: no content of the step ever appears in the answer.
 */
export function stepProblems(step: Step): StepProblem[] {
  const outputs = step.outputs ?? [];
  const events = step.events;
  const broken: Record<StepProblem, boolean> = {
    done_without_evidence: step.status === "done" && !hasEvidence(step),
    multiple_drafts: outputs.filter((output) => output.state === "draft").length > 1,
    draft_not_last: outputs.some((output, index) => output.state === "draft" && index !== outputs.length - 1),
    versions_not_consecutive: outputs.some((output, index) => output.version !== index + 1),
    events_go_back: events.some((event, index) => index > 0 && Date.parse(event.at) < Date.parse(events[index - 1].at)),
    events_not_chained: events.some((event, index) => event.from !== (index === 0 ? "not_started" : events[index - 1].to)),
    status_not_last_event: step.status !== (events.at(-1)?.to ?? "not_started"),
    too_many_rounds: outputs.length > MAX_ROUNDS,
    outputs_on_non_ai: step.executor !== "ai" && step.outputs !== undefined,
    mode_on_non_user: step.executor !== "user" && step.mode !== undefined,
    user_without_mode: step.executor === "user" && step.mode === undefined,
  };
  return STEP_PROBLEMS.filter((code) => broken[code]);
}
