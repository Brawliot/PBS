/**
 * How many questions to ask and which ones. The model proposes; this module decides.
 * All the numbers live in POLICY so they are easy to tune once there is real data.
 */

import type { PlannerInput } from "./planner-handler.js";
import type { PlannerAnswer, Phase2Response, Question } from "./planner-phase2-handler.js";

export const POLICY = {
  baseByMaturity: { vague: 2, developing: 3, advanced: 4 },
  min: 1,
  max: 5,
  // Commitment signals: each one that applies counts once
  highBudget: 100_000,
  highExperience: 5, // years
  fullTimeHours: 3, // slider position of "Full time"
  // Low commitment: under 10 h a week and a small budget, with no signal above
  lowHours: 0,
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

/** Maximum number of questions for the whole session */
export function questionLimit(maturity: Phase2Response["maturity"], input: PlannerInput): number {
  const signals =
    Number(input.hours >= POLICY.fullTimeHours) +
    Number(input.budget >= POLICY.highBudget) +
    Number(input.experience >= POLICY.highExperience);
  const lowCommitment =
    signals === 0 && input.hours <= POLICY.lowHours && input.budget < POLICY.lowBudget;
  const adjustment = signals >= 2 ? 1 : lowCommitment ? -1 : 0;

  const limit = POLICY.baseByMaturity[maturity] + adjustment;
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
