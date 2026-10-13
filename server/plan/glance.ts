/**
 * The glance: the few facts the report shows at its top (idea maturity, the business and the place with where
 * each one came from, the budget range and how it fits). Its fields are all in phase 2 of the first round, so
 * the server keeps them from its own phase 2 when it has one. A final request has no phase 2 on the server:
 * the browser sends the glance back, and it is kept only if it passes this schema. Nothing is repaired: a glance
 * that does not pass is dropped whole, and the request or the run goes on without it.
 */

import { z } from "zod";
import { MAX_CURRENCY, MAX_GLANCE_MONEY, MAX_PHASE2_TEXT } from "./report-limits.js";

const SOURCE = z.enum(["stated", "inferred", "unknown"]);
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
});

export type Glance = z.infer<typeof GlanceSchema>;

/** The glance, or undefined when it does not pass. Never throws, and never returns a repaired value. */
export function parseGlance(raw: unknown): Glance | undefined {
  const result = GlanceSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
