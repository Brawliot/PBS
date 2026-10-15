import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildExecution, checkItem, ExecutionSchema, type RawExecutionItem } from "../../plan/execution.js";
import { parseGlance } from "../../plan/glance.js";
import { mandoContext, MANDO_BUILDS } from "../../planner/mando-capabilities.js";

// Who does each part: the model proposes, the catalog decides what Mando does, and the code adds it up.

const item = (over: Partial<RawExecutionItem>): RawExecutionItem => ({
  name: "Part",
  who: "you",
  mando_key: "none",
  cost_min: null,
  cost_max: null,
  hours_week: null,
  reason: "",
  ...over,
});

describe("checkItem: the catalog decides what Mando does", () => {
  test("a Mando part in the catalog stays Mando's, with its cost as the saving", () => {
    assert.deepEqual(checkItem(item({ name: "Online store", who: "mando", mando_key: "online_store", cost_min: 3000, cost_max: 6000 })), {
      name: "Online store",
      who: "mando",
      mandoKey: "online_store",
      costMin: 3000,
      costMax: 6000,
      hoursWeek: null,
      reason: "",
    });
  });
  test("a Mando part not in the catalog is hired out when it costs money, the person's otherwise", () => {
    assert.equal(checkItem(item({ who: "mando", mando_key: "none", cost_min: 500 }))?.who, "outsource");
    assert.equal(checkItem(item({ who: "mando", mando_key: "accounting" }))?.who, "you");
  });
  test("hours count only for the person's own parts, and the key only for Mando's", () => {
    assert.equal(checkItem(item({ who: "outsource", hours_week: 10 }))?.hoursWeek, null);
    assert.equal(checkItem(item({ who: "you", mando_key: "crm", hours_week: 12.4 }))?.mandoKey, null);
    assert.equal(checkItem(item({ who: "you", hours_week: 12.4 }))?.hoursWeek, 12);
  });
  test("bad numbers are dropped, ends in the wrong order are swapped, a part with no name is dropped", () => {
    const checked = checkItem(item({ cost_min: 900, cost_max: 100 }));
    assert.deepEqual([checked?.costMin, checked?.costMax], [100, 900]);
    assert.equal(checkItem(item({ cost_min: -5, cost_max: Number.NaN }))?.costMin, null);
    assert.equal(checkItem(item({ name: "   " })), null);
    assert.equal(checkItem(item({ who: "someone" }))?.who, "you");
  });
});

describe("buildExecution: the sums", () => {
  const parts = [
    item({ name: "Web and CRM", who: "mando", mando_key: "crm", cost_min: 4000, cost_max: 8000 }),
    item({ name: "Stock", who: "you", cost_min: 2000, cost_max: 3000, hours_week: 5 }),
    item({ name: "Sales", who: "you", hours_week: 10 }),
    item({ name: "Tax advice", who: "outsource", cost_min: 600 }),
  ];
  test("pay is what the person and the hired parts cost; saved is Mando's; hours are the person's", () => {
    const execution = buildExecution(parts);
    assert.deepEqual(execution?.pay, { min: 2600, max: 3600 }, "a part with one end counts it at both");
    assert.deepEqual(execution?.saved, { min: 4000, max: 8000 });
    assert.equal(execution?.hours, 15);
  });
  test("no usable part gives no execution", () => {
    assert.equal(buildExecution([]), undefined);
    assert.equal(buildExecution(undefined), undefined);
    assert.equal(buildExecution([item({ name: "" })]), undefined);
  });
  test("parts with no money give no range", () => {
    assert.equal(buildExecution([item({ hours_week: 4 })])?.pay, null);
  });
  test("the schema refuses totals that are not the sums of the items", () => {
    const execution = buildExecution(parts)!;
    assert.equal(ExecutionSchema.safeParse(execution).success, true);
    assert.equal(ExecutionSchema.safeParse({ ...execution, saved: { min: 1, max: 99_999_999 } }).success, false);
  });
  test("a glance carries the execution, and one with forged totals is dropped whole", () => {
    const glance = {
      maturity: "developing",
      subsectorSource: "stated",
      location: { value: "Madrid", source: "stated" },
      budget: { min: null, max: null, currency: "EUR", fits: "" },
      execution: buildExecution(parts),
    };
    assert.deepEqual(parseGlance(glance)?.execution, glance.execution);
    assert.equal(parseGlance({ ...glance, execution: { ...glance.execution, hours: 1 } }), undefined);
  });
});

describe("mandoContext", () => {
  test("names every key of the catalog, and the costs Mando never covers", () => {
    const text = mandoContext();
    for (const { key } of MANDO_BUILDS) assert.match(text, new RegExp(`- ${key}:`));
    assert.match(text, /Rent of premises/);
    assert.match(text, /"outsource"/);
  });
});

describe("glanceOf: the parts of phase 2 reach the glance, checked", () => {
  test("a Mando part outside the catalog is no longer Mando's in the glance", async () => {
    const { glanceOf } = await import("../../planner/planner-run.js");
    const section = (value: string) => ({ value, source: "stated" as const, confidence: 80 });
    const glance = glanceOf({
      maturity: "developing",
      subsector: section("Bakery"),
      location: section("Madrid"),
      target_customer: section("Households"),
      value_proposition: section("Fresh bread"),
      revenue_model: section("Per sale"),
      stage: section("Idea"),
      competition: section("Bakeries"),
      constraints: { budget: { min: 1000, max: 2000, currency: "EUR", fits: "" }, exclusions: [], risks: [], assumptions: [] },
      questions: [],
      execution: [
        item({ name: "Website", who: "mando", mando_key: "website", cost_min: 1500, cost_max: 3000 }),
        item({ name: "Accounting", who: "mando", mando_key: "none", cost_min: 400 }),
      ],
    });
    assert.deepEqual(glance?.execution?.items.map(({ who }) => who), ["mando", "outsource"]);
    assert.deepEqual(glance?.execution?.saved, { min: 1500, max: 3000 });
  });
});
