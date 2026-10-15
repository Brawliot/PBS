/**
 * How many questions to ask and which ones. The model proposes; this module decides.
 * All the numbers live in POLICY so they are easy to tune once there is real data.
 */

import { isUnknown, type PlannerInput } from "./planner-handler.js";
import type { PlannerAnswer, Phase2Response, Question } from "./planner-phase2-handler.js";

export const POLICY = {
  baseByMaturity: { vague: 2, developing: 3, advanced: 4 },
  min: 1,
  max: 5,
  // Commitment signal from the budget only (the fixed questions no longer ask hours or experience)
  highBudget: 100_000,
  // Low commitment: a small budget, with no signal above
  lowBudget: 20_000,
};

// Most valuable first: what is cut is always the least important
const TOPIC_PRIORITY = [
  "validation",
  "progress",
  "direction",
  "money_handling",
  "own_skills",
  "deadline",
  "differentiator",
  "scope",
  "existing_assets",
];

/** Maximum number of questions for the whole session. An "I don't know" for the budget is no signal, high or low. */
export function questionLimit(maturity: Phase2Response["maturity"], input: PlannerInput): number {
  const budgetKnown = !isUnknown(input, "budget");
  const adjustment = budgetKnown && input.budget >= POLICY.highBudget ? 1 : budgetKnown && input.budget < POLICY.lowBudget ? -1 : 0;

  // An unknown maturity falls back to "developing" instead of producing NaN
  const base = Object.hasOwn(POLICY.baseByMaturity, maturity)
    ? POLICY.baseByMaturity[maturity]
    : POLICY.baseByMaturity.developing;
  const limit = base + adjustment;
  return Math.min(POLICY.max, Math.max(POLICY.min, limit));
}

/** Drops answered or repeated topics, keeps the most valuable and fits the remaining room */
export function selectQuestions(
  questions: Question[],
  answers: PlannerAnswer[],
  limit: number,
): Question[] {
  const seen = new Set(answers.map((a) => a.topic));
  const rank = (topic: string) => {
    const index = TOPIC_PRIORITY.indexOf(topic);
    return index === -1 ? TOPIC_PRIORITY.length : index;
  };

  return questions
    .filter((q) => !seen.has(q.topic) && seen.add(q.topic))
    .sort((a, b) => rank(a.topic) - rank(b.topic))
    .slice(0, Math.max(0, limit - answers.length));
}
