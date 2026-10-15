import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanner } from "../../planner/planner-run.js";
import { parsePlannerRequest } from "../../request.js";
import type { JevResponse, PlannerInput } from "../../planner/planner-handler.js";
import { mockFetch, jsonResponse, type CapturedRequest } from "./helpers.js";
import "./helpers.js";

const input: PlannerInput = { idea: "Bakery delivery", location: "Madrid", budget: 10_000, start_mode: "scratch", premises: "have" };
const section = (value: string) => ({ value, source: "stated", confidence: 80 });
/** A phase 2 reply with one question: the first request stops there, so only phase 2 and Jev are called */
const phase2Reply = () =>
  jsonResponse(200, {
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          maturity: "developing",
          subsector: section("Bakery"),
          location: section("Madrid"),
          target_customer: section("Households"),
          value_proposition: section("Fresh bread"),
          revenue_model: { value: "unknown", source: "unknown", confidence: 0 },
          stage: section("Idea only"),
          competition: section("Bakeries"),
          constraints: { budget: { min: null, max: null, currency: "EUR", fits: "" }, exclusions: [], risks: [], assumptions: [] },
          questions: [{ topic: "partners", question: "Will you have partners?", options: [] }],
          execution: [],
        }),
      },
    }],
  });
const jevReply = () =>
  jsonResponse(200, {
    answers: {
      sector: { type: "choice", choice: "Hospitality/Food service" },
      geographic_scope: { type: "choice", choice: "Local" },
      timeline: { type: "choice", choice: "Not specified" },
    },
  });
const handler = (request: CapturedRequest) => (request.url.includes("typesafe") ? jevReply() : phase2Reply());
const jevCalls = (calls: CapturedRequest[]) => calls.filter((call) => call.url.includes("typesafe")).length;

describe("runPlanner: a Jev result from the detection is reused", () => {
  test("with a result passed in, Jev is not asked again", async () => {
    const calls = mockFetch(handler);
    const reused: JevResponse = { answers: { sector: { type: "choice", choice: "Other" } } };
    const result = (await runPlanner(input, [], false, {} as never, { owner: "ana", jev: reused })) as { jev: JevResponse };
    assert.equal(jevCalls(calls), 0);
    assert.deepEqual(result.jev, reused);
  });

  test("without one, Jev is asked as before", async () => {
    const calls = mockFetch(handler);
    await runPlanner(input, [], false, {} as never, { owner: "ana" });
    assert.equal(jevCalls(calls), 1);
  });
});

describe("parsePlannerRequest: the detection token", () => {
  const body = (extra: Record<string, unknown>) =>
    JSON.stringify({ idea: "Bakery", location: "Madrid", budget: 10000, start_mode: "scratch", premises: "have", ...extra });

  test("a token in the shape of one is kept", () => {
    const token = "123e4567-e89b-42d3-a456-426614174000";
    assert.equal(parsePlannerRequest(body({ jevToken: token })).jevToken, token);
  });

  test("anything else is ignored, and the request still parses", () => {
    const parsed = parsePlannerRequest(body({ jevToken: "not a token" }));
    assert.equal("jevToken" in parsed, false);
    assert.equal(parsed.input.idea, "Bakery");
  });
});
