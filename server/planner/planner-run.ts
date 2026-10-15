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

import type { FieldAnalysis, Phase2Response } from "./planner-phase2-handler.js";
import type { ReportRepository } from "../plan/report-repository.js";
import type { Diagnosis, Explanations, Report } from "../plan/report.js";
import { parseGlance, type Glance } from "../plan/glance.js";
import { buildChecks } from "../plan/checks.js";
import {
  MAX_CURRENCY,
  MAX_DIAGNOSIS_IDEA,
  MAX_PHASE2_LIST,
  MAX_PHASE2_OPTIONS,
  MAX_PHASE2_QUESTIONS,
  MAX_PHASE2_TEXT,
  MAX_PHASE2_TOPIC,
  MAX_SCORE,
} from "../plan/report.js";
import type { JevResponse, PlannerInput } from "./planner-handler.js";
import { analyzeWithJev } from "./planner-handler.js";
import { analyzePhase2, type PlannerAnswer } from "./planner-phase2-handler.js";
import { explainReport } from "./planner-explain-handler.js";
import { analyzeProfile } from "./planner-profile-handler.js";
import { questionLimit, selectQuestions } from "./question-policy.js";
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
  };
}

/** Until the risks and the split are worked out, the diagnosis says so in its one risk and keeps its lists empty */
const PROVISIONAL_RISK = "Risks are not analysed yet.";

/**
 * The diagnosis of a final run: the five checks from the run's values (plan/checks.ts), and the idea cut to its
 * limit. The money range is the glance's, the only range a final request has. Its risks and split are provisional.
 */
export function diagnosisOf(input: PlannerInput, jev: JevResponse, built: Awaited<ReturnType<typeof buildReport>>, glance?: Glance): Diagnosis {
  return {
    idea: fitText(input.idea, MAX_DIAGNOSIS_IDEA),
    checks: buildChecks({
      budget: input.budget,
      years: input.experience,
      range: glance && { min: glance.budget.min },
      regulatoryLoad: built.profile.values.regulatory_load,
      jev: jev.answers,
    }),
    risks: [PROVISIONAL_RISK],
    split: { mando: [], you: [], outsource: [] },
  };
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
  return { profile, validation: { ...validation, level: departmentLevel(profile, input) } };
}

export interface PlannerRunOptions {
  /** Where the report is kept. Without it, no report is kept and the result has no reportId. */
  reports?: ReportRepository;
  /** The user the report belongs to */
  owner: string;
  /** Aborted when the person cancels the analysis: the run stops, and no report is kept for it */
  signal?: AbortSignal;
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
  glance?: Glance,
) {
  const jev = await analyzeWithJev(input, options.signal);

  // Final request: the questions are answered, so only the profile is left (no phase 2 in this report)
  if (final) {
    const built = await buildReport(input, jev, answers, claims);
    const explanations = await explainReport({ input, answers, validation: built.validation }, options.signal);
    const diagnosis = diagnosisOf(input, jev, built, glance);
    return {
      jev,
      ...built,
      ...(explanations && { explanations }),
      ...(glance && { glance }),
      ...(await keepReport(options, reportOf(input, answers, jev, built, undefined, explanations, glance, diagnosis))),
    };
  }

  const phase2 = await analyzePhase2(input, jev, answers, options.signal);
  const questions = selectQuestions(
    phase2.questions,
    answers,
    questionLimit(phase2.maturity, input),
  );
  if (questions.length === 0) {
    const built = await buildReport(input, jev, answers, claimsFromPhase2(phase2), phase2);
    const withPhase2 = { ...phase2, questions };
    const explanations = await explainReport({ input, answers, validation: built.validation, phase2 }, options.signal);
    const glance = glanceOf(withPhase2);
    return {
      jev,
      phase2: withPhase2,
      ...built,
      ...(explanations && { explanations }),
      ...(glance && { glance }),
      ...(await keepReport(options, reportOf(input, answers, jev, built, withPhase2, explanations, glance))),
    };
  }
  return {
    jev,
    phase2: { ...phase2, questions },
    questionTotal: answers.length + questions.length,
  };
}
