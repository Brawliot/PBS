/**
 * The five checks of the diagnosis (report.ts, DiagnosisSchema). Two of them are rules, read from the values of
 * the run; three are Jev's judgement, read from its answers (JEV_QUESTIONS in planner-handler.ts). No text model
 * decides a status: a check that Jev did not answer, or answered with a value that is not a status, is watch.
 *
 * Every number of a rule is in CHECK_RULES, and nowhere else.
 */

import type { JevAnswer } from "../planner/planner-handler.js";
import { IMPROVE_BANK, PLAN_TASK, effectOfAnswer, type ImproveEffect } from "./improve-questions.js";
import { HEAVY_REGULATION } from "./plan-skeleton.js";
import type { Diagnosis } from "./report.js";
import { DIAGNOSIS_CHECK_STATUS, type DiagnosisCheckStatus, type DiagnosisDecidedBy } from "./diagnosis-enums.js";

export const CHECK_RULES = {
  money: {
    /** A budget at or above this share of the minimum the idea needs is watch; below it, risk */
    watchShare: 0.75,
    /**
     * A confirmed cushion or financing (Improve my report) counts as this share of the minimum, added to the budget,
     * and the money rule decides again. A proposal, not measured.
     */
    cushionShare: 0.25,
  },
} as const;

/**
 * Experience from the founder profile (the "What can the user do themselves?" dimension). "Not specified" is no
 * answer: Jev judges the idea then. A regulated profession is risk whatever the profile says (see experienceCheck).
 */
const EXPERIENCE_BY_FOUNDER_PROFILE: Record<string, DiagnosisCheckStatus | undefined> = {
  "Sector expert": "strong",
  Technical: "watch",
  Commercial: "watch",
  Management: "watch",
  "Several areas": "watch",
  "No relevant background": "risk",
  "Not specified": undefined,
};

/** The text of a check: a default by status, since the rules and Jev give no text of their own yet */
export const DEFAULT_WHY: Record<DiagnosisCheckStatus, string> = {
  strong: "Nothing here stops the idea from starting.",
  watch: "This needs attention before the business opens.",
  risk: "This could stop the business unless it is solved first.",
};

export interface CheckResult {
  status: DiagnosisCheckStatus;
  why: string;
  estimated: boolean;
  decidedBy: DiagnosisDecidedBy;
}

const result = (status: DiagnosisCheckStatus, decidedBy: DiagnosisDecidedBy, estimated: boolean): CheckResult => ({
  status,
  why: DEFAULT_WHY[status],
  estimated,
  decidedBy,
});

/** The money range the idea needs. Its minimum is null when the range has none. */
export interface BudgetRange {
  min: number | null;
}

/**
 * Money: the budget against the minimum the idea needs. Always estimated, since the range is an estimate.
 * No range, or a range without a minimum, is watch: there is nothing to compare against.
 */
export function moneyCheck(budget: number, range: BudgetRange | undefined): CheckResult {
  if (range === undefined || range.min === null) return result("watch", "rule", true);
  const { min } = range;
  if (budget >= min) return result("strong", "rule", true);
  if (budget >= min * CHECK_RULES.money.watchShare) return result("watch", "rule", true);
  return result("risk", "rule", true);
}

/**
 * Experience: a regulated profession is risk, always, since its credentials are not captured and a regulated
 * business is treated as having none. Otherwise the founder profile decides it. Undefined when neither rule
 * decides: Jev judges the idea then.
 */
export function experienceCheck(founderProfile: string, regulated: boolean): CheckResult | undefined {
  if (regulated) return result("risk", "rule", false);
  const status = EXPERIENCE_BY_FOUNDER_PROFILE[founderProfile];
  return status === undefined ? undefined : result(status, "rule", false);
}

/** A status from Jev's answer ("Strong", "Watch" or "Risk", in any case). Anything else, or no answer, is watch. */
export function jevCheck(answer: JevAnswer | undefined): CheckResult {
  const choice = answer?.type === "choice" ? answer.choice?.toLowerCase() : undefined;
  const status = DIAGNOSIS_CHECK_STATUS.find((value) => value === choice);
  return status ? result(status, "jev", true) : result("watch", "jev", true);
}

/** Whether the geographic scope is online: then the second check is the reach, not the location */
export function isOnline(scope: string | undefined): boolean {
  return scope === "Online" || scope === "Global";
}

export interface CheckInputs {
  budget: number;
  /** The founder profile value of the profile (planner-profile-handler.ts): what the person can do themselves */
  founderProfile: string;
  /** The money range the idea needs, from phase 2 or from the glance */
  range: BudgetRange | undefined;
  /** The regulation of the profile: a heavy one makes a profession regulated */
  regulatoryLoad: string;
  /** The answers of Jev, by question key */
  jev: Record<string, JevAnswer | undefined>;
}

/** The five checks in their order. The second is reach for an online business, location otherwise. */
export function buildChecks(inputs: CheckInputs): Diagnosis["checks"] {
  const regulated = HEAVY_REGULATION.has(inputs.regulatoryLoad);
  const scope = inputs.jev.geographic_scope?.type === "choice" ? inputs.jev.geographic_scope.choice : undefined;
  const experience = experienceCheck(inputs.founderProfile, regulated) ?? jevCheck(inputs.jev.experience);
  return [
    { key: "concept", ...jevCheck(inputs.jev.concept) },
    { key: isOnline(scope) ? "reach" : "location", ...jevCheck(inputs.jev.location) },
    { key: "money", ...moneyCheck(inputs.budget, inputs.range) },
    { key: "experience", ...experience },
    { key: "competition", ...jevCheck(inputs.jev.competition) },
  ] as Diagnosis["checks"];
}

// ---- Improve my report: the answers move the states (applyImprove)

const STATUS_RANK = { risk: 0, watch: 1, strong: 2 } as const;
const EFFECT_RANK: Record<ImproveEffect, number> = { none: 0, gap: 1, partial: 2, good: 3 };
/** One level up: risk to watch, watch to strong, strong stays */
const oneUp = (status: DiagnosisCheckStatus): DiagnosisCheckStatus => (status === "risk" ? "watch" : status === "watch" ? "strong" : status);
const higher = (a: DiagnosisCheckStatus, b: DiagnosisCheckStatus) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

/** What the answers of one category say: the best effect, whether a gap was named, its plan task, a cushion */
interface CategoryAnswers {
  effect: ImproveEffect;
  identified: boolean;
  planTask: string | null;
  cushion: boolean;
}

/**
 * The answers of "Improve my report" move the states, once each check (never lower than before):
 * - good: one level up. Money from a cushion or financing is decided again by the money rule, with the cushion
 *   counted as CHECK_RULES.money.cushionShare of the minimum (the rule decides, not a step).
 * - partial: a risk becomes a watch; a watch stays.
 * - gap ("I don't know yet", "Not decided yet", "No", "Not yet"): a risk becomes a watch, and the check is
 *   identified. It never becomes strong, and an identified check that is strong is not marked.
 * - none, or no answer: no change.
 * Several answers in one category count as the best one. A check is never lowered.
 */
export function applyImprove(
  checks: Diagnosis["checks"],
  answers: Record<string, string>,
  options: { sector?: string; money: { budget: number; range: BudgetRange | undefined } },
): Diagnosis["checks"] {
  const groups = new Map<string, CategoryAnswers>();
  for (const [key, label] of Object.entries(answers)) {
    const question = IMPROVE_BANK.find((item) => item.key === key);
    const effect = question && effectOfAnswer(key, label, options.sector);
    if (!question || !effect || effect === "none") continue;
    const group = groups.get(question.category) ?? { effect: "none" as ImproveEffect, identified: false, planTask: null, cushion: false };
    if (EFFECT_RANK[effect] > EFFECT_RANK[group.effect]) group.effect = effect;
    if (effect === "gap") {
      group.identified = true;
      group.planTask ??= PLAN_TASK[key] ?? null;
    }
    if (effect === "good" && (key === "imp_money_cushion" || key === "imp_money_financing")) group.cushion = true;
    groups.set(question.category, group);
  }

  return checks.map((check) => {
    const group = groups.get(check.key);
    let status = check.status;
    if (group) {
      const min = options.money.range?.min;
      if (check.key === "money" && group.effect === "good" && group.cushion && min !== undefined && min !== null) {
        const counted = moneyCheck(options.money.budget + CHECK_RULES.money.cushionShare * min, options.money.range).status;
        status = higher(status, counted);
      } else {
        status = higher(status, group.effect === "good" ? oneUp(status) : status === "risk" ? "watch" : status);
      }
    }
    const identified = !!group?.identified && status !== "strong";
    return { ...check, status, identified, planTask: identified ? group?.planTask ?? null : null };
  }) as Diagnosis["checks"];
}

