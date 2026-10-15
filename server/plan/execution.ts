/**
 * Who does each part of the business, and what it adds up to: the money the person pays, the money Mando saves
 * them and the hours a week left for them. The model proposes the parts (phase 2, "execution"); this module checks
 * them against Mando's catalog (mando-capabilities.ts) and adds them up. No model says a total.
 *
 * Pure: no I/O and no model. The rules:
 * - a part said to be done by Mando that is not in the catalog is not Mando's: it becomes the person's, or hired
 *   out when it costs money (the model claimed something Mando does not do);
 * - a part done by Mando costs the person nothing: its money is what it would cost without Mando (the saving);
 * - hours count only for the person's own parts.
 */

import { z } from "zod";
import { MANDO_KEYS } from "../planner/mando-capabilities.js";
import { MAX_GLANCE_MONEY } from "./report-limits.js";

export const MAX_EXECUTION_ITEMS = 8;
export const MAX_EXECUTION_NAME = 120;
export const MAX_EXECUTION_REASON = 240;
export const MAX_HOURS_WEEK = 80;

export const WHO = ["mando", "you", "outsource"] as const;
export type Who = (typeof WHO)[number];

/** One part as the model writes it (phase 2) */
export interface RawExecutionItem {
  name: string;
  who: string;
  mando_key: string;
  cost_min: number | null;
  cost_max: number | null;
  hours_week: number | null;
  reason: string;
}

const noNul = (value: string) => !value.includes("\u0000");
const money = z.number().int().min(0).max(MAX_GLANCE_MONEY).nullable();

export const ExecutionItemSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_EXECUTION_NAME).refine(noNul),
  who: z.enum(WHO),
  /** The catalog key, only for Mando's parts */
  mandoKey: z.enum(MANDO_KEYS).nullable(),
  costMin: money,
  costMax: money,
  hoursWeek: z.number().int().min(0).max(MAX_HOURS_WEEK).nullable(),
  reason: z.string().max(MAX_EXECUTION_REASON).refine(noNul),
});
export type ExecutionItem = z.infer<typeof ExecutionItemSchema>;

const RangeSchema = z.strictObject({ min: money, max: money }).nullable();

export interface Totals {
  pay: { min: number; max: number } | null;
  saved: { min: number; max: number } | null;
  hours: number | null;
}

export const ExecutionSchema = z
  .strictObject({
    items: z.array(ExecutionItemSchema).max(MAX_EXECUTION_ITEMS),
    /** What the person pays (their own purchases and what they hire out); null when no part has money */
    pay: RangeSchema,
    /** What Mando's parts would cost without Mando */
    saved: RangeSchema,
    /** Hours a week the person's own parts ask; null when none says */
    hours: z.number().int().min(0).max(MAX_HOURS_WEEK * MAX_EXECUTION_ITEMS).nullable(),
  })
  // The totals are always the sums of the items: a glance sent back by the browser cannot carry others
  .refine((execution) => JSON.stringify(totalsOf(execution.items)) === JSON.stringify({ pay: execution.pay, saved: execution.saved, hours: execution.hours }), "totals do not match the items");
export type Execution = z.infer<typeof ExecutionSchema>;

const cut = (value: string, max: number) => [...value.replaceAll("\u0000", "")].join("").slice(0, max).trim();
const amount = (value: number | null): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), MAX_GLANCE_MONEY) : null;

/** One part, checked against the catalog. Null when it has no name. */
export function checkItem(raw: RawExecutionItem): ExecutionItem | null {
  const name = cut(String(raw.name ?? ""), MAX_EXECUTION_NAME);
  if (!name) return null;
  let costMin = amount(raw.cost_min);
  let costMax = amount(raw.cost_max);
  if (costMin !== null && costMax !== null && costMin > costMax) [costMin, costMax] = [costMax, costMin];
  const hours = amount(raw.hours_week);
  const inCatalog = (MANDO_KEYS as readonly string[]).includes(raw.mando_key);
  let who: Who = (WHO as readonly string[]).includes(raw.who) ? (raw.who as Who) : "you";
  // Mando only does what its catalog says: anything else is the person's, or hired out when it costs money
  if (who === "mando" && !inCatalog) who = costMin !== null || costMax !== null ? "outsource" : "you";
  return {
    name,
    who,
    mandoKey: who === "mando" ? (raw.mando_key as ExecutionItem["mandoKey"]) : null,
    costMin,
    costMax,
    hoursWeek: who === "you" && hours !== null ? Math.min(hours, MAX_HOURS_WEEK) : null,
    reason: cut(String(raw.reason ?? ""), MAX_EXECUTION_REASON),
  };
}

/** The sums: the low ends together and the high ends together; a part with one end counts it at both */
function sum(items: ExecutionItem[]): Totals["pay"] {
  const priced = items.filter(({ costMin, costMax }) => costMin !== null || costMax !== null);
  if (!priced.length) return null;
  const total = (pick: (item: ExecutionItem) => number) => Math.min(priced.reduce((all, item) => all + pick(item), 0), MAX_GLANCE_MONEY);
  return {
    min: total((item) => (item.costMin ?? item.costMax) as number),
    max: total((item) => (item.costMax ?? item.costMin) as number),
  };
}

export function totalsOf(items: ExecutionItem[]): Totals {
  const own = items.filter(({ who }) => who === "you");
  const hours = own.filter(({ hoursWeek }) => hoursWeek !== null);
  return {
    pay: sum(items.filter(({ who }) => who !== "mando")),
    saved: sum(items.filter(({ who }) => who === "mando")),
    hours: hours.length ? hours.reduce((all, { hoursWeek }) => all + (hoursWeek as number), 0) : null,
  };
}

/** The execution of a run, from the model's parts. Undefined when no part is usable. */
export function buildExecution(raw: readonly RawExecutionItem[] | undefined): Execution | undefined {
  const items = (raw ?? []).map(checkItem).filter((item): item is ExecutionItem => item !== null).slice(0, MAX_EXECUTION_ITEMS);
  if (!items.length) return undefined;
  return { items, ...totalsOf(items) };
}
