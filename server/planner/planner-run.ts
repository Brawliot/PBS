/**
 * One planner run, as a function: Jev, then phase 2 or the final report. The server calls it for each
 * job; it receives everything it needs as parameters and reaches no HTTP object.
 *
 * When a run ends with a report (the final request, or the first round without questions), the report is
 * built from the values of this run, never from the client, and kept in the reports repository. The result
 * then carries its reportId. A report that cannot be kept does not fail the run: only its code is logged.
 */

import type { ReportRepository } from "../plan/report-repository.js";
import type { JevResponse, PlannerInput } from "./planner-handler.js";
import { analyzeWithJev } from "./planner-handler.js";
import { analyzePhase2, type Phase2Response, type PlannerAnswer } from "./planner-phase2-handler.js";
import { analyzeProfile } from "./planner-profile-handler.js";
import { questionLimit, selectQuestions } from "./question-policy.js";
import {
  analyzeValidation,
  claimsFromPhase2,
  departmentLevel,
  type Claims,
} from "./planner-validation-handler.js";

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
}

/** Keeps a report and returns its id; on failure, logs the code only and returns no id */
async function keepReport(options: PlannerRunOptions, report: object): Promise<{ reportId?: string }> {
  if (!options.reports) return {};
  try {
    return { reportId: await options.reports.create(options.owner, report) };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    console.error("Report not kept:", typeof code === "string" ? code : "unknown");
    return {};
  }
}

/** One planner run: Jev, then phase 2 or the final report. Returns the response body. */
export async function runPlanner(
  input: PlannerInput,
  answers: PlannerAnswer[],
  final: boolean,
  claims: Claims,
  options: PlannerRunOptions,
) {
  const jev = await analyzeWithJev(input);

  // Final request: the questions are answered, so only the profile is left (no phase 2 in this report)
  if (final) {
    const built = await buildReport(input, jev, answers, claims);
    return { jev, ...built, ...(await keepReport(options, { input, answers, jev, ...built })) };
  }

  const phase2 = await analyzePhase2(input, jev, answers);
  const questions = selectQuestions(
    phase2.questions,
    answers,
    questionLimit(phase2.maturity, input),
  );
  if (questions.length === 0) {
    const built = await buildReport(input, jev, answers, claimsFromPhase2(phase2), phase2);
    const withPhase2 = { ...phase2, questions };
    return { jev, phase2: withPhase2, ...built, ...(await keepReport(options, { input, answers, jev, phase2: withPhase2, ...built })) };
  }
  return {
    jev,
    phase2: { ...phase2, questions },
    questionTotal: answers.length + questions.length,
  };
}
