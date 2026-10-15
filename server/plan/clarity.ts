/**
 * The two clarity metrics of the report: how clearly the business concept is understood, and how much we know
 * about the person to fit the plan to them. They are computed here by fixed rules from what the run already has
 * (the sources of the phase 2 fields, the profile, the four fixed questions and the topics answered); no model
 * says a number. Clarity is not viability: it only measures how well the business and the person are understood.
 *
 * Pure: no I/O and no model. The weights, the source values and the thresholds all live in CLARITY below, and
 * CLARITY_VERSION changes whenever one of them does, so a stored report says which rules made it.
 *
 * Version 2: every variable the person can tell us also counts a follow-up answer on its topic (the questions of
 * "Improve my report" use these topics), and the clarity says how ready it is to build a plan (readiness).
 */

import { z } from "zod";
import type { DimensionKey } from "../planner/planner-profile-handler.js";
import type { InputKey } from "../planner/planner-handler.js";

export const CLARITY_VERSION = 2;

type Source = "stated" | "inferred" | "unknown";
export type ClarityLevel = "low" | "medium" | "high";
/** red: too little to build a plan; yellow: a plan, but a generic one; green: ready for a plan fitted to the person */
export type Readiness = "red" | "yellow" | "green";

export const CLARITY = {
  weight: { essential: 3, important: 2, secondary: 1 },
  source: { stated: 1, inferred: 0.5, unknown: 0 } as Record<Source, number>,
  // Initial thresholds, to calibrate with real reports. Percent of the full score; at or above "high" is High,
  // at or above "medium" is Medium, below it Low.
  concept: { medium: 40, high: 70 },
  // The four fixed questions alone give about 61 %, so the person's thresholds are higher
  person: { medium: 60, high: 85 },
  /** Most missing items shown per metric */
  maxMissing: 3,
};

/** The phase 2 fields the clarity reads, by their source */
export type Phase2Sources = Record<
  "subsector" | "location" | "target_customer" | "value_proposition" | "revenue_model" | "stage" | "competition",
  Source
>;

export interface ClarityInput {
  phase2: Phase2Sources;
  /** The profile's values (15 dimensions): "Not specified" is unknown, anything else is known */
  profile: Record<DimensionKey, string>;
  /** The fixed questions answered "I don't know"; the others were answered */
  unknownInputs: readonly InputKey[];
  /** The topics of the follow-up answers given */
  topics: readonly string[];
}

type Weight = keyof typeof CLARITY.weight;
interface Variable {
  label: string;
  weight: Weight;
  source: (input: ClarityInput) => Source;
}

const NOT_SPECIFIED = "Not specified";
const best = (...sources: Source[]): Source => (sources.includes("stated") ? "stated" : sources.includes("inferred") ? "inferred" : "unknown");
/** A profile dimension has no source of its own: once known, it counts as inferred */
const dimension = (input: ClarityInput, key: DimensionKey): Source => (input.profile[key] && input.profile[key] !== NOT_SPECIFIED ? "inferred" : "unknown");
/** A follow-up answer on the topic is the person's own words */
const topic = (input: ClarityInput, ...names: string[]): Source => (names.some((name) => input.topics.includes(name)) ? "stated" : "unknown");
/**
 * A fixed question is stated when it has an answer, "undecided" and "unsure" included: those are answers, not a value
 * that is missing. Only "I don't know" (in unknownInputs) counts as unknown.
 */
const fixed = (input: ClarityInput, key: InputKey): Source => (input.unknownInputs.includes(key) ? "unknown" : "stated");

/**
 * The business concept. capital_intensity, time_to_revenue, regulatory_load and third_party_dependency are left
 * out on purpose: they are the model's judgement of the business type, not something the person can tell us.
 */
const CONCEPT: Variable[] = [
  { label: "What you offer", weight: "essential", source: (i) => best(i.phase2.subsector, dimension(i, "offering_type"), topic(i, "offering")) },
  { label: "Value proposition", weight: "essential", source: (i) => best(i.phase2.value_proposition, topic(i, "value_proposition")) },
  { label: "Target customer", weight: "essential", source: (i) => best(i.phase2.target_customer, dimension(i, "customer_segment"), topic(i, "customer")) },
  { label: "How it makes money", weight: "essential", source: (i) => best(i.phase2.revenue_model, dimension(i, "revenue_model"), topic(i, "revenue")) },
  { label: "Where it operates", weight: "essential", source: (i) => best(i.phase2.location, fixed(i, "location"), topic(i, "location", "scope")) },
  { label: "How it reaches customers", weight: "important", source: (i) => best(dimension(i, "acquisition_channel"), topic(i, "acquisition")) },
  { label: "What sets it apart", weight: "important", source: (i) => best(dimension(i, "differentiator"), topic(i, "differentiator")) },
  { label: "Stage and validation", weight: "important", source: (i) => best(i.phase2.stage, dimension(i, "validation_stage"), topic(i, "validation", "progress")) },
  { label: "Known competition", weight: "secondary", source: (i) => best(i.phase2.competition, dimension(i, "competition"), topic(i, "competition")) },
];

const PERSON: Variable[] = [
  { label: "Budget", weight: "essential", source: (i) => fixed(i, "budget") },
  { label: "How you start", weight: "essential", source: (i) => fixed(i, "start_mode") },
  { label: "What you can do yourself", weight: "essential", source: (i) => best(dimension(i, "founder_profile"), topic(i, "own_skills")) },
  { label: "Premises", weight: "important", source: (i) => fixed(i, "premises") },
  { label: "Handling other people's money", weight: "important", source: (i) => best(dimension(i, "money_handling"), topic(i, "money_handling")) },
  { label: "Fixed deadline", weight: "secondary", source: (i) => best(dimension(i, "deadline_rigidity"), topic(i, "deadline")) },
  { label: "Existing assets", weight: "secondary", source: (i) => topic(i, "existing_assets") },
];

/** Every label a metric can list as missing (the report's schema takes only these) */
export const CLARITY_LABELS = [...CONCEPT, ...PERSON].map(({ label }) => label);

export interface ClarityMetric {
  level: ClarityLevel;
  /** Percent of the full score, 0 to 100 (whole number). Internal: the screen shows the level only. */
  score: number;
  /** The unknown variables, heaviest first, at most CLARITY.maxMissing */
  missing: string[];
  /** Whether an essential variable is unknown (it may be beyond the missing shown) */
  essentialMissing: boolean;
}

export interface Clarity {
  version: number;
  concept: ClarityMetric;
  person: ClarityMetric;
  readiness: Readiness;
}

/**
 * How ready the run is to build a plan: red when the business itself is unclear (concept Low), green when both
 * metrics are at least Medium and no essential of either is unknown, yellow in between.
 */
export function readinessOf(concept: Pick<ClarityMetric, "level" | "essentialMissing">, person: Pick<ClarityMetric, "level" | "essentialMissing">): Readiness {
  if (concept.level === "low") return "red";
  const enough = person.level !== "low" && !concept.essentialMissing && !person.essentialMissing;
  return enough ? "green" : "yellow";
}

function metric(variables: Variable[], input: ClarityInput, thresholds: { medium: number; high: number }): ClarityMetric {
  const scored = variables.map((variable) => ({ ...variable, value: CLARITY.source[variable.source(input)] }));
  const total = scored.reduce((sum, { weight }) => sum + CLARITY.weight[weight], 0);
  const got = scored.reduce((sum, { weight, value }) => sum + CLARITY.weight[weight] * value, 0);
  const percent = (got / total) * 100;
  // An unknown essential keeps the level below High, whatever the score
  const essentialMissing = scored.some(({ weight, value }) => weight === "essential" && value === 0);
  const level: ClarityLevel =
    percent >= thresholds.high && !essentialMissing ? "high" : percent >= thresholds.medium ? "medium" : "low";
  const missing = scored
    .filter(({ value }) => value === 0)
    .sort((a, b) => CLARITY.weight[b.weight] - CLARITY.weight[a.weight]) // stable: same weight keeps the table order
    .slice(0, CLARITY.maxMissing)
    .map(({ label }) => label);
  return { level, score: Math.round(percent), missing, essentialMissing };
}

export function computeClarity(input: ClarityInput): Clarity {
  const concept = metric(CONCEPT, input, CLARITY.concept);
  const person = metric(PERSON, input, CLARITY.person);
  return { version: CLARITY_VERSION, concept, person, readiness: readinessOf(concept, person) };
}

const MetricSchema = z.strictObject({
  level: z.enum(["low", "medium", "high"]),
  score: z.number().int().min(0).max(100),
  missing: z.array(z.enum(CLARITY_LABELS as [string, ...string[]])).max(CLARITY.maxMissing),
  // Optional: reports of version 1 have neither
  essentialMissing: z.boolean().optional(),
});

/** The clarity as the report keeps it. Optional in the report: reports kept before it have none. */
export const ClaritySchema = z.strictObject({
  version: z.number().int().min(1),
  concept: MetricSchema,
  person: MetricSchema,
  readiness: z.enum(["red", "yellow", "green"]).optional(),
});
