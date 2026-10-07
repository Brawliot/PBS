import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { analyzeProfile } from "../planner/planner-profile-handler.js";
import type { JevResponse, PlannerInput } from "../planner/planner-handler.js";
import { mockFetch, jsonResponse } from "./helpers.js";
import "./helpers.js";

const input: PlannerInput = { idea: "Bakery delivery", budget: 10_000, experience: 1, team: 1, hours: 1 };
const emptyJev: JevResponse = { model: "test", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };

const DIMENSIONS = [
  "customer_segment",
  "revenue_model",
  "offering_type",
  "acquisition_channel",
  "competition",
  "differentiator",
  "validation_stage",
  "founder_profile",
  "deadline_rigidity",
  "capital_intensity",
  "team_requirement",
  "time_to_revenue",
  "regulatory_load",
  "third_party_dependency",
  "money_handling",
];

/** Mock Jev: answers only the dimensions given, the rest are left out of the reply */
function replyWith(choices: Record<string, string>) {
  return mockFetch(() => {
    const answers: Record<string, unknown> = {};
    for (const [key, choice] of Object.entries(choices)) {
      answers[key] = { type: "choice", choice };
    }
    return jsonResponse(200, { model: "test", answers, usage: { input_tokens: 0, output_tokens: 0 } });
  });
}

describe("analyzeProfile", () => {
  test("dimensions Jev does not answer, or answers 'Not specified', go to unknown", async () => {
    replyWith({
      customer_segment: "Consumers",
      offering_type: "Software",
      competition: "Crowded market",
      revenue_model: "Not specified",
    });
    const profile = await analyzeProfile(input, emptyJev, undefined, []);

    assert.deepEqual(profile.unknown, [
      "revenue_model",
      "acquisition_channel",
      "differentiator",
      "validation_stage",
      "founder_profile",
      "deadline_rigidity",
      "capital_intensity",
      "team_requirement",
      "time_to_revenue",
      "regulatory_load",
      "third_party_dependency",
      "money_handling",
    ]);
    assert.equal(profile.values.customer_segment, "Consumers");
    assert.equal(profile.values.revenue_model, "Not specified");
    assert.equal(profile.values.acquisition_channel, "Not specified");
  });

  test("known + unknown.length equals total in every case", async () => {
    const scenarios: Record<string, string>[] = [
      {},
      Object.fromEntries(DIMENSIONS.map((key) => [key, "Not specified"])),
      Object.fromEntries(DIMENSIONS.map((key) => [key, "Consumers"])),
      { customer_segment: "Consumers", revenue_model: "Not specified" },
    ];
    for (const choices of scenarios) {
      replyWith(choices);
      const profile = await analyzeProfile(input, emptyJev, undefined, []);
      assert.equal(profile.total, 15);
      assert.equal(profile.known + profile.unknown.length, profile.total);
    }
  });

  test("with no answers from Jev, every dimension is unknown", async () => {
    replyWith({});
    const profile = await analyzeProfile(input, emptyJev, undefined, []);
    assert.equal(profile.known, 0);
    assert.deepEqual(profile.unknown, DIMENSIONS);
  });

  test("asks one choice question per dimension, each with the 'Not specified' rule", async () => {
    const calls = replyWith({});
    await analyzeProfile(input, emptyJev, undefined, []);
    const questions = calls[0].body.questions as Record<string, { type: string; instructions: string }>;

    assert.deepEqual(Object.keys(questions), DIMENSIONS);
    for (const key of DIMENSIONS) {
      assert.equal(questions[key].type, "choice", key);
      assert.ok(
        questions[key].instructions.endsWith('otherwise choose "Not specified".'),
        `${key} lacks the Not specified rule`,
      );
    }
  });
});
