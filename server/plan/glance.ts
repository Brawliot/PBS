/**
 * The glance: the few facts the report shows at its top (idea maturity, the business and the place with where
 * each one came from, the budget range and how it fits). Its fields are all in phase 2 of the first round, so
 * the server keeps them from its own phase 2 when it has one. A final request has no phase 2 on the server:
 * the browser sends the glance back, and it is kept only if it passes this schema. Nothing is repaired: a glance
 * that does not pass is dropped whole, and the request or the run goes on without it.
 *
 * `sources` carries where the other phase 2 fields came from, for the clarity of the report (clarity.ts). It is
 * optional, so a glance kept before it still reads; without it the report simply has no clarity.
 *
 * `execution` says who does each part of the business (Mando, the person, or someone hired) and what it adds up
 * to. Its sums must be the sums of its parts, so a glance sent back cannot carry other totals.
 */

import { z } from "zod";
import { MAX_CURRENCY, MAX_GLANCE_MONEY, MAX_PHASE2_TEXT } from "./report-limits.js";
import { ExecutionSchema } from "./execution.js";

const SOURCE = z.enum(["stated", "inferred", "unknown"]);

/** The phase 2 fields whose source only the clarity reads (the subsector and the location have their own above) */
export const GLANCE_SOURCE_KEYS = ["target_customer", "value_proposition", "revenue_model", "stage", "competition"] as const;
/** Plain text: no NUL (PostgreSQL's jsonb refuses it), and the limit of the phase 2 text it comes from */
const plainText = (max: number) => z.string().max(max).refine((value) => !value.includes("\u0000"), "NUL is not allowed");
const money = z.number().finite().min(0).max(MAX_GLANCE_MONEY).nullable();

export const GlanceSchema = z.strictObject({
  maturity: z.enum(["vague", "developing", "advanced"]),
  subsectorSource: SOURCE,
  location: z.strictObject({ value: plainText(MAX_PHASE2_TEXT), source: SOURCE }),
  budget: z
    .strictObject({
      min: money,
      max: money,
      currency: plainText(MAX_CURRENCY),
      fits: plainText(MAX_PHASE2_TEXT),
    })
    .refine(({ min, max }) => min === null || max === null || min <= max, "min is above max"),
  sources: z.strictObject(Object.fromEntries(GLANCE_SOURCE_KEYS.map((key) => [key, SOURCE])) as Record<(typeof GLANCE_SOURCE_KEYS)[number], typeof SOURCE>).optional(),
  /** Who does each part, with its sums (execution.ts). Optional: a glance kept before it still reads. */
  execution: ExecutionSchema.optional(),
});

export type Glance = z.infer<typeof GlanceSchema>;

/** The glance, or undefined when it does not pass. Never throws, and never returns a repaired value. */
export function parseGlance(raw: unknown): Glance | undefined {
  const result = GlanceSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
