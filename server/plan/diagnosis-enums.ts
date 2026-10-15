/**
 * The closed values of the diagnosis of the report (report.ts, DiagnosisSchema). They have no imports, so the
 * server and the browser can both read them without pulling in the schema.
 *
 * The names carry the DIAGNOSIS_ prefix: CHECK_KEYS already names the warnings of the validation
 * (planner-validation-handler.ts), and the two lists are not the same.
 */

/** The five checks, in the order the diagnosis shows them. The second one is "location", or "reach" for an online business. */
export const DIAGNOSIS_CHECK_KEYS = ["concept", "location", "money", "experience", "competition"] as const;
export type DiagnosisCheckKey = (typeof DIAGNOSIS_CHECK_KEYS)[number];

/** The key of the second check when the business is online: its reach replaces its location */
export const DIAGNOSIS_REACH_KEY = "reach";

export const DIAGNOSIS_CHECK_STATUS = ["strong", "watch", "risk"] as const;
export type DiagnosisCheckStatus = (typeof DIAGNOSIS_CHECK_STATUS)[number];

/** Who gave the status: a fixed rule of the server, or Jev (the model) */
export const DIAGNOSIS_DECIDED_BY = ["rule", "jev"] as const;
export type DiagnosisDecidedBy = (typeof DIAGNOSIS_DECIDED_BY)[number];

/** The three lists of "who does what" in the diagnosis */
export const DIAGNOSIS_SPLIT_LISTS = ["mando", "you", "outsource"] as const;
export type DiagnosisSplitList = (typeof DIAGNOSIS_SPLIT_LISTS)[number];
