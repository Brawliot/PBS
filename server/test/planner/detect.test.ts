import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DETECT_QUESTIONS, detectedFrom, detectFromIdea, EMPTY_DETECTED } from "../../planner/detect.js";
import type { JevResponse } from "../../planner/planner-handler.js";
import { mockFetch, jsonResponse, silenceConsoleError, type CapturedRequest } from "./helpers.js";
import "./helpers.js";

const SALON = "Taking over a hair salon in Seville with 40,000 €";
const choice = (value: string) => ({ type: "choice" as const, choice: value });
/** A Jev result with the given choices; the three planner questions default to "Not specified" */
const jevWith = (answers: Record<string, string>): JevResponse => ({
  answers: {
    sector: choice("Other"),
    geographic_scope: choice("Local"),
    timeline: choice("Not specified"),
    ...Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, choice(value)])),
  },
});
const PLACES = [{ name: "Malasaña", city: "Madrid" }];

describe("detectedFrom: the closed values, each checked against the description", () => {
  test("each start choice gives its value; Not stated gives null", () => {
    const value = (start_mode: string) => detectedFrom(SALON, jevWith({ start_mode })).start_mode;
    assert.equal(value("From scratch"), "scratch");
    assert.equal(value("Taking over an existing business"), "takeover");
    assert.equal(value("Franchise"), "franchise");
    assert.equal(value("Already open"), "already_open");
    assert.equal(value("Not stated"), null);
  });

  test("each premises choice gives its value; Not stated gives null", () => {
    const value = (premises: string) => detectedFrom(SALON, jevWith({ premises })).premises;
    assert.equal(value("Has premises"), "have");
    assert.equal(value("Looking for premises"), "looking");
    assert.equal(value("Not needed"), "not_needed");
    assert.equal(value("Not stated"), null);
  });

  test("a choice the closed list does not have gives null", () => {
    assert.equal(detectedFrom(SALON, jevWith({ start_mode: "Buying a yacht" })).start_mode, null);
  });

  test("a budget band is kept when the description writes an amount in it", () => {
    assert.equal(detectedFrom(SALON, jevWith({ budget: "30,000-75,000 €" })).budget, 50_000);
  });

  test("a budget band is dropped when the description has no amount in it", () => {
    assert.equal(detectedFrom("A hair salon in Seville", jevWith({ budget: "30,000-75,000 €" })).budget, null);
  });

  test("a budget band is dropped when the amount in the text is in another band", () => {
    assert.equal(detectedFrom(SALON, jevWith({ budget: "Over 150,000 €" })).budget, null);
  });

  test("the band edges are inclusive where they meet", () => {
    assert.equal(detectedFrom("Invest 30,000 €", jevWith({ budget: "30,000-75,000 €" })).budget, 50_000);
    assert.equal(detectedFrom("Invest 30,000 €", jevWith({ budget: "10,000-30,000 €" })).budget, 20_000);
  });

  test("Not stated for the budget gives null", () => {
    assert.equal(detectedFrom(SALON, jevWith({ budget: "Not stated" })).budget, null);
  });

  test("an online or global business is located online", () => {
    assert.equal(detectedFrom("A course", jevWith({ geographic_scope: "Online" }), []).location, "online");
    assert.equal(detectedFrom("A course", jevWith({ geographic_scope: "Global" }), []).location, "online");
  });

  test("otherwise the place is the one the list finds in the text", () => {
    assert.equal(detectedFrom("Tapas bar in Malasaña, Madrid", jevWith({ geographic_scope: "Hyper-local" }), PLACES).location, "Malasaña, Madrid");
    assert.equal(detectedFrom("A tapas bar", jevWith({ geographic_scope: "Local" }), PLACES).location, null);
  });

  test("the Jev questions for the detection are the planner's three and the three fixed ones", () => {
    assert.deepEqual(Object.keys(DETECT_QUESTIONS).sort(), ["budget", "geographic_scope", "premises", "sector", "start_mode", "timeline"]);
  });
});

describe("detectFromIdea: the Jev call", () => {
  test("asks Jev with the description only and the detection's questions", async () => {
    const calls = mockFetch(() => jsonResponse(200, { answers: jevWith({ start_mode: "Franchise" }).answers }));
    const result = await detectFromIdea(SALON);

    const [call] = calls as CapturedRequest[];
    assert.equal(call.url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(call.body.state, JSON.stringify({ idea: SALON }));
    assert.deepEqual(Object.keys(call.body.questions).sort(), ["budget", "geographic_scope", "premises", "sector", "start_mode", "timeline"]);
    assert.equal(result.detected.start_mode, "franchise");
  });

  test("the planner's part keeps only the three planner answers", async () => {
    mockFetch(() => jsonResponse(200, { answers: jevWith({ start_mode: "From scratch", budget: "Under 10,000 €" }).answers }));
    const result = await detectFromIdea(SALON);
    assert.deepEqual(Object.keys(result.jev?.answers ?? {}).sort(), ["geographic_scope", "sector", "timeline"]);
  });

  test("a failed Jev call gives nothing detected and no result to keep", async () => {
    const errorLog = silenceConsoleError();
    mockFetch(() => new Response("SENTINEL-jev-41c2", { status: 500 }));
    const result = await detectFromIdea(SALON);
    assert.deepEqual(result, { detected: EMPTY_DETECTED, jev: null });
    assert.ok(!errorLog.mock.calls.map((call) => call.arguments.join(" ")).join(" ").includes("SENTINEL-jev-41c2"));
  });

  test("a Jev reply of the wrong shape gives nothing detected", async () => {
    silenceConsoleError();
    mockFetch(() => jsonResponse(200, { nothing: true }));
    assert.deepEqual((await detectFromIdea(SALON)).detected, EMPTY_DETECTED);
  });

  test("a Jev call that is too slow gives nothing detected", async () => {
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
    assert.deepEqual(await detectFromIdea(SALON, undefined, 20), { detected: EMPTY_DETECTED, jev: null });
  });

  test("without a Jev key it gives nothing detected and makes no call", async () => {
    silenceConsoleError();
    const calls = mockFetch(() => jsonResponse(200, {}));
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      assert.deepEqual((await detectFromIdea(SALON)).detected, EMPTY_DETECTED);
    } finally {
      process.env.TYPESAFE_API_KEY = saved;
    }
    assert.equal(calls.length, 0);
  });
});
