/**
 * Validation phase: Jev checks that the analysis is supported by what the user said,
 * that the plan is coherent and realistic, and how likely each department is needed.
 * Every question is a "noul" statement: Jev answers with a confidence from 0 to 1.
 */

import {
  buildState,
  callJev,
  type JevQuestion,
  type JevResponse,
  type PlannerInput,
} from "./planner-handler.js";
import type { Profile } from "./planner-profile-handler.js";
import type { PlannerAnswer, Phase2Response } from "./planner-phase2-handler.js";

/** Sections of the phase 2 analysis whose value gets checked against the description */
export const CLAIM_KEYS = [
  "subsector",
  "location",
  "target_customer",
  "value_proposition",
  "revenue_model",
  "stage",
  "competition",
] as const;
export type ClaimKey = (typeof CLAIM_KEYS)[number];
export type Claims = Partial<Record<ClaimKey, string>>;

const CLAIM_LABELS: Record<ClaimKey, string> = {
  subsector: "the subsector of the business",
  location: "the location where it will operate",
  target_customer: "the target customer",
  value_proposition: "the value proposition",
  revenue_model: "the revenue model",
  stage: "the current stage",
  competition: "the competition",
};

const CHECKS = {
  budget_fit: "The budget in the form is enough to launch this business.",
  timeline_realistic: "The expected timeline is realistic for the current stage of this business.",
  team_fit: "The team size and weekly hours are enough for what this business requires.",
  experience_fit: "The founder's years in the industry match what this business requires.",
  model_fit: "The revenue model fits the type of customer.",
  regulation_fit: "The regulatory requirements can be met with the stated resources.",
  consistency: "The description and the answers are consistent, with no contradictions.",
} as const;
export type CheckKey = keyof typeof CHECKS;

/** Two levels: small businesses see the groups, larger ones the departments */
const GROUPS: { group: string; departments: [name: string, definition: string][] }[] = [
  {
    group: "Legal & Compliance",
    departments: [["Legal & Compliance", "contracts, licenses, regulation and data protection"]],
  },
  {
    group: "Finance & People",
    departments: [
      ["Finance", "accounting, budgeting, funding, billing and pricing"],
      ["HR", "hiring, payroll, training and culture"],
    ],
  },
  {
    group: "Growth",
    departments: [
      ["Marketing", "brand, communication and customer acquisition campaigns"],
      ["Sales", "direct selling, deals, quotes and account management"],
    ],
  },
  {
    group: "Product & Tech",
    departments: [
      ["Product", "design, development and quality of what is offered"],
      ["Technology", "software, IT systems and cloud"],
    ],
  },
  {
    group: "Operations",
    departments: [
      ["Operations", "day-to-day processes, suppliers, logistics and customer support"],
      ["Infrastructure", "premises, equipment, facilities and warehouses"],
    ],
  },
  {
    group: "Health",
    departments: [["Health", "clinical staff and processes, hygiene and health and safety"]],
  },
];

// Areas every business needs, whatever its size: they never rank below "important"
const BASELINE = new Set(["Legal & Compliance", "Finance", "Marketing"]);
const CORE_MIN = 75; // weight at or above this is "core"
const IMPORTANT_MIN = 40; // at or above this is "important", below it "light"

const SUPPORT_MIN = 50; // below this a claim is not shown as fact
const CHECK_MIN = 50; // below this a coherence check becomes a warning
const MAX_CLAIM_LENGTH = 300;

export type Tier = "core" | "important" | "light";

/** How much effort an area takes in this business (not whether it is needed) */
interface Scored {
  name: string;
  confidence: number; // 0-100, Jev's confidence that the area is among the most critical
  tier: Tier;
}

const tierOf = (confidence: number): Tier =>
  confidence >= CORE_MIN ? "core" : confidence >= IMPORTANT_MIN ? "important" : "light";

export interface Validation {
  /** Claims the description does not back up: they must not be shown as fact */
  unsupported: ClaimKey[];
  /** Coherence checks that came out below CHECK_MIN */
  warnings: CheckKey[];
  /** Areas by weight, heaviest first: the departments and the same grouped (max of the members) */
  departments: Scored[];
  groups: Scored[];
}

/** Keeps only known sections with a usable value; the text ends up in prompts, so it is cleaned */
export function cleanClaims(raw: unknown): Claims {
  const claims: Claims = {};
  if (typeof raw !== "object" || raw === null) return claims;
  for (const key of CLAIM_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim().slice(0, MAX_CLAIM_LENGTH);
    if (text && text.toLowerCase() !== "unknown") claims[key] = text;
  }
  return claims;
}

/** The same claims, read from a phase 2 response held by the server */
export function claimsFromPhase2(phase2: Phase2Response): Claims {
  return cleanClaims(Object.fromEntries(CLAIM_KEYS.map((key) => [key, phase2[key].value])));
}

/** Group size to show: 1 = groups, 2 = departments (what the business needs, else the form) */
export function departmentLevel(profile: Profile, input: PlannerInput): 1 | 2 {
  const needed = profile.values.team_requirement;
  if (/large|specialized/i.test(needed)) return 2;
  if (/solo|small/i.test(needed)) return 1;
  return input.team >= 2 ? 2 : 1;
}

const percent = (value: number | undefined) =>
  value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);

export async function analyzeValidation(
  input: PlannerInput,
  jev: JevResponse,
  claims: Claims,
  answers: PlannerAnswer[],
): Promise<Validation> {
  const choice = (key: string) => jev.answers[key]?.choice ?? "unknown";
  const given = answers.length
    ? answers.map((a) => `- [${a.topic}] ${a.question} -> ${a.answer}`).join("\n")
    : "(none)";
  const state = `Business idea and form data: ${buildState(input)}

Key context:
- Sector: ${choice("sector")}
- Geographic scope: ${choice("geographic_scope")}
- Timeline: ${choice("timeline")}

User answers:
${given}
`;

  const questions: Record<string, JevQuestion> = {};
  for (const [key, value] of Object.entries(claims)) {
    questions[`claim_${key}`] = {
      type: "noul",
      instructions: `The user's description and answers back up that ${CLAIM_LABELS[key as ClaimKey]} is: "${value}".`,
    };
  }
  for (const [key, statement] of Object.entries(CHECKS)) {
    questions[`check_${key}`] = { type: "noul", instructions: statement };
  }
  for (const { departments } of GROUPS) {
    for (const [name, definition] of departments) {
      questions[`dept_${name}`] = {
        type: "noul",
        instructions: `For this business to work right now, ${name} (${definition}) is one of the most critical areas.`,
      };
    }
  }

  const { answers: result } = await callJev(state, questions);
  const score = (key: string) => percent(result[key]?.noul);

  const unsupported = (Object.keys(claims) as ClaimKey[]).filter((key) => {
    const value = score(`claim_${key}`);
    return value !== undefined && value < SUPPORT_MIN;
  });
  const warnings = (Object.keys(CHECKS) as CheckKey[]).filter((key) => {
    const value = score(`check_${key}`);
    return value !== undefined && value < CHECK_MIN;
  });

  const byConfidence = (a: Scored, b: Scored) => b.confidence - a.confidence;
  const scored = (name: string, confidence: number, baseline: boolean): Scored => {
    const value = baseline ? Math.max(confidence, IMPORTANT_MIN) : confidence;
    return { name, confidence: value, tier: tierOf(value) };
  };

  const departments: Scored[] = [];
  const groups: Scored[] = [];
  for (const { group, departments: members } of GROUPS) {
    const items = members.map(([name]) =>
      scored(name, score(`dept_${name}`) ?? 0, BASELINE.has(name)),
    );
    departments.push(...items);
    groups.push(scored(group, Math.max(...items.map((d) => d.confidence)), false));
  }

  return {
    unsupported,
    warnings,
    departments: departments.sort(byConfidence),
    groups: groups.sort(byConfidence),
  };
}
