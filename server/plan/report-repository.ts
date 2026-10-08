/**
 * Storage of the planner's reports. The server writes a report when the analysis ends, and a plan is
 * made from it by id. A report is checked with parseReport on the way in and on the way out: a report
 * that does not pass is never stored, and a stored one that does not pass is not read. The errors carry
 * a code and never the content of the report.
 */

import { parseReport, type Report, type ReportCode } from "./report.js";

export interface StoredReport {
  id: string;
  report: Report;
  /** The plan made from this report, or null while there is none */
  planId: string | null;
}

export type AttachResult = { ok: true; planId: string; attached: boolean } | { ok: false; code: "not_found" };

export interface ReportRepository {
  /** Stores a report of the user and returns its id. Throws ReportStoreError if the report does not pass parseReport. */
  create(userId: string, report: unknown): Promise<string>;
  get(id: string, userId: string): Promise<StoredReport | undefined>;
  /**
   * Links a plan to the report, once. If the report already has a plan, that plan is returned and
   * nothing changes (attached: false). Atomic: two calls at once give the same plan.
   */
  attachPlan(id: string, userId: string, planId: string): Promise<AttachResult>;
}

/** A report that cannot be saved or read. The message is fixed: the code says why, and nothing of the report goes in. */
export class ReportStoreError extends Error {
  constructor(readonly code: ReportCode | "storage_failed") {
    super("Report could not be stored or read");
  }
}

/** The report as it is kept: the same check as the request, on the JSON text the database holds */
export function checkedReport(raw: unknown): Report {
  const result = parseReport(JSON.stringify(raw));
  if (!result.ok) throw new ReportStoreError(result.code);
  return result.report;
}
