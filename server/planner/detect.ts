/**
 * Detection of the fixed answers from the business description: one call to Jev with the description only.
 * Jev answers the sector, scope and timeline (as the planner does) and the fixed questions it can read from the
 * text. The server checks each value against the text and the closed options; a value the text does not support
 * is null. The place is detected only as "online" (an online or global scope); a city is always asked. Nothing
 * here ever blocks: when Jev fails, only what the text gives without it is kept (a single amount in euros), and
 * no token is returned.
 */

import { callJev, JEV_QUESTIONS, type JevQuestion, type JevResponse } from "./planner-handler.js";
import type { Premises, StartMode } from "./fixed-answers.js";
import { readAmounts, readEuroAmounts } from "./amounts.js";
import { MAX_BUDGET } from "../request.js";

export const DETECT_TIMEOUT_MS = 10_000;

export interface Detected {
  location: string | null;
  budget: number | null;
  start_mode: StartMode | null;
  premises: Premises | null;
}

export const EMPTY_DETECTED: Detected = { location: null, budget: null, start_mode: null, premises: null };

const NOT_STATED = "Not stated";
const STATED_ONLY = 'Choose a value only when the description says it explicitly; otherwise choose "Not stated".';

/** The budget bands of the fixed question (BUDGET_CHOICES in script.js): label, the value it sends, what it covers */
export const BUDGET_BANDS: readonly { label: string; value: number; covers: (amount: number) => boolean }[] = [
  { label: "Under 10,000 €", value: 5_000, covers: (a) => a < 10_000 },
  { label: "10,000-30,000 €", value: 20_000, covers: (a) => a >= 10_000 && a <= 30_000 },
  { label: "30,000-75,000 €", value: 50_000, covers: (a) => a >= 30_000 && a <= 75_000 },
  { label: "75,000-150,000 €", value: 110_000, covers: (a) => a >= 75_000 && a <= 150_000 },
  { label: "Over 150,000 €", value: 200_000, covers: (a) => a > 150_000 },
];

const START_LABELS: Record<string, StartMode> = {
  "From scratch": "scratch",
  "Taking over an existing business": "takeover",
  Franchise: "franchise",
  "Already open": "already_open",
};

const PREMISES_LABELS: Record<string, Premises> = {
  "Has premises": "have",
  "Looking for premises": "looking",
  "Not needed": "not_needed",
};

/** The questions Jev answers from the description: the planner's three, and the three fixed ones it can read */
export const DETECT_QUESTIONS: Record<string, JevQuestion> = {
  ...JEV_QUESTIONS,
  start_mode: {
    type: "choice",
    instructions: `How does the person start the business? ${STATED_ONLY}`,
    criteria: {
      "From scratch": "Starts a new business from zero",
      "Taking over an existing business": "Buys or takes over an existing business",
      Franchise: "Opens under a franchise or licence of a known brand",
      "Already open": "The business is already open and running",
      [NOT_STATED]: "The description does not say how they start",
    },
  },
  premises: {
    type: "choice",
    instructions: `Does the person have premises for the business? ${STATED_ONLY}`,
    criteria: {
      "Has premises": "Already has a shop, office, workshop or other premises",
      "Looking for premises": "Is looking for a place to rent or buy",
      "Not needed": "The business needs no physical premises (online, mobile, home based)",
      [NOT_STATED]: "The description does not say whether they have premises",
    },
  },
  budget: {
    type: "choice",
    instructions: `How much money the person can invest, in euros? ${STATED_ONLY}`,
    criteria: {
      ...Object.fromEntries(BUDGET_BANDS.map(({ label }) => [label, `An amount in this band is written in the description`])),
      [NOT_STATED]: "The description does not write an amount to invest",
    },
  },
};

/** The choice Jev made for a question, or undefined when it made none */
const choiceOf = (jev: JevResponse, key: string): string | undefined => {
  const answer = jev.answers[key];
  return answer?.type === "choice" ? answer.choice : undefined;
};

/** Turns Jev's choices into the closed values; each one is checked against the description */
export function detectedFrom(idea: string, jev: JevResponse): Detected {
  const scope = choiceOf(jev, "geographic_scope");
  const band = BUDGET_BANDS.find(({ label }) => label === choiceOf(jev, "budget"));
  const amounts = readAmounts(idea);
  const premises = choiceOf(jev, "premises");
  const start = choiceOf(jev, "start_mode");
  return {
    location: scope === "Online" || scope === "Global" ? "online" : null,
    budget: band && amounts.some(band.covers) ? band.value : null,
    start_mode: start !== undefined ? (START_LABELS[start] ?? null) : null,
    premises: premises !== undefined ? (PREMISES_LABELS[premises] ?? null) : null,
  };
}

/** The budget when Jev did not answer: the amount only when the text writes exactly one, in euros, as typed */
export function statedBudget(idea: string): number | null {
  const amounts = [...new Set(readEuroAmounts(idea))];
  return amounts.length === 1 ? Math.min(Math.round(amounts[0]), MAX_BUDGET) : null;
}

/** Keeps only the three answers the planner reads, so a stored result is what the planner would have asked */
const plannerPart = (jev: JevResponse): JevResponse => ({
  ...jev,
  answers: Object.fromEntries(Object.entries(jev.answers).filter(([key]) => key in JEV_QUESTIONS)),
});

export interface Detection {
  detected: Detected;
  /** The planner's part of the Jev result, to reuse in the first request; null when Jev did not answer */
  jev: JevResponse | null;
}

/**
 * Detects what the description says. Never throws: after a failure or a timeout only the stated budget is kept
 * (statedBudget), and no Jev result.
 */
export async function detectFromIdea(idea: string, signal?: AbortSignal, timeoutMs = DETECT_TIMEOUT_MS): Promise<Detection> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const jev = await callJev(JSON.stringify({ idea }), DETECT_QUESTIONS, signal ? AbortSignal.any([timeout, signal]) : timeout);
    return { detected: detectedFrom(idea, jev), jev: plannerPart(jev) };
  } catch (error) {
    console.error(`Detection without Jev: ${error instanceof Error ? error.message : "unknown error"}`);
    return { detected: { ...EMPTY_DETECTED, budget: statedBudget(idea) }, jev: null };
  }
}
