/**
 * PlanRepository on PostgreSQL. The version is the lock: an update succeeds only when the row still
 * has the version the caller read. The events are inserted in the same transaction as the update,
 * so a plan and its history cannot disagree.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { MAX_DOCUMENT_BYTES, parsePlan, type Plan } from "../plan/plan-model.js";
import {
  PLAN_SCHEMA_VERSION,
  preparePlan,
  readStoredPlan,
  type PlanEventRecord,
  type PlanLogRecord,
  PROJECT_LIMIT,
  type PlanRepository,
  type ProjectRow,
  StoredPlanError,
  type StoredPlan,
  type UpdateResult,
} from "../plan/plan-repository.js";

interface PlanRow {
  id: string;
  title: string;
  version: number;
  schema_version: number;
  document: unknown;
}

/** One row of the project list: the step counts are made by the database, so the document does not travel */
interface ProjectListRow {
  id: string;
  title: string;
  schema_version: number;
  updated_at: Date;
  total: number;
  done: number;
  started: number;
}

const storedFrom = (row: PlanRow): StoredPlan => ({
  id: row.id,
  title: row.title,
  version: row.version,
  plan: readStoredPlan(row.schema_version, row.document),
});

export class PgPlanRepository implements PlanRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, title: string, plan: Plan): Promise<StoredPlan> {
    const prepared = preparePlan(title, plan);
    const { rows } = await this.pool.query<PlanRow>(
      `INSERT INTO plans (id, user_id, title, version, schema_version, document)
       VALUES ($1, $2, $3, 1, $4, $5)
       RETURNING id, title, version, schema_version, document`,
      [randomUUID(), userId, prepared.title, PLAN_SCHEMA_VERSION, JSON.stringify(prepared.plan)],
    );
    return storedFrom(rows[0]);
  }

  async get(id: string, userId: string): Promise<StoredPlan | undefined> {
    const { rows } = await this.pool.query<PlanRow>(
      "SELECT id, title, version, schema_version, document FROM plans WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    return rows[0] && storedFrom(rows[0]);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.pool.query("DELETE FROM plans WHERE id = $1 AND user_id = $2", [id, userId]);
  }

  async list(userId: string): Promise<ProjectRow[]> {
    // The counts are made here, in the database, from the steps of each document. The same rules as countSteps
    // (rejected steps are left out, a step that is not_started is not started), so the list and the plan page agree.
    const { rows } = await this.pool.query<ProjectListRow>(
      `SELECT id, title, schema_version, updated_at,
              (SELECT count(*)::int FROM jsonb_array_elements(document->'steps') AS step WHERE step->>'status' <> 'rejected') AS total,
              (SELECT count(*)::int FROM jsonb_array_elements(document->'steps') AS step WHERE step->>'status' = 'done') AS done,
              (SELECT count(*)::int FROM jsonb_array_elements(document->'steps') AS step WHERE step->>'status' NOT IN ('rejected', 'not_started')) AS started
         FROM plans WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
      [userId, PROJECT_LIMIT],
    );
    return rows.map((row) => {
      // A row of another schema is not read, as before: a migration has to decide what it means
      if (row.schema_version !== PLAN_SCHEMA_VERSION) throw new StoredPlanError("schema_mismatch");
      return {
        id: row.id,
        title: row.title,
        updatedAt: row.updated_at.toISOString(),
        counts: { total: row.total, done: row.done, started: row.started },
      };
    });
  }

  async update(id: string, userId: string, expectedVersion: number, plan: Plan, events: PlanEventRecord[], logs: PlanLogRecord[] = []): Promise<UpdateResult> {
    const document = JSON.stringify(parsePlan(plan));
    // Refused before the transaction starts: a plan that is too large changes nothing
    if (Buffer.byteLength(document) > MAX_DOCUMENT_BYTES) return { ok: false, code: "plan_too_large" };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows, rowCount } = await client.query<PlanRow>(
        `UPDATE plans
            SET document = $4, version = version + 1, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND version = $3
        RETURNING id, title, version, schema_version, document`,
        [id, userId, expectedVersion, document],
      );
      if (rowCount === 0) {
        // Nothing matched: the row is either gone (or not this user's) or it has moved on
        const exists = await client.query("SELECT 1 FROM plans WHERE id = $1 AND user_id = $2", [id, userId]);
        await client.query("ROLLBACK");
        return { ok: false, code: exists.rowCount === 0 ? "not_found" : "version_conflict" };
      }
      await insertEvents(client, id, events);
      await insertLog(client, id, logs);
      await client.query("COMMIT");
      return { ok: true, stored: storedFrom(rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertLog(client: PoolClient, planId: string, logs: PlanLogRecord[]): Promise<void> {
  for (const entry of logs) {
    await client.query(
      "INSERT INTO plan_log (plan_id, at, actor, kind, ref_id) VALUES ($1, $2, $3, $4, $5)",
      [planId, entry.at, entry.actor, entry.kind, entry.refId],
    );
  }
}

async function insertEvents(client: PoolClient, planId: string, events: PlanEventRecord[]): Promise<void> {
  for (const { stepId, event } of events) {
    await client.query(
      `INSERT INTO plan_events
         (plan_id, step_id, at, actor, action, status_from, status_to, executor_from, executor_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        planId,
        stepId,
        event.at,
        event.actor,
        event.action,
        event.from,
        event.to,
        event.executorFrom ?? null,
        event.executorTo ?? null,
      ],
    );
  }
}
