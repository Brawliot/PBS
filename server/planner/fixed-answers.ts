/**
 * The closed answers of the fixed questions (PROFILE_QUESTIONS in script.js). A leaf module with no imports, so the
 * request parser, the reports and the planner can all read it without a cycle.
 */

/** How the person starts (the start_mode question). "undecided" is an answer, not a missing one */
export const START_MODES = ["scratch", "takeover", "franchise", "already_open", "undecided"] as const;
export type StartMode = (typeof START_MODES)[number];

/** Whether the person has premises (the premises question). "unsure" is an answer, not a missing one */
export const PREMISES = ["have", "looking", "not_needed", "unsure"] as const;
export type Premises = (typeof PREMISES)[number];
