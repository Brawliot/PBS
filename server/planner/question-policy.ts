/**
 * Which of the questions the model proposed are asked. The model proposes; this module decides.
 * The limits live in POLICY so they are easy to change in one place.
 */

import type { PlannerAnswer, Question } from "./planner-phase2-handler.js";

export const POLICY = {
  min: 0, // 0 questions is a valid outcome: the report goes straight ahead
  max: 2, // questions from the model for the whole session, answered ones included
};

// Most valuable first: what is cut is always the least important
const TOPIC_PRIORITY = [
  "credentials",
  "trade_experience",
  "tech_builder",
  "who_operates",
  "opening_deadline",
  "partners",
  "existing_customers",
];

/** Drops answered or repeated topics, keeps the most valuable and fits the room left by the answers */
export function selectQuestions(questions: Question[], answers: PlannerAnswer[]): Question[] {
  const seen = new Set(answers.map((a) => a.topic));
  const rank = (topic: string) => {
    const index = TOPIC_PRIORITY.indexOf(topic);
    return index === -1 ? TOPIC_PRIORITY.length : index;
  };
  const room = Math.max(POLICY.min, POLICY.max - answers.length);

  return questions
    .filter((q) => !seen.has(q.topic) && seen.add(q.topic))
    .sort((a, b) => rank(a.topic) - rank(b.topic))
    .slice(0, room);
}
