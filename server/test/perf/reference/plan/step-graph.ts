/**
 * Questions about the graph of steps: who blocks, feeds or precedes whom, whether a step
 * can start, and in which order to read them. Pure functions over the steps and the
 * step-level relations of a plan that already passed the coherence rules: an id that does
 * not exist is left out of the lookups (but never lets a step count as ready).
 */

import type { Plan, Relation, Step } from "./plan-model.js";
import { cycleIn, orderEdges, readableOutput } from "./step-rules.js";

type Relations = Plan["relations"];
type StepRelation = Extract<Relation, { level: "step" }>;

export type Readiness = "ready" | "blocked" | "not_applicable";

export type TopologicalResult =
  | { ok: true; order: Step[] }
  | { ok: false; code: "cycle"; ids: string[] };

const stepRelations = (relations: Relations, type: StepRelation["type"]) =>
  relations.filter((relation): relation is StepRelation => relation.level === "step" && relation.type === type);

/** The steps with these ids, in the order of `steps` and without repeats */
const pick = (steps: readonly Step[], ids: Iterable<string>) => {
  const wanted = new Set(ids);
  return steps.filter((step) => wanted.has(step.id));
};

/** Steps that must be done before this one can start ("B blocks A": B is a blocker of A) */
export function blockersOf(step: Step, steps: readonly Step[], relations: Relations): Step[] {
  return pick(steps, stepRelations(relations, "blocks").filter((r) => r.to === step.id).map((r) => r.from));
}

/** Steps this one blocks */
export function dependentsOf(step: Step, steps: readonly Step[], relations: Relations): Step[] {
  return pick(steps, stepRelations(relations, "blocks").filter((r) => r.from === step.id).map((r) => r.to));
}

/** Whether any step uses this one's result: its executor must then stay an AI */
export function feedsAnyStep(step: Step, relations: Relations): boolean {
  return stepRelations(relations, "feeds").some((r) => r.from === step.id);
}

/** Steps whose result this one uses */
export function feedersOf(step: Step, steps: readonly Step[], relations: Relations): Step[] {
  return pick(steps, stepRelations(relations, "feeds").filter((r) => r.to === step.id).map((r) => r.from));
}

/** Steps this one follows: they set the order but never block ("A follows B": B is a predecessor of A) */
export function predecessorsOf(step: Step, steps: readonly Step[], relations: Relations): Step[] {
  return pick(steps, stepRelations(relations, "follows").filter((r) => r.from === step.id).map((r) => r.to));
}

/**
 * Whether a step that has not started can start: every blocker is done and every feeder
 * has a confirmed current output. A source that is not in `steps` counts as not met.
 * Any other status is not_applicable: readiness is deduced, never stored.
 */
export function readiness(step: Step, steps: readonly Step[], relations: Relations): Readiness {
  if (step.status !== "not_started") return "not_applicable";
  const byId = new Map(steps.map((candidate) => [candidate.id, candidate]));
  const met = (source: string, isMet: (source: Step) => boolean) => {
    const found = byId.get(source);
    return found !== undefined && isMet(found);
  };
  const blocked =
    stepRelations(relations, "blocks").some((r) => r.to === step.id && !met(r.from, (s) => s.status === "done")) ||
    stepRelations(relations, "feeds").some((r) => r.to === step.id && !met(r.from, (s) => readableOutput(s) !== undefined));
  return blocked ? "blocked" : "ready";
}

/**
 * Steps in an order where each one comes after the steps that block, feed or precede it.
 * Stable: when several could come next, the one that appears first in `steps` goes first.
 * A cycle gives the ids involved, in order, instead of an order.
 */
export function topologicalOrder(steps: readonly Step[], relations: Relations): TopologicalResult {
  const index = new Map(steps.map((step, position) => [step.id, position]));
  const edges = orderEdges(relations).filter(([before, after]) => index.has(before) && index.has(after));
  const cycle = cycleIn(edges);
  if (cycle) return { ok: false, code: "cycle", ids: cycle };

  const waiting = steps.map(() => 0);
  const after = steps.map((): number[] => []);
  for (const [before, next] of edges) {
    after[index.get(before)!].push(index.get(next)!);
    waiting[index.get(next)!] += 1;
  }

  const available = new Set(steps.flatMap((_, position) => (waiting[position] === 0 ? [position] : [])));
  const order: Step[] = [];
  while (available.size > 0) {
    const position = Math.min(...available);
    available.delete(position);
    order.push(steps[position]);
    for (const next of after[position]) {
      waiting[next] -= 1;
      if (waiting[next] === 0) available.add(next);
    }
  }
  return { ok: true, order };
}
