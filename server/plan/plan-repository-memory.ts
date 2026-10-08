/**
 * In-memory PlanRepository for the unit tests. It keeps the documents as JSON text, as the database
 * does, so a read gives a new copy and goes through the same checks as a stored row.
 */

import { randomUUID } from "node:crypto";
import { parsePlan, type Plan } from "./plan-model.js";
import {
  PLAN_SCHEMA_VERSION,
  preparePlan,
  readStoredPlan,
  type PlanEventRecord,
  type PlanRepository,
  type StoredPlan,
  type UpdateResult,
} from "./plan-repository.js";

export interface MemoryRow {
  id: string;
  userId: string;
  title: string;
  version: number;
  schemaVersion: number;
  document: string;
  events: PlanEventRecord[];
}

export class InMemoryPlanRepository implements PlanRepository {
  /** Public so a test can put a row in a state that the API could not produce (for example, another schema) */
  readonly rows = new Map<string, MemoryRow>();

  async create(userId: string, title: string, plan: Plan): Promise<StoredPlan> {
    const prepared = preparePlan(title, plan);
    const row: MemoryRow = {
      id: randomUUID(),
      userId,
      title: prepared.title,
      version: 1,
      schemaVersion: PLAN_SCHEMA_VERSION,
      document: JSON.stringify(prepared.plan),
      events: [],
    };
    this.rows.set(row.id, row);
    return this.stored(row);
  }

  async get(id: string, userId: string): Promise<StoredPlan | undefined> {
    const row = this.rows.get(id);
    return row && row.userId === userId ? this.stored(row) : undefined;
  }

  async update(id: string, userId: string, expectedVersion: number, plan: Plan, events: PlanEventRecord[]): Promise<UpdateResult> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return { ok: false, code: "not_found" };
    if (row.version !== expectedVersion) return { ok: false, code: "version_conflict" };
    row.document = JSON.stringify(parsePlan(plan));
    row.version += 1;
    row.events.push(...events);
    return { ok: true, stored: this.stored(row) };
  }

  private stored(row: MemoryRow): StoredPlan {
    return {
      id: row.id,
      title: row.title,
      version: row.version,
      plan: readStoredPlan(row.schemaVersion, JSON.parse(row.document)),
    };
  }
}
