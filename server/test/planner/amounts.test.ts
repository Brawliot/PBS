import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readAmounts, readEuroAmounts } from "../../planner/amounts.js";

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

describe("readEuroAmounts", () => {
  test("reads the amounts written with the euro sign or the word euros, before or after", () => {
    assert.deepEqual(readEuroAmounts("30.000 €"), [30_000]);
    assert.deepEqual(readEuroAmounts("€30,000"), [30_000]);
    assert.deepEqual(readEuroAmounts("40k euros"), [40_000]);
    assert.deepEqual(readEuroAmounts("50 mil €"), [50_000]);
    assert.deepEqual(readEuroAmounts("2 locales y 40.000 €"), [40_000]);
  });

  test("leaves out the numbers without the currency", () => {
    assert.deepEqual(readEuroAmounts("abierto 24 horas"), []);
    assert.deepEqual(readEuroAmounts("un pueblo de 3 mil habitantes"), []);
    assert.deepEqual(readEuroAmounts("30 europeos"), []);
  });
});
