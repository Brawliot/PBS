import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CLARITY, CLARITY_VERSION, computeClarity, type ClarityInput, type Phase2Sources } from "../../plan/clarity.js";
import { DIMENSION_KEYS, type DimensionKey } from "../../planner/planner-profile-handler.js";

// The clarity is computed by fixed rules: these cases pin the weights, the source values, the thresholds and
// the cap rule (an unknown essential is never High). No model is called.

const NONE: Record<DimensionKey, string> = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, "Not specified"])) as Record<DimensionKey, string>;
const UNKNOWN: Phase2Sources = {
  subsector: "unknown",
  location: "unknown",
  target_customer: "unknown",
  value_proposition: "unknown",
  revenue_model: "unknown",
  stage: "unknown",
  competition: "unknown",
};
const clarity = (input: Partial<ClarityInput>) =>
  computeClarity({ phase2: UNKNOWN, profile: NONE, unknownInputs: [], topics: [], ...input });

describe("computeClarity: business concept", () => {
  test('"an app", only the four answers: concept Low (~7 %), person Medium', () => {
    const result = clarity({ phase2: { ...UNKNOWN, subsector: "inferred" } });
    assert.equal(result.version, CLARITY_VERSION);
    assert.deepEqual(result.concept, { level: "low", score: 7, missing: ["Value proposition", "Target customer", "How it makes money"] });
    assert.equal(result.person.level, "medium");
    assert.equal(result.person.score, 61);
    assert.deepEqual(result.person.missing, ["What you can do yourself", "Handling other people's money", "Fixed deadline"]);
  });

  test("a medium idea (offer, value and stage said; customer inferred; money and place unknown): Medium (~43 %)", () => {
    const result = clarity({
      phase2: { ...UNKNOWN, subsector: "stated", value_proposition: "stated", stage: "stated", target_customer: "inferred" },
    });
    assert.equal(result.concept.level, "medium");
    assert.equal(result.concept.score, 43);
    assert.deepEqual(result.concept.missing, ["How it makes money", "Where it operates", "How it reaches customers"]);
  });

  test("a detailed idea (almost all said, the place inferred): High (~89 %)", () => {
    const result = clarity({
      phase2: {
        subsector: "stated",
        location: "inferred",
        target_customer: "stated",
        value_proposition: "stated",
        revenue_model: "stated",
        stage: "stated",
        competition: "stated",
      },
      profile: { ...NONE, acquisition_channel: "Online self-service", differentiator: "Price" },
      topics: ["differentiator"],
    });
    assert.equal(result.concept.level, "high");
    assert.equal(result.concept.score, 89);
    assert.deepEqual(result.concept.missing, []);
  });

  test("a known profile dimension counts as inferred, and the best source of a pair wins", () => {
    const fromProfile = clarity({ profile: { ...NONE, revenue_model: "Subscription" } });
    const stated = clarity({ phase2: { ...UNKNOWN, revenue_model: "stated" }, profile: { ...NONE, revenue_model: "Subscription" } });
    // 3 × 0.5 of 22, then 3 × 1 of 22
    assert.equal(fromProfile.concept.score, 7);
    assert.equal(stated.concept.score, 14);
  });

  test("the model's judgements of the business type do not count", () => {
    const judged = clarity({
      profile: {
        ...NONE,
        capital_intensity: "Medium",
        time_to_revenue: "0-3 months",
        regulatory_load: "Light",
        third_party_dependency: "Autonomous",
      },
    });
    assert.equal(judged.concept.score, 0);
  });
});

describe("computeClarity: the cap rule", () => {
  const allStated: Phase2Sources = {
    subsector: "stated",
    location: "stated",
    target_customer: "stated",
    value_proposition: "stated",
    revenue_model: "stated",
    stage: "stated",
    competition: "stated",
  };
  const full = { profile: { ...NONE, acquisition_channel: "Direct sales", differentiator: "Price" }, topics: ["differentiator"] };

  test("every essential known: High", () => {
    assert.equal(clarity({ phase2: allStated, ...full }).concept.level, "high");
  });

  for (const key of ["subsector", "location", "target_customer", "value_proposition", "revenue_model"] as const) {
    test(`the concept is never High with ${key} unknown, even at or above the threshold`, () => {
      const result = clarity({ phase2: { ...allStated, [key]: "unknown" }, ...full });
      assert.ok(result.concept.score >= CLARITY.concept.high, `score ${result.concept.score}`);
      assert.equal(result.concept.level, "medium");
    });
  }

  test("the person is never High with one fixed question unknown", () => {
    const complete = {
      profile: { ...NONE, founder_profile: "Technical", money_handling: "No third-party money", deadline_rigidity: "Flexible" },
      topics: ["own_skills", "money_handling", "deadline", "existing_assets"],
    };
    assert.equal(clarity(complete).person.level, "high");
    const withoutHours = clarity({ ...complete, unknownInputs: ["hours"] });
    // With these weights one essential costs 3 of 18 points, so the score alone already stays below High (83 %)
    assert.equal(withoutHours.person.score, 83);
    assert.equal(withoutHours.person.level, "medium");
    assert.deepEqual(withoutHours.person.missing, ["Weekly hours"]);
  });
});

describe("computeClarity: the person", () => {
  test('every fixed question answered "I don\'t know": Low, and the missing list keeps three, heaviest first', () => {
    const result = clarity({ unknownInputs: ["budget", "experience", "team", "hours"] });
    assert.equal(result.person.score, 0);
    assert.equal(result.person.level, "low");
    assert.deepEqual(result.person.missing, ["Budget", "Weekly hours", "Team"]);
  });

  test("an answer on own skills counts as said", () => {
    assert.equal(clarity({ topics: ["own_skills"] }).person.score, 78);
  });
});
