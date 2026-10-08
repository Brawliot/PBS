import { DIMENSION_KEYS, DIMENSION_OPTIONS, type DimensionKey } from "../../planner/planner-profile-handler.js";
import { CLAIM_KEYS, CHECK_KEYS } from "../../planner/planner-validation-handler.js";
import type { Report } from "../../plan/report.js";

/** The departments of the validation, heaviest first, with their tier */
const DEPARTMENTS: [name: string, tier: "core" | "important" | "light"][] = [
  ["Legal & Compliance", "core"],
  ["Finance", "core"],
  ["Marketing", "important"],
  ["Product", "important"],
  ["Operations", "light"],
  ["HR", "light"],
  ["Sales", "light"],
  ["Technology", "light"],
  ["Infrastructure", "light"],
  ["Health", "light"],
];

/** The Japanese restaurant in Madrid: two undefined dimensions, one unsupported claim, heavy regulation, a budget warning */
export const MADRID_VALUES: Record<DimensionKey, string> = {
  customer_segment: "Consumers",
  revenue_model: "Hybrid",
  offering_type: "Physical venue",
  acquisition_channel: "Foot traffic or location",
  competition: "Crowded market",
  differentiator: "Not specified",
  validation_stage: "Idea only",
  founder_profile: "Not specified",
  deadline_rigidity: "Flexible",
  capital_intensity: "High (inventory, equipment, premises or R&D)",
  team_requirement: "Feasible solo",
  time_to_revenue: "0-3 months",
  regulatory_load: "Heavy (health, finance, food)",
  third_party_dependency: "Autonomous",
  money_handling: "Collects through a payment provider",
};

export interface ReportOptions {
  values?: Partial<Record<DimensionKey, string>>;
  unsupported?: string[];
  warnings?: string[];
  timeline?: string | null;
}

/** A report that passes the schema. The unknown list follows the values: "Not specified" is unknown. */
export function reportWith(options: ReportOptions = {}): Report {
  const values = { ...MADRID_VALUES, ...options.values } as Record<DimensionKey, string>;
  const unknown = DIMENSION_KEYS.filter((key) => values[key] === "Not specified");
  const answers: Record<string, unknown> = {
    sector: { type: "choice", choice: "Food & restaurants" },
  };
  if (options.timeline !== null) answers.timeline = { type: "choice", choice: options.timeline ?? "Fast (3-6m)" };
  return {
    input: { idea: "Restaurante japonés en Madrid", budget: 80000, experience: 5, team: 1, hours: 2 },
    answers: [],
    jev: { answers: answers as Report["jev"]["answers"] },
    profile: { values, unknown, known: DIMENSION_KEYS.length - unknown.length, total: DIMENSION_KEYS.length },
    validation: {
      unsupported: (options.unsupported ?? ["location"]) as Report["validation"]["unsupported"],
      warnings: (options.warnings ?? ["budget_fit"]) as Report["validation"]["warnings"],
      departments: DEPARTMENTS.map(([name, tier]) => ({ name, confidence: 50, tier })),
      groups: [],
      level: 2,
    },
  } as Report;
}

export { CLAIM_KEYS, CHECK_KEYS };
