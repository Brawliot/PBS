/**
 * The report of the planner (phase 1) as the plan needs it. The server builds it from its own values and
 * keeps it (planner/planner-run.ts, report-repository.ts), and buildPlanSkeleton reads it back by id. Its
 * schema is still strict at every level (extra keys are refused), sizes are limited, and the values of the
 * profile are the real options of each dimension. Reading it back is checked again, so a stored report that
 * no longer passes is never used. parseReport never throws: it answers with the report or with a closed code.
 *
 * Trust: the phase 2 part and the answers come from the planner, and the analysis claims of the final request
 * come from the browser (they are only checked here, not verified). The claims shape the "Verify X" tasks of
 * the plan, so a person can change their own plan that way; see PRODUCTION.md.
 */

import { z } from "zod";
import { INPUT_KEYS, MAX_ANSWERS, MAX_BUDGET, MAX_IDEA, MAX_LOCATION, MAX_TEXT } from "../request.js";
import { START_MODES, PREMISES } from "../planner/fixed-answers.js";
import { CLAIM_KEYS } from "../planner/planner-validation-handler.js";
import { CHECK_KEYS, GROUPS } from "../planner/planner-validation-handler.js";
import { REPORT_TEMPLATES } from "../planner/report-templates.js";
import { DIMENSION_KEYS, DIMENSION_OPTIONS } from "../planner/planner-profile-handler.js";
import { GlanceSchema } from "./glance.js";
import { ClaritySchema } from "./clarity.js";
import {
  MAX_CURRENCY,
  MAX_EXPLAINED_AREAS,
  MAX_COST_ITEMS,
  MAX_COST_LABEL,
  MAX_EXPLAINED_WARNINGS,
  MAX_EXPLANATION_REASON,
  MAX_JEV_ANSWERS,
  MAX_JEV_CHOICE,
  MAX_JEV_KEY,
  MAX_JEV_MODEL,
  MAX_PHASE2_LIST,
  MAX_PHASE2_OPTIONS,
  MAX_PHASE2_QUESTIONS,
  MAX_PHASE2_TEXT,
  MAX_PHASE2_TOPIC,
  MAX_REPORT_BYTES,
  MAX_REPORT_NAME,
  MAX_REPORT_OBJECTS,
  MAX_SCORE,
  MAX_TIME_TO_OPEN_MONTHS,
  MAX_TIME_TO_OPEN_WEEKS,
  MIN_COST_ITEMS,
  TEMPLATE_PICKS,
} from "./report-limits.js";

// The sizes of the report live in report-limits.ts; they are re-exported here for the code that reads the report
export * from "./report-limits.js";

/** Every claim key the report can mark as unsupported: at most one each */
export const MAX_REPORT_UNSUPPORTED = CLAIM_KEYS.length;

const num = (min: number, max: number) => z.number().min(min).max(max);
/** The NUL character cannot be stored in PostgreSQL's jsonb, so no report text may carry it */
const noNul = (value: string) => !value.includes("\u0000");
const text = (max: number) => z.string().trim().min(1).max(max).refine(noNul, "NUL is not allowed");
const plainText = (max: number) => z.string().max(max).refine(noNul, "NUL is not allowed");
const SCORE = z.number().int().min(0).max(MAX_SCORE);

const InputSchema = z.strictObject({
  idea: text(MAX_IDEA),
  location: plainText(MAX_LOCATION),
  budget: num(0, MAX_BUDGET),
  start_mode: z.enum(START_MODES),
  premises: z.enum(PREMISES),
  /** The fixed questions answered "I don't know" (their value is a placeholder). Optional: none when all are answered. */
  unknown: z
    .array(z.enum(INPUT_KEYS as [string, ...string[]]))
    .max(INPUT_KEYS.length)
    .refine((keys) => new Set(keys).size === keys.length, "keys repeat")
    .optional(),
});

/**
 * A report kept before the fixed questions changed (location, start_mode and premises replaced experience, team and
 * hours): those three are not in it, so they count as "I don't know" and the old ones are dropped. The budget stays.
 * The report still opens and builds its plan. Any other report is read as it is.
 */
function fromLegacyInput(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "location" in value) return value;
  const { experience: _experience, team: _team, hours: _hours, unknown, ...rest } = value as Record<string, unknown>;
  const kept = Array.isArray(unknown) ? unknown.filter((key) => INPUT_KEYS.includes(key as never)) : [];
  // The budget was asked before too: only the three new questions are missing from an old report
  const missing = ["location", "start_mode", "premises"].filter((key) => !kept.includes(key));
  return {
    ...rest,
    location: "",
    start_mode: START_MODES[0],
    premises: PREMISES[0],
    unknown: [...new Set([...kept, ...missing])],
  };
}

// Same limits as the request (request.ts parseAnswers): a valid answer is always a valid report answer
const AnswerSchema = z.strictObject({ topic: text(MAX_TEXT), question: text(MAX_TEXT), answer: text(MAX_TEXT) });

const JevAnswerSchema = z.strictObject({
  type: z.enum(["choice", "score", "noul"]),
  choice: text(MAX_JEV_CHOICE).optional(),
  score: z.number().optional(),
  noul: z.number().optional(),
});

const JevSchema = z.strictObject({
  model: plainText(MAX_JEV_MODEL).optional(),
  // The key is the question of Jev (sector, timeline...): a short word, never free text
  answers: z
    .record(z.string().regex(new RegExp(`^[a-z_]{1,${MAX_JEV_KEY}}$`)), JevAnswerSchema)
    .refine((answers) => Object.keys(answers).length <= MAX_JEV_ANSWERS, "too many answers"),
  usage: z.strictObject({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) }).optional(),
});

const FieldSchema = z.strictObject({
  value: plainText(MAX_PHASE2_TEXT),
  source: z.enum(["stated", "inferred", "unknown"]),
  confidence: SCORE,
});

const Phase2Schema = z.strictObject({
  maturity: z.enum(["vague", "developing", "advanced"]),
  subsector: FieldSchema,
  location: FieldSchema,
  target_customer: FieldSchema,
  value_proposition: FieldSchema,
  revenue_model: FieldSchema,
  stage: FieldSchema,
  competition: FieldSchema,
  constraints: z.strictObject({
    budget: z.strictObject({
      min: z.number().nullable(),
      max: z.number().nullable(),
      currency: plainText(MAX_CURRENCY),
      fits: plainText(MAX_PHASE2_TEXT),
    }),
    exclusions: z.array(plainText(MAX_PHASE2_TEXT)).max(MAX_PHASE2_LIST),
    risks: z.array(plainText(MAX_PHASE2_TEXT)).max(MAX_PHASE2_LIST),
    assumptions: z.array(plainText(MAX_PHASE2_TEXT)).max(MAX_PHASE2_LIST),
  }),
  questions: z
    .array(
      z.strictObject({
        topic: text(MAX_PHASE2_TOPIC),
        question: text(MAX_PHASE2_TEXT),
        options: z.array(plainText(MAX_PHASE2_TEXT)).max(MAX_PHASE2_OPTIONS),
      }),
    )
    .max(MAX_PHASE2_QUESTIONS),
});

/** Each dimension takes only one of its real option labels ("Not specified" included) */
const ProfileValuesSchema = z.strictObject(
  Object.fromEntries(
    DIMENSION_KEYS.map((key) => [key, z.enum(Object.keys(DIMENSION_OPTIONS[key]) as [string, ...string[]])]),
  ) as Record<(typeof DIMENSION_KEYS)[number], z.ZodEnum<Record<string, string>>>,
);

const ProfileSchema = z.strictObject({
  values: ProfileValuesSchema,
  unknown: z.array(z.enum([...DIMENSION_KEYS] as [string, ...string[]])).max(DIMENSION_KEYS.length),
  known: z.number().int().min(0).max(DIMENSION_KEYS.length),
  total: z.number().int().min(0).max(DIMENSION_KEYS.length),
});

const ScoredSchema = z.strictObject({
  name: text(MAX_REPORT_NAME),
  confidence: SCORE,
  tier: z.enum(["core", "important", "light"]),
});

const ValidationSchema = z.strictObject({
  unsupported: z.array(z.enum([...CLAIM_KEYS] as [string, ...string[]])).max(MAX_REPORT_UNSUPPORTED),
  warnings: z.array(z.enum([...CHECK_KEYS] as [string, ...string[]])).max(CHECK_KEYS.length),
  departments: z.array(ScoredSchema).max(MAX_REPORT_OBJECTS),
  groups: z.array(ScoredSchema).max(MAX_REPORT_OBJECTS),
  level: z.union([z.literal(1), z.literal(2)]),
});

/** Every area name the validation can show: the groups and the departments */
const AREA_NAMES = [...new Set(GROUPS.flatMap(({ group, departments }) => [group, ...departments.map(([name]) => name)]))];

/** A reason is one plain line: no control characters, between 1 and MAX_EXPLANATION_REASON characters */
export const ReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_EXPLANATION_REASON)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), "control characters are not allowed");

/** Each part of the explanations is checked on its own (planner-explain-handler.ts); the report keeps the ones that pass */
export const WarningReasonsSchema = z
  .array(z.strictObject({ key: z.enum(CHECK_KEYS as [string, ...string[]]), reason: ReasonSchema }))
  .max(MAX_EXPLAINED_WARNINGS);

export const AreaReasonsSchema = z
  .array(z.strictObject({ name: z.enum(AREA_NAMES as [string, ...string[]]), reason: ReasonSchema }))
  .max(MAX_EXPLAINED_AREAS);

/** The time to open is an estimate of the model: whole weeks or months, within the caps, and a confidence */
export const TimeToOpenSchema = z
  .strictObject({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
    unit: z.enum(["weeks", "months"]),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .refine(({ min, max }) => min <= max, "max is below min")
  .refine(({ max, unit }) => max <= (unit === "weeks" ? MAX_TIME_TO_OPEN_WEEKS : MAX_TIME_TO_OPEN_MONTHS), "above the cap");

/** Labels are plain text: no spaces at the edges, no control characters, distinct from each other */
const CostLabelSchema = z
  .string()
  .min(1)
  .max(MAX_COST_LABEL)
  .refine((value) => value === value.trim() && !/[\u0000-\u001F\u007F]/.test(value), "not plain text");

/** The split of the upfront cost in percentages: two to five items, and the percentages add up to exactly 100 */
export const CostBreakdownSchema = z
  .array(z.strictObject({ label: CostLabelSchema, percent: z.number().int().min(1).max(100) }))
  .min(MIN_COST_ITEMS)
  .max(MAX_COST_ITEMS)
  .refine((items) => new Set(items.map(({ label }) => label)).size === items.length, "labels repeat")
  .refine((items) => items.reduce((sum, { percent }) => sum + percent, 0) === 100, "percentages do not add up to 100");

/** The starter templates the model picks: exactly TEMPLATE_PICKS distinct ids of the catalog */
export const TemplatePicksSchema = z
  .array(z.enum(REPORT_TEMPLATES.map(({ id }) => id) as [string, ...string[]]))
  .length(TEMPLATE_PICKS)
  .refine((ids) => new Set(ids).size === ids.length, "ids repeat");

/** The explanations of the report. Every part is optional: a report kept before a part existed still reads. */
export const ExplanationsSchema = z.strictObject({
  warningReasons: WarningReasonsSchema.optional(),
  areaReasons: AreaReasonsSchema.optional(),
  timeToOpen: TimeToOpenSchema.optional(),
  costBreakdown: CostBreakdownSchema.optional(),
  templates: TemplatePicksSchema.optional(),
});

export const ReportSchema = z.strictObject({
  input: InputSchema,
  answers: z.array(AnswerSchema).max(MAX_ANSWERS),
  jev: JevSchema,
  phase2: Phase2Schema.optional(),
  profile: ProfileSchema,
  validation: ValidationSchema,
  explanations: ExplanationsSchema.optional(),
  /** The glance at the top of the report (glance.ts). Optional: reports kept before it have none. */
  glance: GlanceSchema.optional(),
  /** The two clarity metrics (clarity.ts). Optional: reports kept before them, or without a glance, have none. */
  clarity: ClaritySchema.optional(),
});

export type Report = z.infer<typeof ReportSchema>;
export type Explanations = z.infer<typeof ExplanationsSchema>;
export type ReportCode = "too_large" | "invalid_json" | "invalid_report";
export type ParseReportResult = { ok: true; report: Report } | { ok: false; code: ReportCode };

/** Reads a report from its text. Never throws: a bad report is a code, and nothing of its content is returned. */
export function parseReport(raw: unknown): ParseReportResult {
  if (typeof raw !== "string") return { ok: false, code: "invalid_json" };
  if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) return { ok: false, code: "too_large" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  if (typeof value === "object" && value !== null && "input" in value) {
    (value as { input: unknown }).input = fromLegacyInput((value as { input: unknown }).input);
  }
  const result = ReportSchema.safeParse(value);
  return result.success ? { ok: true, report: result.data } : { ok: false, code: "invalid_report" };
}
