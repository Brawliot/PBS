import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readAmounts } from "../../planner/amounts.js";

describe("readAmounts", () => {
  test("reads the amounts the way the browser reads a typed budget", () => {
    assert.deepEqual(readAmounts("40,000 €"), [40_000]);
    assert.deepEqual(readAmounts("40.000 €"), [40_000]);
    assert.deepEqual(readAmounts("10k"), [10_000]);
    assert.deepEqual(readAmounts("1.5M"), [1_500_000]);
    assert.deepEqual(readAmounts("50 mil"), [50_000]);
  });

  test("finds every amount in the text, and none in a text without digits", () => {
    assert.deepEqual(readAmounts("2 locales y 40.000 €"), [2, 40_000]);
    assert.deepEqual(readAmounts("Madrid"), []);
  });
});
