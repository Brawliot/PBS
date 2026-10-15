/**
 * Jev handler for the planner's business analysis
 */

import { z } from "zod";
import { issueCodes } from "../schema-summary.js";
import { logProviderFailure } from "../log.js";
import { START_MODES, PREMISES, type StartMode, type Premises } from "./fixed-answers.js";

export interface JevQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: Record<string, string>;
}

interface JevRequest {
  state: string;
  model: string;
  questions: Record<string, JevQuestion>;
}

interface JevAnswer {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
}

interface JevResponse {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

const JevAnswerSchema = z.object({
  type: z.enum(["choice", "score", "noul"]),
  choice: z.string().optional(),
  score: z.number().optional(),
  noul: z.number().optional(),
});

const JevResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z
    .object({ input_tokens: z.number(), output_tokens: z.number() })
    .optional(),
});

const JEV_UNEXPECTED_MESSAGE = "The analysis service returned an unexpected response";

/** The four fixed questions (PROFILE_QUESTIONS in script.js) */
export type InputKey = "location" | "budget" | "start_mode" | "premises";

export { START_MODES, PREMISES, type StartMode, type Premises } from "./fixed-answers.js";

/** Payload sent by the index page (see submitIdea in script.js) */
export interface PlannerInput {
  idea: string;
  /** Where the business will be: a city, and a neighbourhood if known; "online" for no fixed place. "" when unknown */
  location: string;
  /** How much the person can invest, in euros (the amount of the chosen range, or the amount typed) */
  budget: number;
  start_mode: StartMode;
  premises: Premises;
  /**
   * The fixed questions answered "I don't know". Each one is no signal: its value is only a placeholder and every
   * reader must check this list first (see isUnknown). Absent when none is.
   */
  unknown?: InputKey[];
}

/** True when the person answered "I don't know" to this fixed question */
export const isUnknown = (input: PlannerInput, key: InputKey): boolean => input.unknown?.includes(key) ?? false;

const JEV_TIMEOUT_MS = 30_000;

export const JEV_QUESTIONS: Record<string, JevQuestion> = {
  sector: {
    type: "choice",
    instructions: "What is the business sector?",
    criteria: {
      "Technology/SaaS":
        "Software, apps, digital platforms or technology products",
      "Hospitality/Food service":
        "Restaurants, bars, cafes, hotels or catering",
      "Retail/Commerce":
        "Physical or online stores selling products to consumers",
      Manufacturing: "Industrial manufacturing or production of goods",
      "Professional Services":
        "Specialized services such as lawyers, architects or accounting firms",
      "Finance/Banking/Insurance":
        "Financial services, banking, investment or insurance",
      "Health/Medicine":
        "Clinics, healthcare services, pharmacy or medical wellness",
      "Education/Training": "Academies, courses, schools or training",
      "Logistics/Transport":
        "Transport of goods or people, warehousing or delivery",
      "Construction/Real Estate":
        "Building work, renovations, development, or buying, selling and renting property",
      "Marketing/Advertising/Agencies":
        "Marketing, advertising, communication or design agencies",
      "Media/Content/Entertainment":
        "Media outlets, content creation, leisure or events",
      "Agriculture/Livestock":
        "Crop growing, livestock or primary agri-food production",
      "Energy/Utilities":
        "Generation or supply of energy, water or other utilities",
      "Consulting/Advisory":
        "Strategic, business or technical advice to other companies",
      Other: "Does not fit any of the categories above",
    },
  },
  geographic_scope: {
    type: "choice",
    instructions: "What is the geographic scope of the business?",
    criteria: {
      "Hyper-local": "A very specific neighborhood or area within a city",
      Local: "A city or municipality",
      Regional: "A province or autonomous community",
      National: "A whole country",
      International: "Several countries",
      Global: "The whole world",
      Online: "Purely digital business with no physical geographic scope",
    },
  },
  timeline: {
    type: "choice",
    instructions: "What is the expected time to launch the business?",
    criteria: {
      "Ultra-fast (0-3m)": "Less than 3 months",
      "Fast (3-6m)": "Between 3 and 6 months",
      "Normal (6-12m)": "Between 6 and 12 months",
      "Long (12-18m)": "Between 12 and 18 months",
      "Very long (18+m)": "More than 18 months",
      "Not specified": "The description does not mention any timeline",
    },
  },

};

/**
 * The four checks Jev judges (plan/checks.ts). They are asked by the planner's own call only: the detection of an
 * idea asks JEV_QUESTIONS alone. Written for a physical business; an online one reads them as reach.
 */
export const CHECK_QUESTIONS: Record<string, JevQuestion> = {
  concept: {
    type: "choice",
    instructions: "Is the concept clear, and does it fit a real need of the customers it targets?",
    criteria: {
      Strong: "The product or service is clear and fits a real need of the customers it targets",
      Watch: "The concept is clear, but its fit with the customers is not yet shown",
      Risk: "The concept is vague, or it does not fit what the customers want",
    },
  },
  location: {
    type: "choice",
    instructions:
      "How good is the location for this business? A physical business judges its place. An online business judges its reach instead.",
    criteria: {
      Strong: "The place has plenty of the target customers nearby or passing by, and it is easy to reach",
      Watch: "The place is workable, but it will take real effort to attract customers",
      Risk: "The place has few target customers, or it is hard to reach",
    },
  },
  competition: {
    type: "choice",
    instructions: "How hard is the competition for this business, and is there a clear difference from it?",
    criteria: {
      Strong: "Few similar businesses in the area, or a clear difference from the ones there are",
      Watch: "Some similar businesses, and the difference is visible but not yet strong",
      Risk: "A zone with a lot of the same offer and no clear difference",
    },
  },
  experience: {
    type: "choice",
    instructions: "How much hands-on experience does the owner have in this kind of business?",
    criteria: {
      Strong: "The owner has worked in this kind of business",
      Watch: "The owner has little experience, but could hire someone who has it",
      Risk: "The owner has no experience and no plan to hire it",
    },
  },
};

/** Turns the form payload into the text state Jev analyzes */
export function buildState(input: PlannerInput): string {
  return JSON.stringify({
    idea: input.idea,
    location: isUnknown(input, "location") ? "unknown" : input.location,
    budget_eur: isUnknown(input, "budget") ? "unknown" : input.budget,
    start_mode: isUnknown(input, "start_mode") ? "unknown" : input.start_mode,
    premises: isUnknown(input, "premises") ? "unknown" : input.premises,
  });
}

/** Sends a state and a set of questions to Jev */
export async function callJev(
  state: string,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const model = process.env.JEV_MODEL;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
  if (!model) throw new Error("JEV_MODEL is not set");

  const request: JevRequest = { state, model, questions };

  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    // The request stops at its time limit, or earlier when the job is cancelled
    signal: AbortSignal.any([AbortSignal.timeout(JEV_TIMEOUT_MS), ...(signal ? [signal] : [])]),
  });

  if (!response.ok) {
    // Detail stays in the server log; callers only get a generic message
    logProviderFailure("Jev API", response.status, await response.text());
    throw new Error("The analysis service failed");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error("Jev response is not valid JSON");
    throw new Error(JEV_UNEXPECTED_MESSAGE);
  }

  // Only the failure paths and codes are logged, never the values or the body
  const parsed = JevResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error(`Jev response failed validation: ${issueCodes(parsed.error)}`);
    throw new Error(JEV_UNEXPECTED_MESSAGE);
  }
  const result: JevResponse = parsed.data;
  return result;
}

export function analyzeWithJev(input: PlannerInput, signal?: AbortSignal): Promise<JevResponse> {
  return callJev(buildState(input), { ...JEV_QUESTIONS, ...CHECK_QUESTIONS }, signal);
}

export type { JevResponse, JevAnswer };
