/**
 * The words of the diagnosis: the idea in one plain sentence, one reason for each check, and the risks. The
 * statuses are decided before this (checks.ts); the model writes the words, and a word that contradicts its
 * status is replaced by the default sentence of that status and check. Nothing here decides a status.
 *
 * The split ("who does what") is built from the execution (plan/execution.ts), never from the model: a Mando part
 * is only one of the MANDO_BUILDS keys, shown with its own label.
 *
 * Pure: no I/O and no model. Every part is checked on its own: a part that does not pass keeps its default.
 */

import { z } from "zod";
import { MANDO_BUILDS } from "../planner/mando-capabilities.js";
import type { Execution } from "./execution.js";
import type { DiagnosisCheckStatus } from "./diagnosis-enums.js";
import type { Diagnosis } from "./report.js";
import {
  MAX_DIAGNOSIS_IDEA,
  MAX_DIAGNOSIS_RISK,
  MAX_DIAGNOSIS_RISKS,
  MAX_DIAGNOSIS_SPLIT_ITEM,
  MAX_DIAGNOSIS_SPLIT_ITEMS,
  MAX_DIAGNOSIS_WHY,
} from "./report-limits.js";

type CheckKey = Diagnosis["checks"][number]["key"];

/** The reason of each check for each status, when the model's own reason is missing or contradicts the status */
export const DEFAULT_WHY: Record<CheckKey, Record<DiagnosisCheckStatus, string>> = {
  concept: {
    strong: "The idea answers a need its customers already have.",
    watch: "The idea is clear, but it is not yet shown that customers want it.",
    risk: "The idea is vague, or it may not match what customers want.",
  },
  location: {
    strong: "The place has enough of the target customers nearby.",
    watch: "The place works, but it will take effort to bring customers in.",
    risk: "The place has few target customers, or it is hard to reach.",
  },
  reach: {
    strong: "Customers can be reached online with little effort.",
    watch: "Online reach is possible, but customers will have to be found.",
    risk: "Few customers can be reached online for this offer.",
  },
  money: {
    strong: "The budget covers what the idea needs to start.",
    watch: "The budget is close to what the idea needs, with little room.",
    risk: "The budget is well below what the idea needs to start.",
  },
  experience: {
    strong: "The owner already knows this kind of business.",
    watch: "The owner has some skills, but not yet this trade.",
    risk: "The owner has no experience in this trade and no plan to get it.",
  },
  competition: {
    strong: "Few similar businesses compete for the same customers.",
    watch: "Similar businesses exist, and the difference from them is not yet clear.",
    risk: "Many similar businesses offer the same thing, with no clear difference.",
  },
};

/** The risk each check names when it is not strong. The report shows up to three of them. */
export const DEFAULT_RISK: Record<CheckKey, string> = {
  concept: "The idea may not match what customers actually want.",
  location: "Customers may not pass by or find the place.",
  reach: "Customers may not find the online offer.",
  money: "The budget may not cover the first months of costs.",
  experience: "Running the business may need skills the owner does not have yet.",
  competition: "Similar businesses may win the customers first.",
};

const NO_RISK_FOUND = "Costs may end up above the estimate.";

/**
 * Words that contradict a status. A reason that uses one of them for its status is replaced: a Risk never reads as
 * good, a Strong never reads as a problem, and a Watch never reads as settled. A plain list, checked as whole words.
 */
const CONTRADICTS: Record<DiagnosisCheckStatus, RegExp> = {
  strong: /\b(risky|weak|difficult|hard|struggle|struggles|unlikely|problem|problems|obstacle|obstacles|threat|barrier|concern|concerns)\b/i,
  watch: /\b(no risk|no problem|guaranteed|excellent|easy|certain|assured)\b/i,
  risk: /\b(excellent|solid|great|easy|no problem|no risk|guaranteed|well positioned|well placed|strong position|good position|good fit|good chance|secure)\b/i,
};

const noNul = (value: string) => !value.includes("\u0000");
/** Plain text of a part: trimmed, not empty, within its limit, and no NUL (PostgreSQL's jsonb refuses it) */
const text = (max: number) => z.string().trim().min(1).max(max).refine(noNul, "NUL is not allowed");

/** Cut to at most `max` characters (code points, so a pair of surrogates is never split), without NUL */
export const cut = (value: string, max: number): string => Array.from(value.replaceAll("\u0000", "")).slice(0, max).join("").trim();

/** A reason fits its status when it uses none of the words that contradict it */
export const fitsStatus = (why: string, status: DiagnosisCheckStatus): boolean => !CONTRADICTS[status].test(why);

/** The default reason of a check, for its status */
export const defaultWhy = (key: CheckKey, status: DiagnosisCheckStatus): string => DEFAULT_WHY[key][status];

/** The risks when there is no model text: the risks of the checks that are not strong, risk first, at most three */
export function defaultRisks(checks: Diagnosis["checks"]): string[] {
  const ordered = [...checks.filter(({ status }) => status === "risk"), ...checks.filter(({ status }) => status === "watch")];
  const risks = ordered.slice(0, MAX_DIAGNOSIS_RISKS).map(({ key }) => DEFAULT_RISK[key]);
  return risks.length ? risks : [NO_RISK_FOUND];
}

/**
 * The split ("who does what") from the execution: Mando's parts are its catalog labels, the person's and the
 * hired ones are the part names. Each list has at most MAX_DIAGNOSIS_SPLIT_ITEMS items, cut to their limit.
 */
export function splitOf(execution: Execution | undefined): Diagnosis["split"] {
  const items = execution?.items ?? [];
  const list = (who: "mando" | "you" | "outsource") =>
    items
      .filter((item) => item.who === who)
      .map((item) => {
        if (who !== "mando") return cut(item.name, MAX_DIAGNOSIS_SPLIT_ITEM);
        const build = MANDO_BUILDS.find(({ key }) => key === item.mandoKey);
        return build ? cut(build.label, MAX_DIAGNOSIS_SPLIT_ITEM) : null;
      })
      .filter((label): label is string => label !== null && label !== "")
      .slice(0, MAX_DIAGNOSIS_SPLIT_ITEMS);
  return { mando: list("mando"), you: list("you"), outsource: list("outsource") };
}

/**
 * The diagnosis before any model text: the idea as the person wrote it, each check with its default reason, the
 * default risks, and the split from the execution. Always a diagnosis that passes its schema.
 */
export function baseDiagnosis(idea: string, checks: Diagnosis["checks"], execution: Execution | undefined): Diagnosis {
  return {
    idea: cut(idea, MAX_DIAGNOSIS_IDEA) || "Business idea",
    checks: checks.map((check) => ({ ...check, why: defaultWhy(check.key, check.status) })) as Diagnosis["checks"],
    risks: defaultRisks(checks),
    split: splitOf(execution),
  };
}

/** The model's text, each part checked on its own. A part that does not pass is undefined, and the default stays. */
const IdeaReply = text(MAX_DIAGNOSIS_IDEA);
const ChecksReply = z.array(z.strictObject({ key: z.string(), why: text(MAX_DIAGNOSIS_WHY) })).max(6);
const RisksReply = z.array(text(MAX_DIAGNOSIS_RISK)).min(1);

/**
 * The diagnosis with the model's text in it. A reason is kept only when it passes its limit and fits its status;
 * otherwise it is the default of that check and status. The risks are cut to three. Any part of the reply that
 * is not usable (or no reply at all) leaves that part on its default: the result always passes the schema.
 */
export function applyDiagnosisText(base: Diagnosis, reply: unknown): Diagnosis {
  const fields = typeof reply === "object" && reply !== null && !Array.isArray(reply) ? (reply as Record<string, unknown>) : {};

  const idea = IdeaReply.safeParse(fields.idea);
  const checks = ChecksReply.safeParse(fields.checks);
  const risks = RisksReply.safeParse(fields.risks);

  return {
    ...base,
    idea: idea.success ? idea.data : base.idea,
    checks: base.checks.map((check) => {
      const entry = checks.success ? checks.data.find(({ key }) => key === check.key) : undefined;
      const why = entry && fitsStatus(entry.why, check.status) ? entry.why : defaultWhy(check.key, check.status);
      return { ...check, why };
    }) as Diagnosis["checks"],
    risks: risks.success ? risks.data.slice(0, MAX_DIAGNOSIS_RISKS) : base.risks,
  };
}
