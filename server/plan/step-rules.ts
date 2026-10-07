/**
 * Rules of the step level: which status changes are allowed, which outputs other steps
 * may read, and the ordering graph between steps. Pure functions over an already
 * validated plan; every rule answers with a code, never with plan content.
 */

import type { Plan, Relation, Step, StepOutput, StepStatus } from "./plan-model.js";

/** Explicit table of allowed changes. Anything missing is refused. "done" and "rejected" are final. */
export const TRANSITIONS: Record<StepStatus, readonly StepStatus[]> = {
  pending: ["ready", "blocked", "rejected"],
  ready: ["running", "waiting_user", "waiting_third_party", "blocked", "done", "rejected"],
  running: ["waiting_user", "waiting_third_party", "blocked", "done", "rejected"],
  waiting_user: ["running", "blocked", "done", "rejected"],
  waiting_third_party: ["running", "blocked", "done", "rejected"],
  blocked: ["ready", "rejected"],
  done: [],
  rejected: [],
};

export type TransitionRefusal =
  | "not_allowed"
  | "blockers_not_done"
  | "feeders_not_confirmed"
  | "not_launched_by_user"
  | "evidence_missing";

export type TransitionResult = { allowed: true } | { allowed: false; reason: TransitionRefusal };

export interface StepContext {
  step: Step;
  /** Steps that block this one ("B blocks A": B is in A's blockers) */
  blockers: Step[];
  /** Steps whose result this one uses */
  feeders: Step[];
  /** True only when the person explicitly started the step */
  launchedByUser: boolean;
  /** Whether the person attached what "written_confirmation" or "receipt" asks for */
  evidenceProvided: boolean;
}

const refuse = (reason: TransitionRefusal): TransitionResult => ({ allowed: false, reason });

/** The output other steps may read: only a confirmed output of an AI step */
export function readableOutput(step: Step): StepOutput | undefined {
  return step.executor === "ai" && step.output?.state === "confirmed" ? step.output : undefined;
}

function hasEvidence(context: StepContext): boolean {
  switch (context.step.evidence.kind) {
    case "none":
      return true;
    case "accepted_output":
      return readableOutput(context.step) !== undefined;
    default:
      return context.evidenceProvided;
  }
}

export function canTransition(from: StepStatus, to: StepStatus, context: StepContext): TransitionResult {
  if (!TRANSITIONS[from].includes(to)) return refuse("not_allowed");
  if (to === "ready") {
    if (!context.blockers.every((blocker) => blocker.status === "done")) return refuse("blockers_not_done");
    if (!context.feeders.every((feeder) => readableOutput(feeder) !== undefined)) return refuse("feeders_not_confirmed");
  }
  if (to === "running" && context.step.executor === "ai" && !context.launchedByUser) {
    return refuse("not_launched_by_user");
  }
  if (to === "done" && !hasEvidence(context)) return refuse("evidence_missing");
  return { allowed: true };
}

/** Builds the context of a step from the plan's step relations */
export function stepContext(
  plan: Plan,
  step: Step,
  flags: { launchedByUser: boolean; evidenceProvided: boolean },
): StepContext {
  const sources = (type: Relation["type"]) =>
    plan.relations
      .filter((relation) => relation.level === "step" && relation.type === type && relation.to === step.id)
      .flatMap((relation) => plan.steps.filter((candidate) => candidate.id === relation.from));
  return { step, blockers: sources("blocks"), feeders: sources("feeds"), ...flags };
}

/** Indexes of "feeds" relations whose source is not an AI step */
export function feedsFromNonAi(plan: Plan): number[] {
  const ai = new Set(plan.steps.filter((step) => step.executor === "ai").map((step) => step.id));
  return plan.relations.flatMap((relation, index) =>
    relation.level === "step" && relation.type === "feeds" && !ai.has(relation.from) ? [index] : [],
  );
}

/**
 * Looks for a cycle among steps, with blocks, follows and feeds together. Each edge goes
 * from the step that comes first to the one that comes after: "from blocks to" and
 * "from feeds to" keep their direction, "from follows to" is the reverse.
 * Returns the ids of one cycle in order (the last one leads back to the first), or undefined.
 */
export function findStepCycle(relations: Plan["relations"]): string[] | undefined {
  const next = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.level !== "step") continue;
    const [before, after] = relation.type === "follows" ? [relation.to, relation.from] : [relation.from, relation.to];
    next.set(before, [...(next.get(before) ?? []), after]);
  }

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
