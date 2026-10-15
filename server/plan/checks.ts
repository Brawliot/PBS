/**
 * The five checks of the diagnosis (report.ts, DiagnosisSchema). Two of them are rules, read from the values of
 * the run; three are Jev's judgement, read from its answers (JEV_QUESTIONS in planner-handler.ts). No text model
 * decides a status: a check that Jev did not answer, or answered with a value that is not a status, is watch.
 *
 * Every number of a rule is in CHECK_RULES, and nowhere else.
 */

import type { JevAnswer } from "../planner/planner-handler.js";
import { HEAVY_REGULATION } from "./plan-skeleton.js";
import type { Diagnosis } from "./report.js";
import { DIAGNOSIS_CHECK_STATUS, type DiagnosisCheckStatus, type DiagnosisDecidedBy } from "./diagnosis-enums.js";

export const CHECK_RULES = {
  money: {
    /** A budget at or above this share of the minimum the idea needs is watch; below it, risk */
    watchShare: 0.75,
  },
  experience: {
    /** Years of experience in the form that count as experience */
    minYears: 1,
  },
} as const;

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
 * business is treated as having none. Otherwise the years in the form decide it. Undefined when neither rule
 * decides: Jev judges the idea then.
 */
export function experienceCheck(years: number, regulated: boolean): CheckResult | undefined {
  if (regulated) return result("risk", "rule", false);
  if (years >= CHECK_RULES.experience.minYears) return result("strong", "rule", false);
  return undefined;
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
  years: number;
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
  const experience = experienceCheck(inputs.years, regulated) ?? jevCheck(inputs.jev.experience);
  return [
    { key: "concept", ...jevCheck(inputs.jev.concept) },
    { key: isOnline(scope) ? "reach" : "location", ...jevCheck(inputs.jev.location) },
    { key: "money", ...moneyCheck(inputs.budget, inputs.range) },
    { key: "experience", ...experience },
    { key: "competition", ...jevCheck(inputs.jev.competition) },
  ] as Diagnosis["checks"];
}
