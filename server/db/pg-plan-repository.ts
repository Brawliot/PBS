/**
 * PlanRepository on PostgreSQL. The version is the lock: an update succeeds only when the row still
 * has the version the caller read. The events are inserted in the same transaction as the update,
 * so a plan and its history cannot disagree.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { parsePlan, type Plan } from "../plan/plan-model.js";
import {
  PLAN_SCHEMA_VERSION,
  preparePlan,
  readStoredPlan,
  type PlanEventRecord,
  type PlanLogRecord,
  type PlanRepository,
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

const storedFrom = (row: PlanRow): StoredPlan => ({
  id: row.id,
  title: row.title,
  version: row.version,
  plan: readStoredPlan(row.schema_version, row.document),
});

/** A pool that logs only the error code: the message of a driver error can carry values */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString });
  pool.on("error", (error) => console.error("Postgres pool error:", (error as { code?: string }).code ?? "unknown"));
  return pool;
}

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

  async update(id: string, userId: string, expectedVersion: number, plan: Plan, events: PlanEventRecord[], logs: PlanLogRecord[] = []): Promise<UpdateResult> {
    const document = JSON.stringify(parsePlan(plan));
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
