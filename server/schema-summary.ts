import type { ZodError } from "zod";

/** Paths and codes only: values from the provider never reach the log */
export function summarizeIssues(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.code}`).join(", ");
}

/**
 * The kinds of issue only, with no path: for a shape where the paths are chosen by the provider (the keys of
 * its answers), so even a path could carry text from it.
 */
export function issueCodes(error: ZodError): string {
  return [...new Set(error.issues.map((issue) => issue.code))].join(", ");
}
