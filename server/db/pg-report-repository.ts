/**
 * ReportRepository on PostgreSQL. attachPlan is one UPDATE that only matches a report with no plan yet,
 * so two requests at once cannot both link a plan: the second one reads the plan the first one set.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { checkedReport, ReportStoreError, type AttachResult, type ReportRepository, type StoredReport } from "../plan/report-repository.js";

interface ReportRow {
  id: string;
  report: unknown;
  plan_id: string | null;
}

export class PgReportRepository implements ReportRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, report: unknown): Promise<string> {
    const checked = checkedReport(report);
    const id = randomUUID();
    try {
      await this.pool.query("INSERT INTO reports (id, user_id, report) VALUES ($1, $2, $3)", [id, userId, JSON.stringify(checked)]);
    } catch {
      // The driver's message can carry values: only the code of the failure is kept
      throw new ReportStoreError("storage_failed");
    }
    return id;
  }

  async get(id: string, userId: string): Promise<StoredReport | undefined> {
    const { rows } = await this.pool.query<ReportRow>("SELECT id, report, plan_id FROM reports WHERE id = $1 AND user_id = $2", [id, userId]);
    const row = rows[0];
    if (!row) return undefined;
    return { id: row.id, report: checkedReport(row.report), planId: row.plan_id };
  }

  async getByPlanId(planId: string, userId: string): Promise<StoredReport | undefined> {
    // plan_id is UNIQUE in the reports table, so this reads at most one row (and the index serves the lookup)
    const { rows } = await this.pool.query<ReportRow>("SELECT id, report, plan_id FROM reports WHERE plan_id = $1 AND user_id = $2", [planId, userId]);
    const row = rows[0];
    if (!row) return undefined;
    return { id: row.id, report: checkedReport(row.report), planId: row.plan_id };
  }

  async attachPlan(id: string, userId: string, planId: string): Promise<AttachResult> {
    const { rows } = await this.pool.query<{ plan_id: string }>(
      "UPDATE reports SET plan_id = $3 WHERE id = $1 AND user_id = $2 AND plan_id IS NULL RETURNING plan_id",
      [id, userId, planId],
    );
    if (rows.length === 1) return { ok: true, planId, attached: true };

    // Nothing was linked: the report is either not this user's or it already has its plan
    const existing = await this.pool.query<ReportRow>("SELECT id, report, plan_id FROM reports WHERE id = $1 AND user_id = $2", [id, userId]);
    const row = existing.rows[0];
    if (!row) return { ok: false, code: "not_found" };
    if (row.plan_id === null) throw new ReportStoreError("storage_failed");
    return { ok: true, planId: row.plan_id, attached: false };
  }
}
