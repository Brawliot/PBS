/**
 * One planner run, as a function: Jev, then phase 2 or the final report. The server calls it for each
 * job; it receives everything it needs as parameters and reaches no HTTP object.
 */

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

/** One planner run: Jev, then phase 2 or the final report. Returns the response body. */
export async function runPlanner(
  input: PlannerInput,
  answers: PlannerAnswer[],
  final: boolean,
  claims: Claims,
) {
  const jev = await analyzeWithJev(input);

  // Final request: the questions are answered, so only the profile is left
  if (final) {
    return { jev, ...(await buildReport(input, jev, answers, claims)) };
  }

  const phase2 = await analyzePhase2(input, jev, answers);
  const questions = selectQuestions(
    phase2.questions,
    answers,
    questionLimit(phase2.maturity, input),
  );
  if (questions.length === 0) {
    const report = await buildReport(input, jev, answers, claimsFromPhase2(phase2), phase2);
    return { jev, phase2: { ...phase2, questions }, ...report };
  }
  return {
    jev,
    phase2: { ...phase2, questions },
    questionTotal: answers.length + questions.length,
  };
}
