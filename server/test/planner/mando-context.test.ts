import { USER } from "../user-ids.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanner } from "../../planner/planner-run.js";
import type { PlannerInput } from "../../planner/planner-handler.js";
import { REASONLESS_EXPLANATIONS, isExplanationCall, mockFetch, jsonResponse, reportWithoutQuestions } from "./helpers.js";
import "./helpers.js";

// Every model that estimates, classifies or checks knows what Mando covers: phase 2 gets the full context, the
// profile, the validation and the explanations get the short note. Only the first classification (Jev's sector,
// scope and timeline) goes without it: it reads the idea alone.

const input: PlannerInput = { idea: "Online shop for handmade soap", budget: 5_000, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const};
const section = (value: string) => ({ value, source: "stated", confidence: 80 });
const phase2Reply = {
  maturity: "developing",
  subsector: section("Soap"),
  location: section("Spain"),
  target_customer: section("Consumers"),
  value_proposition: section("Natural soap"),
  revenue_model: section("Per sale"),
  stage: section("Idea"),
  competition: section("Shops"),
  constraints: { budget: { min: 1_000, max: 3_000, currency: "EUR", fits: "" }, exclusions: [], risks: [], assumptions: [] },
  questions: [],
  execution: [],
};
const jevReply = { model: "test", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } };

describe("the models know what Mando covers", () => {
  test("phase 2 gets the context, the profile, validation and explanations get the note", async () => {
    const calls = mockFetch((request) => {
      if (request.url.includes("typesafe.ai")) return jsonResponse(200, jevReply);
      const content = isExplanationCall(request) ? REASONLESS_EXPLANATIONS : phase2Reply;
      return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
    });
    await reportWithoutQuestions(input, [], { owner: USER });
    const bodies = calls.map((call) => JSON.stringify(call.body ?? ""));
    const phase2 = bodies.filter((body) => body.includes('"name":"phase2"'));
    assert.equal(phase2.length, 1);
    assert.match(phase2[0], /The person will run this business with Mando/);
    assert.match(phase2[0], /online_store/);
    const noted = bodies.filter((body) => body.includes("Execution context: the person runs this business with Mando"));
    // Profile and validation (Jev) and the explanations: three calls carry the note
    assert.equal(noted.length, 3, `calls with the note: ${noted.length} of ${bodies.length}`);
  });
});
