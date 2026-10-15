import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { POLICY, selectQuestions } from "../../planner/question-policy.js";
import type { PlannerAnswer, Question } from "../../planner/planner-phase2-handler.js";
import "./helpers.js";

type Topic = Question["topic"];

const question = (topic: string, text = `${topic}?`): Question => ({
  topic: topic as Topic,
  question: text,
  options: ["yes", "no"],
});
const answer = (topic: string): PlannerAnswer => ({ topic, question: `${topic}?`, answer: "done" });

describe("POLICY", () => {
  test("the session asks between 0 and 2 questions", () => {
    assert.equal(POLICY.min, 0);
    assert.equal(POLICY.max, 2);
  });
});

describe("selectQuestions", () => {
  test("keeps up to two questions when nothing is answered", () => {
    const questions = [question("credentials"), question("partners"), question("who_operates")];
    assert.equal(selectQuestions(questions, []).length, POLICY.max);
  });

  test("zero questions in, zero questions out", () => {
    assert.deepEqual(selectQuestions([], []), []);
  });

  test("drops topics that are already answered", () => {
    const questions = [question("credentials"), question("partners")];
    assert.deepEqual(selectQuestions(questions, [answer("credentials")]), [questions[1]]);
  });

  test("keeps only the first question of a repeated topic", () => {
    const first = question("partners", "first");
    const result = selectQuestions([first, question("partners", "second")], []);
    assert.deepEqual(result, [first]);
  });

  test("orders by priority: credentials before partners", () => {
    const partners = question("partners");
    const credentials = question("credentials");
    assert.deepEqual(selectQuestions([partners, credentials], []), [credentials, partners]);
  });

  test("orders the catalog by the product priority", () => {
    const priority: Topic[] = [
      "credentials",
      "trade_experience",
      "tech_builder",
      "who_operates",
      "opening_deadline",
      "partners",
      "existing_customers",
    ];
    const reversed = [...priority].reverse().map((topic) => question(topic));
    const result = selectQuestions(reversed, []);
    assert.deepEqual(result.map((q) => q.topic), priority.slice(0, POLICY.max));
  });

  test("puts an unknown topic last", () => {
    const unknown = question("mystery");
    const result = selectQuestions([unknown, question("partners"), question("credentials")], []);
    assert.deepEqual(result.map((q) => q.topic), ["credentials", "partners"]);
  });

  test("the room left is the maximum minus the answers", () => {
    // Room is 2 - 1 = 1, so only the most valuable question is kept
    const questions = [question("partners"), question("who_operates"), question("credentials")];
    const result = selectQuestions(questions, [answer("trade_experience")]);
    assert.deepEqual(result.map((q) => q.topic), ["credentials"]);
  });

  test("returns nothing when the answers already fill the room", () => {
    const questions = [question("partners")];
    assert.deepEqual(selectQuestions(questions, [answer("credentials"), answer("who_operates")]), []);
  });

  test("returns nothing when there are more answers than the room", () => {
    const questions = [question("partners")];
    const many = [answer("credentials"), answer("who_operates"), answer("partners")];
    assert.deepEqual(selectQuestions(questions, many), []);
  });

  test("does not change the input array", () => {
    const questions = [question("partners"), question("credentials"), question("partners")];
    const before = structuredClone(questions);
    selectQuestions(questions, [answer("who_operates")]);
    assert.deepEqual(questions, before);
  });

  test("keeps question and options exactly as they came in", () => {
    const original = { topic: "credentials", question: "¿Eres fisioterapeuta colegiado?", options: ["Sí", "No"] } as Question;
    const [result] = selectQuestions([original], []);
    assert.deepEqual(result, original);
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
    const topics = ["credentials", "partners", "who_operates", "tech_builder", "unknown_topic"];

    for (let i = 0; i < 500; i++) {
      const questions = Array.from({ length: Math.floor(random() * 12) }, () => question(pick(topics)));
      const answers = Array.from({ length: Math.floor(random() * 6) }, () => answer(pick(topics)));

      const result = selectQuestions(questions, answers);
      const resultTopics = result.map((q) => q.topic);
      const answered = new Set(answers.map((a) => a.topic));

      assert.equal(new Set(resultTopics).size, resultTopics.length, `case ${i}: duplicate topic`);
      assert.ok(resultTopics.every((t) => !answered.has(t)), `case ${i}: answered topic returned`);
      assert.ok(result.length <= Math.max(POLICY.min, POLICY.max - answers.length), `case ${i}: too many questions`);
    }
  });
});
