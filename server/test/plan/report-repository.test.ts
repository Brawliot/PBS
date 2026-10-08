import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { ReportStoreError } from "../../plan/report-repository.js";
import { MAX_REPORT_BYTES } from "../../plan/report.js";
import { reportWith } from "./report-fixtures.js";

const SECRET = "SECRET-CONTENT-7f3a";

/** Rejects with a ReportStoreError whose code is `code`, and whose text carries none of the given secrets */
async function assertStoreError(promise: Promise<unknown>, code: string, secrets: string[] = []) {
  const error = await promise.then(
    () => assert.fail("expected a ReportStoreError"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof ReportStoreError, String(error));
  assert.equal(error.code, code);
  const text = `${error.message} ${JSON.stringify(error)} ${error.stack ?? ""}`;
  for (const secret of secrets) assert.equal(text.includes(secret), false, "error must not carry report content");
}

describe("InMemoryReportRepository: create and get", () => {
  test("a valid report is stored and comes back equal, with no plan yet", async () => {
    const repo = new InMemoryReportRepository();
    const report = reportWith();
    const id = await repo.create("local", report);
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await repo.get(id, "local"), { id, report, planId: null });
  });

  test("a report that does not pass parseReport is not stored, and the error has no content", async () => {
    const repo = new InMemoryReportRepository();
    const broken = { ...reportWith(), [SECRET]: "value" };
    await assertStoreError(repo.create("local", broken), "invalid_report", [SECRET, "value"]);
    assert.equal(repo.rows.size, 0);
  });

  test("a report over the size limit is refused as too_large, before its schema is read", async () => {
    const repo = new InMemoryReportRepository();
    // Size is checked first, so one oversized field is enough
    await assertStoreError(repo.create("local", { ...reportWith(), padding: "x".repeat(MAX_REPORT_BYTES) }), "too_large");
    assert.equal(repo.rows.size, 0);
  });

  test("a stored report that no longer passes is not read: the error has no content", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create("local", reportWith());
    repo.rows.get(id)!.document = JSON.stringify({ ...reportWith(), [SECRET]: "value" });
    await assertStoreError(repo.get(id, "local"), "invalid_report", [SECRET]);
  });

  test("another user's report, or an id that does not exist, is not found", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create("local", reportWith());
    assert.equal(await repo.get(id, "someone-else"), undefined);
    assert.equal(await repo.get("00000000-0000-4000-8000-000000000000", "local"), undefined);
  });
});

describe("InMemoryReportRepository: attachPlan", () => {
  test("the first plan is linked and reported as attached", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create("local", reportWith());
    assert.deepEqual(await repo.attachPlan(id, "local", "plan-1"), { ok: true, planId: "plan-1", attached: true });
    assert.equal((await repo.get(id, "local"))?.planId, "plan-1");
  });

  test("a second plan for the same report is refused: the first one comes back, nothing changes", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create("local", reportWith());
    await repo.attachPlan(id, "local", "plan-1");
    assert.deepEqual(await repo.attachPlan(id, "local", "plan-2"), { ok: true, planId: "plan-1", attached: false });
    assert.equal((await repo.get(id, "local"))?.planId, "plan-1");
  });

  test("two attaches at once give one plan: exactly one is attached", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create("local", reportWith());
    const results = await Promise.all([repo.attachPlan(id, "local", "plan-a"), repo.attachPlan(id, "local", "plan-b")]);
    assert.equal(results.filter((result) => result.ok && result.attached).length, 1);
    assert.deepEqual(new Set(results.map((result) => (result.ok ? result.planId : ""))).size, 1);
  });

  test("another user's report, or an unknown one, is not found and nothing is linked", async () => {
    const repo = new InMemoryReportRepository();
    const id = await repo.create("local", reportWith());
    assert.deepEqual(await repo.attachPlan(id, "someone-else", "plan-1"), { ok: false, code: "not_found" });
    assert.deepEqual(await repo.attachPlan("00000000-0000-4000-8000-000000000000", "local", "plan-1"), { ok: false, code: "not_found" });
    assert.equal((await repo.get(id, "local"))?.planId, null);
  });
});
