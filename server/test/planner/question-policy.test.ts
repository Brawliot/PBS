import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { POLICY, questionLimit, selectQuestions } from "../../planner/question-policy.js";
import type { PlannerInput } from "../../planner/planner-handler.js";
import type { PlannerAnswer, Phase2Response, Question } from "../../planner/planner-phase2-handler.js";
import "./helpers.js";

type Maturity = Phase2Response["maturity"];
type Topic = Question["topic"];

// No commitment signal and no low commitment: the base limit applies
const neutral: PlannerInput = { idea: "x", budget: 50_000, experience: 2, team: 1, hours: 1 };
const withInput = (overrides: Partial<PlannerInput>): PlannerInput => ({ ...neutral, ...overrides });

const question = (topic: string, text = `${topic}?`): Question => ({
  topic: topic as Topic,
  question: text,
  options: ["yes", "no"],
});
const answer = (topic: string): PlannerAnswer => ({ topic, question: `${topic}?`, answer: "done" });

/** Temporarily changes a base limit in POLICY, so the clamps can be reached */
function withBaseLimit(maturity: Maturity, value: number, run: () => void) {
  const saved = POLICY.baseByMaturity[maturity];
  POLICY.baseByMaturity[maturity] = value;
  try {
    run();
  } finally {
    POLICY.baseByMaturity[maturity] = saved;
  }
}

describe("questionLimit", () => {
  test("base limit by maturity without commitment signals", () => {
    const cases: [Maturity, number][] = [
      ["vague", 2],
      ["developing", 3],
      ["advanced", 4],
    ];
    for (const [maturity, limit] of cases) {
      assert.equal(questionLimit(maturity, neutral), limit, maturity);
    }
  });

  test("budget counts as a signal from highBudget on, not one below it", () => {
    // hours = fullTime is one signal; the budget decides whether there is a second
    const base = { hours: POLICY.fullTimeHours, experience: 0 };
    assert.equal(questionLimit("developing", withInput({ ...base, budget: POLICY.highBudget - 1 })), 3);
    assert.equal(questionLimit("developing", withInput({ ...base, budget: POLICY.highBudget })), 4);
  });

  test("experience counts as a signal from highExperience on, not one below it", () => {
    const base = { hours: POLICY.fullTimeHours, budget: 0 };
    assert.equal(questionLimit("developing", withInput({ ...base, experience: POLICY.highExperience - 1 })), 3);
    assert.equal(questionLimit("developing", withInput({ ...base, experience: POLICY.highExperience })), 4);
  });

  test("hours count as a signal from fullTimeHours on, not one below it", () => {
    const base = { budget: POLICY.highBudget, experience: 0 };
    assert.equal(questionLimit("developing", withInput({ ...base, hours: POLICY.fullTimeHours - 1 })), 3);
    assert.equal(questionLimit("developing", withInput({ ...base, hours: POLICY.fullTimeHours })), 4);
  });

  test("one signal adds nothing; two or three signals add one", () => {
    const oneSignal = withInput({ hours: POLICY.fullTimeHours, budget: 0, experience: 0 });
    const twoSignals = withInput({ hours: POLICY.fullTimeHours, budget: POLICY.highBudget, experience: 0 });
    const threeSignals = withInput({
      hours: POLICY.fullTimeHours,
      budget: POLICY.highBudget,
      experience: POLICY.highExperience,
    });
    assert.equal(questionLimit("developing", oneSignal), 3);
    assert.equal(questionLimit("developing", twoSignals), 4);
    assert.equal(questionLimit("developing", threeSignals), 4);
  });

  test("low commitment (no signal, under lowHours and lowBudget) subtracts one", () => {
    const low = withInput({ hours: POLICY.lowHours, budget: POLICY.lowBudget - 1, experience: 0 });
    assert.equal(questionLimit("developing", low), 2);
  });

  test("low commitment does not apply when the budget is exactly lowBudget", () => {
    const edge = withInput({ hours: POLICY.lowHours, budget: POLICY.lowBudget, experience: 0 });
    assert.equal(questionLimit("developing", edge), 3);
  });

  test("low commitment does not apply when there is any signal", () => {
    const withExperience = withInput({
      hours: POLICY.lowHours,
      budget: POLICY.lowBudget - 1,
      experience: POLICY.highExperience,
    });
    assert.equal(questionLimit("developing", withExperience), 3);
  });

  test("low commitment does not apply when hours are above lowHours", () => {
    const moreHours = withInput({ hours: POLICY.lowHours + 1, budget: POLICY.lowBudget - 1, experience: 0 });
    assert.equal(questionLimit("developing", moreHours), 3);
  });

  test("the result never goes below POLICY.min", () => {
    withBaseLimit("vague", -10, () => {
      const lowest = withInput({ hours: POLICY.lowHours, budget: 0, experience: 0 });
      assert.equal(questionLimit("vague", lowest), POLICY.min);
    });
  });

  test("the result never goes above POLICY.max", () => {
    withBaseLimit("advanced", 10, () => {
      const highest = withInput({
        hours: POLICY.fullTimeHours,
        budget: POLICY.highBudget,
        experience: POLICY.highExperience,
      });
      assert.equal(questionLimit("advanced", highest), POLICY.max);
    });
  });
});

describe("selectQuestions", () => {
  test("drops topics that are already answered", () => {
    const questions = [question("validation"), question("scope")];
    assert.deepEqual(selectQuestions(questions, [answer("validation")], 5), [questions[1]]);
  });

  test("keeps only the first question of a repeated topic", () => {
    const first = question("scope", "first");
    const result = selectQuestions([first, question("scope", "second")], [], 5);
    assert.deepEqual(result, [first]);
  });

  test("orders by priority: validation before scope", () => {
    const scope = question("scope");
    const validation = question("validation");
    assert.deepEqual(selectQuestions([scope, validation], [], 5), [validation, scope]);
  });

  test("orders all known topics by the product priority", () => {
    const priority: Topic[] = [
      "validation",
      "progress",
      "direction",
      "money_handling",
      "own_skills",
      "deadline",
      "differentiator",
      "scope",
      "existing_assets",
    ];
    const reversed = [...priority].reverse().map((topic) => question(topic));
    const result = selectQuestions(reversed, [], priority.length);
    assert.deepEqual(result.map((q) => q.topic), priority);
  });

  test("puts an unknown topic last", () => {
    const unknown = question("mystery");
    const result = selectQuestions([unknown, question("scope"), question("validation")], [], 5);
    assert.deepEqual(result.map((q) => q.topic), ["validation", "scope", "mystery"]);
  });

  test("fits the room left after the answers: limit minus answers", () => {
    // Room is 3 - 1 = 2, so only the two most valuable questions are kept
    const questions = [question("scope"), question("deadline"), question("validation")];
    const result = selectQuestions(questions, [answer("progress")], 3);
    assert.deepEqual(result.map((q) => q.topic), ["validation", "deadline"]);
  });

  test("returns nothing when the room is zero", () => {
    const questions = [question("scope")];
    assert.deepEqual(selectQuestions(questions, [answer("a"), answer("b")], 2), []);
  });

  test("returns nothing when the room is negative", () => {
    const questions = [question("scope")];
    assert.deepEqual(selectQuestions(questions, [answer("a"), answer("b"), answer("c")], 2), []);
  });

  test("does not change the input array", () => {
    const questions = [question("scope"), question("validation"), question("scope")];
    const before = structuredClone(questions);
    selectQuestions(questions, [answer("deadline")], 5);
    assert.deepEqual(questions, before);
  });

  test("keeps question and options exactly as they came in", () => {
    const original = { topic: "validation", question: "Have you asked anyone?", options: ["Yes", "No"] } as Question;
    const [result] = selectQuestions([original], [], 5);
    assert.deepEqual(result, original);
    assert.equal(result.question, "Have you asked anyone?");
  });

  test("invariants hold for 500 seeded random cases", () => {
    // mulberry32: a small seeded generator, so every run checks the same cases
    let seed = 42;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const topics = ["validation", "progress", "scope", "deadline", "unknown_topic"];

    for (let i = 0; i < 500; i++) {
      const questions = Array.from({ length: Math.floor(random() * 12) }, () => question(pick(topics)));
      const answers = Array.from({ length: Math.floor(random() * 6) }, () => answer(pick(topics)));
      const limit = Math.floor(random() * 10) - 2;

      const result = selectQuestions(questions, answers, limit);
      const resultTopics = result.map((q) => q.topic);
      const answered = new Set(answers.map((a) => a.topic));

      assert.equal(new Set(resultTopics).size, resultTopics.length, `case ${i}: duplicate topic`);
      assert.ok(resultTopics.every((t) => !answered.has(t)), `case ${i}: answered topic returned`);
      assert.ok(result.length <= Math.max(0, limit - answers.length), `case ${i}: too many questions`);
    }
  });
});
