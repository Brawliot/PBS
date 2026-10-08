/**
 * The report of the planner (phase 1) as the plan needs it. The front keeps it in sessionStorage and
 * sends it back, so it is NOT trusted: the schema is strict at every level (extra keys are refused),
 * sizes are limited, and the values of the profile are the real options of each dimension.
 * parseReport never throws: it answers with the report or with a closed code.
 *
 * Later, the server should keep the report and the plan asks for it by id, instead of accepting it
 * from the client. Until then this is the only input of buildPlanSkeleton.
 */

import { z } from "zod";
import { RANGES, MAX_ANSWERS, MAX_IDEA, MAX_TEXT } from "../request.js";
import { CLAIM_KEYS } from "../planner/planner-validation-handler.js";
import { CHECK_KEYS } from "../planner/planner-validation-handler.js";
import { DIMENSION_KEYS, DIMENSION_OPTIONS } from "../planner/planner-profile-handler.js";

/** Largest report accepted, in bytes of text: the front sends one report, never a stream */
export const MAX_REPORT_BYTES = 200_000;
export const MAX_JEV_ANSWERS = 40;
export const MAX_PHASE2_LIST = 20;
export const MAX_PHASE2_TEXT = 1000;

const num = (min: number, max: number) => z.number().min(min).max(max);
const text = (max: number) => z.string().trim().min(1).max(max);
const SCORE = z.number().int().min(0).max(100);

const InputSchema = z.strictObject({
  idea: text(MAX_IDEA),
  budget: num(RANGES.budget[0], RANGES.budget[1]),
  experience: num(RANGES.experience[0], RANGES.experience[1]),
  team: num(RANGES.team[0], RANGES.team[1]),
  hours: num(RANGES.hours[0], RANGES.hours[1]),
});

const AnswerSchema = z.strictObject({ topic: text(100), question: text(MAX_TEXT), answer: text(MAX_TEXT) });

const JevAnswerSchema = z.strictObject({
  type: z.enum(["choice", "score", "noul"]),
  choice: text(200).optional(),
  score: z.number().optional(),
  noul: z.number().optional(),
});

const JevSchema = z.strictObject({
  model: z.string().max(100).optional(),
  // The key is the question of Jev (sector, timeline...): a short word, never free text
  answers: z
    .record(z.string().regex(/^[a-z_]{1,40}$/), JevAnswerSchema)
    .refine((answers) => Object.keys(answers).length <= MAX_JEV_ANSWERS, "too many answers"),
  usage: z.strictObject({ input_tokens: z.number().int().min(0), output_tokens: z.number().int().min(0) }).optional(),
});

const FieldSchema = z.strictObject({
  value: z.string().max(MAX_PHASE2_TEXT),
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
      currency: z.string().max(10),
      fits: z.string().max(MAX_PHASE2_TEXT),
    }),
    exclusions: z.array(z.string().max(MAX_PHASE2_TEXT)).max(MAX_PHASE2_LIST),
    risks: z.array(z.string().max(MAX_PHASE2_TEXT)).max(MAX_PHASE2_LIST),
    assumptions: z.array(z.string().max(MAX_PHASE2_TEXT)).max(MAX_PHASE2_LIST),
  }),
  questions: z
    .array(
      z.strictObject({
        topic: text(100),
        question: text(MAX_PHASE2_TEXT),
        options: z.array(z.string().max(MAX_PHASE2_TEXT)).max(4),
      }),
    )
    .max(4),
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
  name: text(120),
  confidence: SCORE,
  tier: z.enum(["core", "important", "light"]),
});

const ValidationSchema = z.strictObject({
  unsupported: z.array(z.enum([...CLAIM_KEYS] as [string, ...string[]])).max(CLAIM_KEYS.length),
  warnings: z.array(z.enum([...CHECK_KEYS] as [string, ...string[]])).max(CHECK_KEYS.length),
  departments: z.array(ScoredSchema).max(20),
  groups: z.array(ScoredSchema).max(20),
  level: z.union([z.literal(1), z.literal(2)]),
});

export const ReportSchema = z.strictObject({
  input: InputSchema,
  answers: z.array(AnswerSchema).max(MAX_ANSWERS),
  jev: JevSchema,
  phase2: Phase2Schema.optional(),
  profile: ProfileSchema,
  validation: ValidationSchema,
});

export type Report = z.infer<typeof ReportSchema>;
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
