import type { ZodError } from "zod";

/** Paths and codes only: values from the provider never reach the log */
export function summarizeIssues(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.code}`).join(", ");
}
