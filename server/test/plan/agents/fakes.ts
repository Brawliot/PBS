import type { AgentModel, AgentRequest, RelevanceJudge } from "../../../plan/agents/contract.js";
import { proposeFact, confirmFact } from "../../../plan/fact-actions.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import type { Plan } from "../../../plan/plan-model.js";

/**
 * A model for tests: answers in order, the last one repeats. An Error in the list makes that call fail.
 * Every request is kept, so a test can count the attempts and read what was sent.
 */
export class FakeModel implements AgentModel {
  readonly requests: AgentRequest[] = [];

  constructor(private readonly answers: (unknown | Error)[]) {}

  async complete(request: AgentRequest): Promise<unknown> {
    this.requests.push(request);
    const index = Math.min(this.requests.length - 1, this.answers.length - 1);
    const answer = this.answers[index];
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  }
}

/** A judge for tests: verdicts in order, the last one repeats. An Error makes Jev "unavailable". */
export class FakeJudge implements RelevanceJudge {
  calls = 0;

  constructor(private readonly verdicts: (boolean | Error)[]) {}

  async judge(): Promise<boolean> {
    this.calls += 1;
    const verdict = this.verdicts[Math.min(this.calls - 1, this.verdicts.length - 1)];
    if (verdict instanceof Error) throw verdict;
    return verdict;
  }
}

export const NOW = "2026-10-07T10:00:00Z";
export const now = () => NOW;

/** The restaurant plan with one confirmed fact (product_type = web_app), so an answer can cite it */
export function planWithFact(): { plan: Plan; factId: string } {
  const base = restaurantPlan();
  const proposed = proposeFact(base, { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" } }, { now, actor: "user" });
  if (!proposed.ok) throw new Error(proposed.code);
  const confirmed = confirmFact(proposed.plan, proposed.fact.id, { now, actor: "user" });
  if (!confirmed.ok) throw new Error(confirmed.code);
  return { plan: confirmed.plan, factId: confirmed.fact.id };
}

export const EMPTY_EXTRAS = { facts: [], requests: [], questions: [] };
