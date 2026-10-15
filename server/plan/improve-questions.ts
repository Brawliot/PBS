/**
 * The questions of "Improve my report": a closed bank written here, in code. The model never writes a question or
 * an option. Every question is about PLANNING (what changes the diagnosis or the shape of the plan): what makes the
 * business different, who it is for, where, the cushion, the financing, who runs it, the competition. Questions
 * about EXECUTION (how a task is done: payments, suppliers, opening hours, the till, the menu, uniforms...) never
 * enter this bank; they belong to the tasks of the plan. EXCLUDED_EXECUTION lists them, and a test checks the bank
 * against that list.
 *
 * Each option has an effect, for the reading of the answer: "good" (the point is covered), "partial" (it is covered
 * in part), "gap" (a gap the person recognises: "I don't know yet", "Not yet") or "none". The effect is kept with
 * the bank; the statuses of the diagnosis do not change from it yet.
 *
 * Selection (selectImproveQuestions): the categories in risk come first, then the ones in watch. A strong check is
 * never asked. At most two questions per category and five in all; a question already answered in the report is
 * not asked again. A report with no category in risk or watch has no questions, and the link does not show.
 */

import type { Diagnosis } from "./report.js";

export type ImproveCategory = Diagnosis["checks"][number]["key"];
export type ImproveEffect = "good" | "partial" | "gap" | "none";
export interface ImproveOption {
  label: string;
  effect: ImproveEffect;
}
export interface ImproveQuestion {
  /** The key the answer is stored under (improveAnswers). Always starts with "imp_". */
  key: string;
  category: ImproveCategory;
  question: string;
  /** The options for each sector of the analysis; the default list when the sector has none of its own */
  options: ImproveOption[] | Partial<Record<string, ImproveOption[]>>;
}

export const IMPROVE_KEY = /^imp_[a-z_]{1,40}$/;
export const MAX_IMPROVE_PER_CATEGORY = 2;
export const MAX_IMPROVE_TOTAL = 5;

const DONT_KNOW: ImproveOption = { label: "I don't know yet", effect: "gap" };
const NOT_DECIDED: ImproveOption = { label: "Not decided yet", effect: "gap" };

/** The customer question's options by sector (Jev's sector answer); other sectors use CUSTOMERS_DEFAULT */
const CUSTOMERS_DEFAULT: ImproveOption[] = [
  { label: "A specific group (age, job or need)", effect: "good" },
  { label: "Locals in one area", effect: "partial" },
  { label: "Visitors and tourists", effect: "partial" },
  { label: "Businesses", effect: "partial" },
  DONT_KNOW,
];

export const IMPROVE_BANK: readonly ImproveQuestion[] = [
  {
    key: "imp_concept_difference",
    category: "concept",
    question: "What will make you different?",
    options: [
      { label: "Product", effect: "good" },
      { label: "Price", effect: "partial" },
      { label: "Hours", effect: "partial" },
      { label: "Atmosphere", effect: "partial" },
      { label: "Service", effect: "partial" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_concept_customer",
    category: "concept",
    question: "Who exactly is it for?",
    options: {
      "Hospitality/Food service": [
        { label: "Locals in one area", effect: "good" },
        { label: "Visitors and tourists", effect: "partial" },
        { label: "Office workers", effect: "partial" },
        { label: "Families", effect: "partial" },
        DONT_KNOW,
      ],
      "Health/Medicine": [
        { label: "Patients with a specific need", effect: "good" },
        { label: "Local residents", effect: "partial" },
        { label: "Referrals from doctors", effect: "partial" },
        { label: "Sports people", effect: "partial" },
        DONT_KNOW,
      ],
      "Technology/SaaS": [
        { label: "Small businesses", effect: "good" },
        { label: "Large companies", effect: "partial" },
        { label: "Consumers", effect: "partial" },
        { label: "Professionals in one field", effect: "partial" },
        DONT_KNOW,
      ],
    },
  },
  {
    key: "imp_location_premises",
    category: "location",
    question: "Do you have a specific street or premises in mind?",
    options: [
      { label: "Yes, a specific one", effect: "good" },
      { label: "A few options", effect: "partial" },
      { label: "Not yet", effect: "gap" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_location_footfall",
    category: "location",
    question: "Do you know how many people pass by or live nearby?",
    options: [
      { label: "Yes, I counted", effect: "good" },
      { label: "Roughly, from public data", effect: "partial" },
      { label: "Not yet", effect: "gap" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_reach_channel",
    category: "reach",
    question: "How will customers find an online business like this?",
    options: [
      { label: "Search", effect: "partial" },
      { label: "Social media", effect: "partial" },
      { label: "Partners", effect: "good" },
      { label: "Word of mouth", effect: "partial" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_reach_audience",
    category: "reach",
    question: "Do you know where your customers already spend time online?",
    options: [
      { label: "Yes, in specific groups or communities", effect: "good" },
      { label: "Roughly", effect: "partial" },
      { label: "Not yet", effect: "gap" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_money_cushion",
    category: "money",
    question: "Do you have a cushion apart from your budget?",
    options: [
      { label: "Yes, 3+ months of costs", effect: "good" },
      { label: "Some, less than 3 months", effect: "partial" },
      { label: "No", effect: "gap" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_money_financing",
    category: "money",
    question: "Could you get financing?",
    options: [
      { label: "Already have it", effect: "good" },
      { label: "Probably", effect: "partial" },
      { label: "No", effect: "gap" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_experience_operator",
    category: "experience",
    question: "Who will run it day to day?",
    options: [
      { label: "Me, I know the trade", effect: "good" },
      { label: "Me, learning", effect: "partial" },
      { label: "A hired manager with experience", effect: "partial" },
      NOT_DECIDED,
      DONT_KNOW,
    ],
  },
  {
    key: "imp_experience_training",
    category: "experience",
    question: "Have you trained for this kind of business?",
    options: [
      { label: "Yes, a course or a degree", effect: "good" },
      { label: "Some short courses", effect: "partial" },
      { label: "No", effect: "gap" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_competition_known",
    category: "competition",
    question: "Do you know the similar businesses near you?",
    options: [
      { label: "Yes, and what I'd do differently", effect: "good" },
      { label: "Yes, but not how to stand out", effect: "partial" },
      { label: "Not yet", effect: "gap" },
      DONT_KNOW,
    ],
  },
  {
    key: "imp_competition_unserved",
    category: "competition",
    question: "Which customers do the others not serve well?",
    options: [
      { label: "Families", effect: "partial" },
      { label: "Late hours", effect: "partial" },
      { label: "A specific diet or need", effect: "good" },
      { label: "Business clients", effect: "partial" },
      DONT_KNOW,
    ],
  },
];

/** Execution words: how a task is done. None of them may appear in a question or an option of the bank. */
export const EXCLUDED_EXECUTION = [
  "payment", "payments", "card", "cash", "till", "pos", "supplier", "suppliers", "opening hours", "rota", "shift", "shifts",
  "menu", "price list", "uniform", "uniforms", "stock order", "stock orders", "invoice", "invoices", "booking system",
];

/** The options of a question for a sector: its own list when it has one, else the default list */
export function optionsOf(question: ImproveQuestion, sector?: string): ImproveOption[] {
  if (question.key === "imp_concept_customer") {
    const own = sector ? (question.options as Partial<Record<string, ImproveOption[]>>)[sector] : undefined;
    return own ?? CUSTOMERS_DEFAULT;
  }
  return question.options as ImproveOption[];
}

/** Whether an answer is one of the options of its question, for the sector given (any sector's list when none is) */
export function isImproveAnswer(key: string, label: string, sector?: string): boolean {
  const question = IMPROVE_BANK.find((item) => item.key === key);
  if (!question) return false;
  const lists = key === "imp_concept_customer" && !sector
    ? [CUSTOMERS_DEFAULT, ...Object.values(question.options as Record<string, ImproveOption[]>)]
    : [optionsOf(question, sector)];
  return lists.some((options) => options.some((option) => option.label === label));
}

export interface SelectedImprove {
  key: string;
  category: ImproveCategory;
  status: Diagnosis["checks"][number]["status"];
  question: string;
  options: string[];
}

/**
 * The questions to ask now, for a diagnosis: the risks first, then the watches, two per category at most, five in
 * all, none already answered, and no more than `room` (the answers the report can still take).
 */
export function selectImproveQuestions(
  diagnosis: Diagnosis | undefined,
  answered: readonly string[],
  sector?: string,
  room: number = MAX_IMPROVE_TOTAL,
): SelectedImprove[] {
  if (!diagnosis) return [];
  const order = [
    ...diagnosis.checks.filter(({ status }) => status === "risk"),
    ...diagnosis.checks.filter(({ status }) => status === "watch"),
  ];
  const limit = Math.min(MAX_IMPROVE_TOTAL, Math.max(0, room));
  const taken = new Set(answered);
  const selected: SelectedImprove[] = [];
  for (const check of order) {
    let perCategory = 0;
    for (const question of IMPROVE_BANK) {
      if (selected.length >= limit || perCategory >= MAX_IMPROVE_PER_CATEGORY) break;
      if (question.category !== check.key || taken.has(question.key)) continue;
      selected.push({
        key: question.key,
        category: check.key,
        status: check.status,
        question: question.question,
        options: optionsOf(question, sector).map(({ label }) => label),
      });
      perCategory += 1;
    }
  }
  return selected;
}

/**
 * The answers of "Improve my report" in a list of answers: those whose topic is a question of the bank and whose
 * answer is one of its options. The answers that are not are not returned (the planner still reads them as text).
 */
export function improveAnswersOf(answers: readonly { topic: string; answer: string }[], sector?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { topic, answer } of answers) {
    if (IMPROVE_KEY.test(topic) && isImproveAnswer(topic, answer, sector)) out[topic] = answer;
  }
  return out;
}
