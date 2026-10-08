/**
 * The table of the plan API's failures has one entry per code, with its status and its fixed text. The check is
 * made by the compiler (the table is typed by the union of the codes) and at run time for the lists of the rules.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FAILURE, type ErrorCode } from "../../plan-routes.js";
import { PLAN_ACTION_ERRORS } from "../../plan/plan-actions.js";

describe("the failure table of the plan API", () => {
  test("every code of the step and plan rules has an entry with a status and a text", () => {
    for (const code of PLAN_ACTION_ERRORS) {
      const entry = FAILURE[code as ErrorCode];
      assert.ok(entry, `${code} has no entry`);
      assert.ok(entry.status >= 400 && entry.status <= 599, `${code} has status ${entry.status}`);
      assert.ok(entry.error.length > 0, `${code} has no text`);
    }
  });

  test("events_full and plan_too_large are 409 with their fixed texts", () => {
    assert.deepEqual(FAILURE.events_full, { status: 409, error: "This step has reached the limit of its history and cannot change" });
    assert.deepEqual(FAILURE.plan_too_large, { status: 409, error: "This change would make the plan too large to store" });
  });

  test("the table is typed by every code: a code without an entry does not compile", () => {
    // The directive is needed: FAILURE has no entry for a code that is not in ErrorCode. If a code were added to
    // ErrorCode without an entry in FAILURE, FAILURE would not compile at all, and tsc would fail here too.
    // @ts-expect-error a_code_without_entry is not in FAILURE
    const wider: Record<ErrorCode | "a_code_without_entry", unknown> = FAILURE;
    assert.ok(wider);
  });
});
