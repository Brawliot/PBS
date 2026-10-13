/**
 * The sizes of the report, as plain numbers. Each limit is named here, and nowhere else. This file imports
 * nothing: the request parser (request.ts) and the glance (glance.ts) read these limits too, and importing
 * report.ts from them would make a cycle.
 */

/** Largest report accepted, in bytes of text: the server builds one report per run, never a stream */
export const MAX_REPORT_BYTES = 200_000;
/** Answers of the follow-up questions in Jev's own report */
export const MAX_JEV_ANSWERS = 40;
/** A Jev answer key (sector, timeline...): a short word */
export const MAX_JEV_KEY = 40;
export const MAX_JEV_CHOICE = 200;
export const MAX_JEV_MODEL = 100;
/** Text fields of phase 2 (values, risks, exclusions, questions...), in characters */
export const MAX_PHASE2_TEXT = 1000;
/** Items of each phase 2 list (exclusions, risks, assumptions) */
export const MAX_PHASE2_LIST = 20;
/** Questions and options of a phase 2 question */
export const MAX_PHASE2_QUESTIONS = 4;
export const MAX_PHASE2_OPTIONS = 4;
export const MAX_PHASE2_TOPIC = 100;
export const MAX_CURRENCY = 10;
/** A score from 0 to this value */
export const MAX_SCORE = 100;
/** Departments and groups of the validation, and the length of a name */
export const MAX_REPORT_OBJECTS = 20;
export const MAX_REPORT_NAME = 120;
/** Explanations: the warnings and the key areas the report shows (the screen shows three and four), and the length of a reason */
export const MAX_EXPLAINED_WARNINGS = 3;
export const MAX_EXPLAINED_AREAS = 4;
export const MAX_EXPLANATION_REASON = 140;
/** Largest money amount of the glance (the budget range): above it, the figure is not a small business's budget */
export const MAX_GLANCE_MONEY = 1_000_000_000;
