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
import { RANGES, MAX_ANSWERS, MAX_IDEA, MAX_TEXT } from "../request.js";
import { CLAIM_KEYS } from "../planner/planner-validation-handler.js";
import { CHECK_KEYS, GROUPS } from "../planner/planner-validation-handler.js";
import { DIMENSION_KEYS, DIMENSION_OPTIONS } from "../planner/planner-profile-handler.js";
import { GlanceSchema } from "./glance.js";
import {
  MAX_CURRENCY,
  MAX_EXPLAINED_AREAS,
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
  budget: num(RANGES.budget[0], RANGES.budget[1]),
  experience: num(RANGES.experience[0], RANGES.experience[1]),
  team: num(RANGES.team[0], RANGES.team[1]),
  hours: num(RANGES.hours[0], RANGES.hours[1]),
});

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

/** Why each shown warning and key area matters here. Optional: reports kept before it have none. */
export const ExplanationsSchema = z.strictObject({
  warningReasons: z
    .array(z.strictObject({ key: z.enum(CHECK_KEYS as [string, ...string[]]), reason: ReasonSchema }))
    .max(MAX_EXPLAINED_WARNINGS),
  areaReasons: z
    .array(z.strictObject({ name: z.enum(AREA_NAMES as [string, ...string[]]), reason: ReasonSchema }))
    .max(MAX_EXPLAINED_AREAS),
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
  const result = ReportSchema.safeParse(value);
  return result.success ? { ok: true, report: result.data } : { ok: false, code: "invalid_report" };
}
