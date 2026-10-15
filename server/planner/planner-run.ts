/**
 * One planner run, as a function: Jev, then phase 2 or the final report. The server calls it for each
 * job; it receives everything it needs as parameters and reaches no HTTP object.
 *
 * When a run ends with a report (the final request, or the first round without questions), the report is
 * built from the values this run had: the input and answers it received, its Jev result, its phase 2
 * analysis and the profile and validation computed from them. The analysis claims of the final request are
 * the one exception: the browser sends them back, so they are not from the server's own values (see report.ts).
 * The report is kept in the reports repository and the result carries its reportId. A report that cannot be
 * kept does not fail the run: only its code is logged.
 */

import type { PlannerStage } from "./stages.js";
import type { FieldAnalysis, Phase2Response } from "./planner-phase2-handler.js";
import type { ReportRepository } from "../plan/report-repository.js";
import type { Diagnosis, Explanations, Report } from "../plan/report.js";
import { parseGlance, type Glance } from "../plan/glance.js";
import { buildChecks } from "../plan/checks.js";
import { improveAnswersOf } from "../plan/improve-questions.js";
import { applyDiagnosisText, baseDiagnosis } from "../plan/diagnosis-text.js";
import { computeClarity, type Clarity } from "../plan/clarity.js";
import { buildExecution } from "../plan/execution.js";
import type { Profile } from "./planner-profile-handler.js";
import {
  MAX_CURRENCY,
  MAX_PHASE2_LIST,
  MAX_PHASE2_OPTIONS,
  MAX_PHASE2_QUESTIONS,
  MAX_PHASE2_TEXT,
  MAX_PHASE2_TOPIC,
  MAX_SCORE,
} from "../plan/report.js";
import type { JevResponse, PlannerInput } from "./planner-handler.js";
import { analyzeWithJev, isUnknown } from "./planner-handler.js";
import { analyzePhase2, type PlannerAnswer } from "./planner-phase2-handler.js";
import { explainDiagnosis, explainReport } from "./planner-explain-handler.js";
import { analyzeProfile } from "./planner-profile-handler.js";
import { selectQuestions } from "./question-policy.js";
import {
  analyzeValidation,
  claimsFromPhase2,
  departmentLevel,
  type Claims,
} from "./planner-validation-handler.js";

/**
 * A text cut to at most `max` UTF-16 units, on whole characters (a pair of surrogates is never split), with
 * the NUL character removed. It never throws. Used for the report only: the answer itself is not changed.
 */
export function fitText(value: string, max: number): string {
  let out = "";
  for (const character of value.replaceAll("\u0000", "")) {
    if (out.length + character.length > max) break;
    out += character;
  }
  return out;
}

const fitScore = (value: number): number => (Number.isFinite(value) ? Math.min(MAX_SCORE, Math.max(0, Math.round(value))) : 0);
const fitNumber = (value: number | null): number | null => (value !== null && Number.isFinite(value) ? value : null);

/**
 * The phase 2 part as the report keeps it: every text, list and question is cut to the limits of the report
 * (report.ts), and a question left empty is dropped. The plan does not read phase 2, so cutting it can never
 * change a plan, and no phase 2 answer of the planner can stop a report from being kept.
 */
export function fitPhase2(phase2: Phase2Response): NonNullable<Report["phase2"]> {
  const field = (item: FieldAnalysis) => ({
    value: fitText(item.value, MAX_PHASE2_TEXT),
    source: item.source,
    confidence: fitScore(item.confidence),
  });
  const list = (items: string[]) => items.slice(0, MAX_PHASE2_LIST).map((item) => fitText(item, MAX_PHASE2_TEXT));
  const questions = phase2.questions
    .flatMap((item) => {
      const question = fitText(item.question, MAX_PHASE2_TEXT).trim();
      if (question === "") return [];
      return [
        {
          topic: fitText(item.topic, MAX_PHASE2_TOPIC).trim(),
          question,
          options: item.options.slice(0, MAX_PHASE2_OPTIONS).map((option) => fitText(option, MAX_PHASE2_TEXT)),
        },
      ];
    })
    .slice(0, MAX_PHASE2_QUESTIONS);

  return {
    maturity: phase2.maturity,
    subsector: field(phase2.subsector),
    location: field(phase2.location),
    target_customer: field(phase2.target_customer),
    value_proposition: field(phase2.value_proposition),
    revenue_model: field(phase2.revenue_model),
    stage: field(phase2.stage),
    competition: field(phase2.competition),
    constraints: {
      budget: {
        min: fitNumber(phase2.constraints.budget.min),
        max: fitNumber(phase2.constraints.budget.max),
        currency: fitText(phase2.constraints.budget.currency, MAX_CURRENCY),
        fits: fitText(phase2.constraints.budget.fits, MAX_PHASE2_TEXT),
      },
      exclusions: list(phase2.constraints.exclusions),
      risks: list(phase2.constraints.risks),
      assumptions: list(phase2.constraints.assumptions),
    },
    questions,
  };
}

/**
 * The glance of a run that has its phase 2: built from that phase 2 (fitted, as the report keeps it), never
 * from the browser. Undefined when the glance does not pass its schema (glance.ts), so it is left out.
 */
export function glanceOf(phase2: Phase2Response): Glance | undefined {
  const fitted = fitPhase2(phase2);
  return parseGlance({
    maturity: fitted.maturity,
    subsectorSource: fitted.subsector.source,
    location: { value: fitted.location.value, source: fitted.location.source },
    budget: fitted.constraints.budget,
    sources: {
      target_customer: fitted.target_customer.source,
      value_proposition: fitted.value_proposition.source,
      revenue_model: fitted.revenue_model.source,
      stage: fitted.stage.source,
      competition: fitted.competition.source,
    },
    // From the model's own parts, checked against Mando's catalog (fitPhase2 does not keep them)
    ...(() => {
      const execution = buildExecution(phase2.execution);
      return execution ? { execution } : {};
    })(),
  });
}

/**
 * The glance as the run uses it: with an "I don't know" for the budget there is nothing to fit, so the
 * sentence on how the budget fits is emptied (the range the idea needs stays).
 */
export function glanceFor(input: PlannerInput, glance: Glance | undefined): Glance | undefined {
  if (!glance || !isUnknown(input, "budget") || glance.budget.fits === "") return glance;
  return { ...glance, budget: { ...glance.budget, fits: "" } };
}

/**
 * The clarity of a run, from its glance (the sources of phase 2), its profile, the fixed questions and the
 * topics answered. Without a glance that carries the sources there is no clarity: the report goes without it.
 * The first round and the final request read the same fields, so the same data gives the same clarity.
 */
export function clarityOf(input: PlannerInput, answers: PlannerAnswer[], profile: Profile, glance?: Glance): Clarity | undefined {
  if (!glance?.sources) return undefined;
  return computeClarity({
    phase2: { subsector: glance.subsectorSource, location: glance.location.source, ...glance.sources },
    profile: profile.values,
    unknownInputs: input.unknown ?? [],
    topics: answers.map(({ topic }) => topic),
  });
}

/**
 * The report of a run, from the values of the run. The phase 2 part is included only when the run had one,
 * and it is fitted to the report's limits. The glance and the explanations are included only when there are
 * (the explanations only when the model gave usable ones, planner-explain-handler.ts). Pure: the caller decides where it is kept.
 */
export function reportOf(
  input: PlannerInput,
  answers: PlannerAnswer[],
  jev: JevResponse,
  built: Awaited<ReturnType<typeof buildReport>>,
  phase2?: Phase2Response,
  explanations?: Explanations,
  glance?: Glance,
  diagnosis?: Diagnosis,
  clarity?: Clarity,
) {
  return {
    input,
    answers,
    jev,
    ...(phase2 && { phase2: fitPhase2(phase2) }),
    ...built,
    ...(explanations && { explanations }),
    ...(glance && { glance }),
    ...(diagnosis && { diagnosis }),
    ...(clarity && { clarity }),
  };
}

/** The answers of "Improve my report" in the request, kept in the report by their question (improve-questions.ts) */
function withImprove<T extends object>(report: T, answers: PlannerAnswer[], jev: JevResponse): T & { improveAnswers?: Record<string, string> } {
  const improveAnswers = improveAnswersOf(answers, jev.answers.sector?.type === "choice" ? jev.answers.sector.choice : undefined);
  return Object.keys(improveAnswers).length ? { ...report, improveAnswers } : report;
}

/**
 * The diagnosis of a final run before its text: the five checks from the run's values (plan/checks.ts), and the
 * default words of each (plan/diagnosis-text.ts). The money range is the glance's, the only range a final request
 * has, and the split comes from the glance's execution. The model's words are added by applyDiagnosisText.
 */
export function diagnosisOf(input: PlannerInput, jev: JevResponse, built: Awaited<ReturnType<typeof buildReport>>, glance?: Glance): Diagnosis {
  const checks = buildChecks({
    budget: input.budget,
    founderProfile: built.profile.values.founder_profile,
    range: glance && { min: glance.budget.min },
    regulatoryLoad: built.profile.values.regulatory_load,
    jev: jev.answers,
  });
  return baseDiagnosis(input.idea, checks, glance?.execution);
}

/** Last step: classify the profile and validate the analysis, both at once */
export async function buildReport(
  input: PlannerInput,
  jev: JevResponse,
  answers: PlannerAnswer[],
  claims: Claims,
  phase2?: Phase2Response,
) {
  const [profile, validation] = await Promise.all([
    analyzeProfile(input, jev, phase2, answers),
    analyzeValidation(input, jev, claims, answers),
  ]);
  return { profile, validation: { ...validation, level: departmentLevel(profile) } };
}

export interface PlannerRunOptions {
  /** Where the report is kept. Without it, no report is kept and the result has no reportId. */
  reports?: ReportRepository;
  /** The user the report belongs to */
  owner: string;
  /** Aborted when the person cancels the analysis: the run stops, and no report is kept for it */
  signal?: AbortSignal;
  /** A Jev result made from the same idea by the detection: reused instead of asking Jev again */
  jev?: JevResponse;
  /** Told each step of the run as it starts, for the browser to show while it waits */
  report?: (stage: PlannerStage) => void;
}

/** Keeps a report and returns its id; on failure, logs the code only and returns no id */
async function keepReport(options: PlannerRunOptions, report: object): Promise<{ reportId?: string }> {
  if (!options.reports) return {};
  // A cancelled run keeps nothing: this throws, and the job has no result to give anyway
  options.signal?.throwIfAborted();
  try {
    return { reportId: await options.reports.create(options.owner, report) };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    console.error("Report not kept:", typeof code === "string" ? code : "unknown");
    return {};
  }
}

/**
 * One planner run: Jev, then phase 2 or the final report. Returns the response body. The glance is the one the
 * browser sends with a final request (already checked by parsePlannerRequest); it is not used otherwise.
 */
export async function runPlanner(
  input: PlannerInput,
  answers: PlannerAnswer[],
  final: boolean,
  claims: Claims,
  options: PlannerRunOptions,
  sentGlance?: Glance,
) {
  options.report?.("reading");
  const jev = options.jev ?? (await analyzeWithJev(input, options.signal));

  // Final request: the questions are answered, so only the profile is left (no phase 2 in this report)
  if (final) {
    const glance = glanceFor(input, sentGlance);
    options.report?.("costs");
    const built = await buildReport(input, jev, answers, claims);
    const base = diagnosisOf(input, jev, built, glance);
    const diagnosis = applyDiagnosisText(base, await explainDiagnosis({ input, answers, checks: base.checks, glance }, options.signal));
    const clarity = clarityOf(input, answers, built.profile, glance);
    options.report?.("explaining");
    const explanations = await explainReport(
      { input, answers, validation: built.validation, glance, timeToRevenue: built.profile.values.time_to_revenue },
      options.signal,
    );
    options.report?.("saving");
    return {
      jev,
      ...built,
      ...(explanations && { explanations }),
      ...(glance && { glance }),
      ...(clarity && { clarity }),
      diagnosis,
      ...(await keepReport(options, withImprove(reportOf(input, answers, jev, built, undefined, explanations, glance, diagnosis, clarity), answers, jev))),
    };
  }

  const phase2 = await analyzePhase2(input, jev, answers, options.signal);
  const questions = selectQuestions(phase2.questions, answers);
  // No questions is a valid answer: the browser then shows what was understood, and the final request builds the report
  // The glance goes with the questions (or with none): the browser sends it back with the final request
  const glance = glanceFor(input, glanceOf(phase2));
  return {
    jev,
    phase2: { ...phase2, questions },
    questionTotal: answers.length + questions.length,
    ...(glance && { glance }),
  };
}
