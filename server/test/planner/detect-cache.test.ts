import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DetectCache } from "../../planner/detect-cache.js";
import type { JevResponse } from "../../planner/planner-handler.js";
import "./helpers.js";

const JEV: JevResponse = { answers: { sector: { type: "choice", choice: "Other" } } };
const IDEA = "A tapas bar in Malasaña, Madrid";

describe("DetectCache", () => {
  test("the owner gets back the result for the same idea", () => {
    const cache = new DetectCache();
    const token = cache.put("ana", IDEA, JEV);
    assert.deepEqual(cache.take("ana", token, IDEA), JEV);
  });

  test("another user gets nothing", () => {
    const cache = new DetectCache();
    const token = cache.put("ana", IDEA, JEV);
    assert.equal(cache.take("luis", token, IDEA), undefined);
  });

  test("a changed idea gets nothing", () => {
    const cache = new DetectCache();
    const token = cache.put("ana", IDEA, JEV);
    assert.equal(cache.take("ana", token, "A bakery in Sevilla"), undefined);
  });

  test("an unknown token gets nothing", () => {
    assert.equal(new DetectCache().take("ana", "00000000-0000-4000-8000-000000000000", IDEA), undefined);
  });

  test("a result expires after 15 minutes", () => {
    let now = 1_000_000;
    const cache = new DetectCache(() => now);
    const token = cache.put("ana", IDEA, JEV);
    now += 15 * 60_000 - 1;
    assert.deepEqual(cache.take("ana", token, IDEA), JEV);
    now += 1;
    assert.equal(cache.take("ana", token, IDEA), undefined);
  });

  test("the oldest result goes first when the cache is full", () => {
    const cache = new DetectCache();
    const first = cache.put("ana", IDEA, JEV);
    for (let i = 0; i < 500; i++) cache.put("ana", `idea ${i}`, JEV);
    assert.equal(cache.take("ana", first, IDEA), undefined);
  });
});
