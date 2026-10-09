/**
 * In-memory ReportRepository for the tests. Like the database it keeps the report as JSON text, so a
 * read gives a new copy and goes through the same check.
 */

import { randomUUID } from "node:crypto";
import { checkedReport, type AttachResult, type ReportRepository, type StoredReport } from "./report-repository.js";

interface MemoryReport {
  id: string;
  userId: string;
  document: string;
  planId: string | null;
}

/** Kept as a contract for the tests (no product code calls it yet): in-memory storage with the same rules as the database one, for the tests. */
export class InMemoryReportRepository implements ReportRepository {
  /** Public so a test can look at or change a row directly */
  readonly rows = new Map<string, MemoryReport>();

  async create(userId: string, report: unknown): Promise<string> {
    const checked = checkedReport(report);
    const row: MemoryReport = { id: randomUUID(), userId, document: JSON.stringify(checked), planId: null };
    this.rows.set(row.id, row);
    return row.id;
  }

  async get(id: string, userId: string): Promise<StoredReport | undefined> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return undefined;
    return { id: row.id, report: checkedReport(JSON.parse(row.document)), planId: row.planId };
  }

  async getByPlanId(planId: string, userId: string): Promise<StoredReport | undefined> {
    const row = [...this.rows.values()].find((candidate) => candidate.planId === planId && candidate.userId === userId);
    if (!row) return undefined;
    return { id: row.id, report: checkedReport(JSON.parse(row.document)), planId: row.planId };
  }

  async attachPlan(id: string, userId: string, planId: string): Promise<AttachResult> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return { ok: false, code: "not_found" };
    if (row.planId !== null) return { ok: true, planId: row.planId, attached: false };
    row.planId = planId;
    return { ok: true, planId, attached: true };
  }
}
