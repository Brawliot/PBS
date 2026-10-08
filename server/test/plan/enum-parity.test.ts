/**
 * The lists of values exist in three places: the CHECK constraints of the migrations, the TypeScript arrays, and the
 * label maps of plan.js. These tests make a value added in one place and not in the others fail, with the difference
 * named in the message.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATIONS_DIRECTORY } from "../../db/migrate.js";
import { EVENT_ACTIONS, EVENT_ACTORS, EVIDENCE_KINDS, STEP_EXECUTORS, STEP_STATUSES } from "../../plan/plan-model.js";
import { PLAN_LOG_KINDS } from "../../plan/plan-repository.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_JS = join(here, "../../../plan.js");

/** Same values, each once: the message says what is missing from each side */
function assertSameValues(label: string, actual: readonly string[], expected: readonly string[]) {
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  const duplicated = actual.length !== new Set(actual).size;
  assert.ok(
    missing.length === 0 && extra.length === 0 && !duplicated,
    `${label} does not match the code. Missing there: [${missing.join(", ")}]. Not in the code: [${extra.join(", ")}]${duplicated ? ". Some value is repeated" : ""}.`,
  );
}

// ---- The migrations: the CHECK lists of each column

const migrationSql = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS_DIRECTORY, name), "utf8"))
  .join("\n");

/** The values of `CHECK (column IN (...))` inside the CREATE TABLE of one table */
function checkValues(table: string, column: string): string[] {
  const start = migrationSql.indexOf(`CREATE TABLE ${table} (`);
  assert.notEqual(start, -1, `CREATE TABLE ${table} is in the migrations`);
  const body = migrationSql.slice(start, migrationSql.indexOf("\n);", start));
  const match = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(body);
  assert.ok(match, `${table}.${column} has a CHECK ... IN (...) in the migrations`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((found) => found[1]);
}

describe("the migrations agree with the code", () => {
  test("plan_events.actor and plan_log.actor are EVENT_ACTORS", () => {
    assertSameValues("plan_events.actor", checkValues("plan_events", "actor"), EVENT_ACTORS);
    assertSameValues("plan_log.actor", checkValues("plan_log", "actor"), EVENT_ACTORS);
  });

  test("plan_events.action is EVENT_ACTIONS", () => {
    assertSameValues("plan_events.action", checkValues("plan_events", "action"), EVENT_ACTIONS);
  });

  test("plan_events.status_from and status_to are STEP_STATUSES", () => {
    assertSameValues("plan_events.status_from", checkValues("plan_events", "status_from"), STEP_STATUSES);
    assertSameValues("plan_events.status_to", checkValues("plan_events", "status_to"), STEP_STATUSES);
  });

  test("plan_events.executor_from and executor_to are STEP_EXECUTORS", () => {
    assertSameValues("plan_events.executor_from", checkValues("plan_events", "executor_from"), STEP_EXECUTORS);
    assertSameValues("plan_events.executor_to", checkValues("plan_events", "executor_to"), STEP_EXECUTORS);
  });

  test("plan_log.kind is PLAN_LOG_KINDS", () => {
    assertSameValues("plan_log.kind", checkValues("plan_log", "kind"), PLAN_LOG_KINDS);
  });
});

// ---- plan.js: the label maps and lists of the screen

const page = readFileSync(PLAN_JS, "utf8");

/** The keys of a `const NAME = { ... };` object literal in plan.js */
function mapKeys(name: string): string[] {
  const match = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`).exec(page);
  assert.ok(match, `${name} is an object literal in plan.js`);
  return [...match[1].matchAll(/([a-z_]+):\s*['"]/g)].map((found) => found[1]);
}

/** The values of a `const NAME = [ ... ];` array in plan.js */
function listValues(name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\];`).exec(page);
  assert.ok(match, `${name} is an array in plan.js`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((found) => found[1]);
}

describe("plan.js agrees with the code", () => {
  // The actions the person can start from a button: every action but attach_output (the AI's job), minus the ones
  // that have a form of their own (answer, submit_proof, change_executor): plan.js shows those forms instead.
  const FORM_ACTIONS = ["answer", "submit_proof", "change_executor"];

  test("ACTION_LABEL and the form actions are every EVENT_ACTIONS value except attach_output", () => {
    for (const action of FORM_ACTIONS) {
      assert.ok(page.includes(`available.includes('${action}')`), `plan.js shows a form for ${action}`);
    }
    assertSameValues("ACTION_LABEL plus the forms", [...mapKeys("ACTION_LABEL"), ...FORM_ACTIONS], EVENT_ACTIONS.filter((action) => action !== "attach_output"));
  });

  test("the executor labels and the EXECUTORS list are STEP_EXECUTORS", () => {
    assertSameValues("EXECUTOR labels", mapKeys("EXECUTOR"), STEP_EXECUTORS);
    assertSameValues("EXECUTORS list", listValues("EXECUTORS"), STEP_EXECUTORS);
  });

  test("the evidence labels are EVIDENCE_KINDS, and the choices are all of them but accepted_output", () => {
    assertSameValues("EVIDENCE labels", mapKeys("EVIDENCE"), EVIDENCE_KINDS);
    assertSameValues(
      "EVIDENCE_CHOICES",
      listValues("EVIDENCE_CHOICES"),
      EVIDENCE_KINDS.filter((kind) => kind !== "accepted_output"),
    );
  });

  test("the status labels are STEP_STATUSES", () => {
    assertSameValues("STATUS labels", mapKeys("STATUS"), STEP_STATUSES);
  });
});
