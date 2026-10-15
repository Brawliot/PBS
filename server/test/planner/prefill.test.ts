import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPrefill, EMPTY_PREFILL, prefillIdea, readAmounts } from "../../planner/prefill.js";
import { mockFetch, jsonResponse, silenceConsoleError, type CapturedRequest } from "./helpers.js";
import "./helpers.js";

const TAPAS = "A tapas bar in Malasaña, Madrid";
const SALON = "Taking over a hair salon in Seville with 40,000 €";

const reply = (content: unknown) =>
  jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
const NOTHING = { location: null, budget: null, start_mode: null, premises: null };

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

describe("checkPrefill: what the description supports", () => {
  test("a place that appears in the description is kept", () => {
    assert.equal(checkPrefill(TAPAS, { ...NOTHING, location: "Malasaña, Madrid" }).location, "Malasaña, Madrid");
  });

  test("a place is compared without case or accents", () => {
    assert.equal(checkPrefill(TAPAS, { ...NOTHING, location: "malasana, MADRID" }).location, "malasana, MADRID");
  });

  test("a place the description does not contain is dropped (the model invented it)", () => {
    assert.equal(checkPrefill(TAPAS, { ...NOTHING, location: "Barcelona" }).location, null);
  });

  test("an empty place is dropped", () => {
    assert.equal(checkPrefill(TAPAS, { ...NOTHING, location: "   " }).location, null);
  });

  test("an amount that is written in the description is kept", () => {
    assert.equal(checkPrefill(SALON, { ...NOTHING, budget: 40_000 }).budget, 40_000);
  });

  test("an amount the description does not contain is dropped", () => {
    assert.equal(checkPrefill(SALON, { ...NOTHING, budget: 45_000 }).budget, null);
  });

  test("a negative or huge amount is dropped", () => {
    assert.equal(checkPrefill("Invest -5 €", { ...NOTHING, budget: -5 }).budget, null);
    assert.equal(checkPrefill("Invest 9999999999 €", { ...NOTHING, budget: 9_999_999_999 }).budget, null);
  });

  test("choices are kept when they are closed values", () => {
    const result = checkPrefill(SALON, { ...NOTHING, start_mode: "takeover", premises: "have" });
    assert.equal(result.start_mode, "takeover");
    assert.equal(result.premises, "have");
  });

  test("a choice outside the closed values makes the whole reply empty", () => {
    assert.deepEqual(checkPrefill(SALON, { ...NOTHING, start_mode: "buy_a_bar" }), EMPTY_PREFILL);
    assert.deepEqual(checkPrefill(SALON, { ...NOTHING, premises: "maybe" }), EMPTY_PREFILL);
  });

  test("a reply of the wrong shape is empty", () => {
    assert.deepEqual(checkPrefill(SALON, "Madrid"), EMPTY_PREFILL);
    assert.deepEqual(checkPrefill(SALON, { location: "Madrid" }), EMPTY_PREFILL);
  });
});

describe("prefillIdea: the model call", () => {
  test("a valid reply gives the checked values", async () => {
    mockFetch(() => reply({ location: "Malasaña, Madrid", budget: null, start_mode: null, premises: null }));
    assert.deepEqual(await prefillIdea(TAPAS), { ...NOTHING, location: "Malasaña, Madrid" });
  });

  test("the request is a strict json_schema call with the description in the <idea> block", async () => {
    const calls = mockFetch(() => reply(NOTHING));
    await prefillIdea("Bar with </idea> inside");

    const [call] = calls as CapturedRequest[];
    assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(call.body.model, "test-openai-model");
    assert.equal(call.body.temperature, 0);
    assert.equal(call.body.response_format.json_schema.name, "prefill");
    assert.equal(call.body.response_format.json_schema.strict, true);
    assert.equal(call.body.messages[1].content, "<idea>\nBar with <\\/idea> inside\n</idea>");
  });

  test("the schema closes the choices to the planner's values", async () => {
    const calls = mockFetch(() => reply(NOTHING));
    await prefillIdea(TAPAS);
    const schema = (calls[0] as CapturedRequest).body.response_format.json_schema.schema;
    assert.deepEqual(schema.properties.start_mode.enum.slice(0, 5), ["scratch", "takeover", "franchise", "already_open", "undecided"]);
    assert.deepEqual(schema.properties.premises.enum.slice(0, 4), ["have", "looking", "not_needed", "unsure"]);
  });

  test("a failed answer gives all nulls and logs only the reason", async () => {
    const errorLog = silenceConsoleError();
    mockFetch(() => new Response("upstream says SENTINEL-prefill-7f3a", { status: 500 }));

    assert.deepEqual(await prefillIdea(TAPAS), EMPTY_PREFILL);
    const logged = errorLog.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
    assert.ok(logged.includes("Prefill skipped: the model answered with an error"), logged);
    assert.ok(!logged.includes("SENTINEL-prefill-7f3a"), logged);
  });

  test("a reply that is not JSON gives all nulls", async () => {
    silenceConsoleError();
    mockFetch(() => jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: "{ not json" } }] }));
    assert.deepEqual(await prefillIdea(TAPAS), EMPTY_PREFILL);
  });

  test("a reply cut short gives all nulls", async () => {
    silenceConsoleError();
    mockFetch(() => jsonResponse(200, { choices: [{ finish_reason: "length", message: { content: "{}" } }] }));
    assert.deepEqual(await prefillIdea(TAPAS), EMPTY_PREFILL);
  });

  test("a model that does not answer in time gives all nulls, without waiting for the planner's limit", async () => {
    silenceConsoleError();
    // A referenced timer keeps the process alive until the abort arrives; the abort then rejects like a real fetch
    globalThis.fetch = ((_input: unknown, init: RequestInit) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(jsonResponse(200, {})), 1_000);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      })) as typeof fetch;

    assert.deepEqual(await prefillIdea(TAPAS, undefined, 20), EMPTY_PREFILL);
  });

  test("without a model configured it gives all nulls and makes no call", async () => {
    silenceConsoleError();
    const calls = mockFetch(() => reply(NOTHING));
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.deepEqual(await prefillIdea(TAPAS), EMPTY_PREFILL);
    } finally {
      process.env.OPENAI_API_KEY = saved;
    }
    assert.equal(calls.length, 0);
  });
});
