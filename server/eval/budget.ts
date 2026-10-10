/**
 * The hard cap of one evaluation run. Every call to the model and to Jev counts here, retries included. The wrapper
 * refuses the call BEFORE it is made once the cap is reached, and marks the budget as exhausted, so the chain stops
 * at its next level. A refused call throws BudgetExhausted, which the agents read as a failed attempt (the same as
 * any other model error), so the flag, not the error, is what the runner looks at.
 */

import type { AgentDeps, AgentModel, RelevanceJudge } from "../plan/agents/contract.js";

export class BudgetExhausted extends Error {
  constructor() {
    super("The evaluation budget is used up");
    this.name = "BudgetExhausted";
  }
}

export interface Budget {
  /** Most calls (model and Jev together) the run may make */
  readonly limit: number;
  /** Calls made so far, by kind */
  readonly counts: { model: number; judge: number };
  /** Jev's verdict of each judge call, in order: "unavailable" when Jev gave no usable answer or failed */
  readonly verdicts: ("fits" | "doesNotFit" | "unavailable")[];
  /** True once a call was refused for the cap */
  exhausted: boolean;
  /** Calls made so far, model and Jev together */
  readonly used: number;
}

export function createBudget(limit: number): Budget {
  const budget = {
    limit,
    counts: { model: 0, judge: 0 },
    verdicts: [] as ("fits" | "doesNotFit" | "unavailable")[],
    exhausted: false,
    get used() {
      return this.counts.model + this.counts.judge;
    },
  };
  return budget;
}

/** Takes one call from the budget, or refuses it: a refused call is never made */
function take(budget: Budget, kind: "model" | "judge"): void {
  if (budget.used >= budget.limit) {
    budget.exhausted = true;
    throw new BudgetExhausted();
  }
  budget.counts[kind] += 1;
}

/** The same dependencies, with every call counted against the budget. The model and the judge are never called past the cap. */
export function withBudget(deps: AgentDeps, budget: Budget): AgentDeps {
  const model: AgentModel = {
    complete(request) {
      take(budget, "model");
      return deps.model.complete(request);
    },
  };
  const inner = deps.judge;
  const judge: RelevanceJudge | null =
    inner === null
      ? null
      : {
          async judge(idea, proposed) {
            take(budget, "judge");
            try {
              const fits = await inner.judge(idea, proposed);
              budget.verdicts.push(fits ? "fits" : "doesNotFit");
              return fits;
            } catch (error) {
              budget.verdicts.push("unavailable");
              throw error;
            }
          },
        };
  return { ...deps, model, judge };
}
