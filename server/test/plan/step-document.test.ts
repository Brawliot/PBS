import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DOCUMENT_TEXT, MAX_OUTPUT_REQUESTS, OutputSchema, parsePlan, type Step, type StepOutput } from "../../plan/plan-model.js";
import { applyStepAction, type ActionContext } from "../../plan/step-actions.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { step } from "./plan-fixtures.js";

const T = (n: number) => `2026-10-07T1${n}:00:00Z`;
const base = { version: 1, state: "draft", summary: "Summary", questions: [], createdAt: T(0) };

describe("the output keeps an optional document and requests", () => {
  test("a document and requests are accepted", () => {
    const parsed = OutputSchema.parse({ ...base, document: "Line one\nLine two", requests: [{ to: "plan", text: "Need the budget" }, { to: "finance", text: "Check the rent" }] });
    assert.equal(parsed.document, "Line one\nLine two");
    assert.equal(parsed.requests?.length, 2);
  });

  test("an output without them still reads (plans stored before this change)", () => {
    assert.equal(OutputSchema.safeParse(base).success, true);
  });

  test("the document is refused when it is too long, has NUL, or is empty", () => {
    assert.equal(OutputSchema.safeParse({ ...base, document: "x".repeat(MAX_DOCUMENT_TEXT + 1) }).success, false);
    assert.equal(OutputSchema.safeParse({ ...base, document: "a\u0000b" }).success, false);
    assert.equal(OutputSchema.safeParse({ ...base, document: "   " }).success, false);
    assert.equal(OutputSchema.safeParse({ ...base, document: "x".repeat(MAX_DOCUMENT_TEXT) }).success, true);
  });

  test("an extra field in an output is refused", () => {
    assert.equal(OutputSchema.safeParse({ ...base, extra: "no" }).success, false);
  });

  test("requests: too many, a bad target, NUL in the text, and extra fields are refused", () => {
    const request = { to: "plan", text: "Need the budget" };
    assert.equal(OutputSchema.safeParse({ ...base, requests: Array(MAX_OUTPUT_REQUESTS + 1).fill(request) }).success, false);
    assert.equal(OutputSchema.safeParse({ ...base, requests: [{ to: "Not An Id!", text: "x" }] }).success, false);
    assert.equal(OutputSchema.safeParse({ ...base, requests: [{ to: "plan", text: "a\u0000b" }] }).success, false);
    assert.equal(OutputSchema.safeParse({ ...base, requests: [{ ...request, extra: 1 }] }).success, false);
  });
});

describe("attach_output keeps the document only in the latest version", () => {
  const context = (overrides: Partial<ActionContext> = {}): ActionContext => ({
    now: () => T(1),
    actor: "user",
    readiness: "ready",
    feedsOthers: false,
    ...overrides,
  });
  const ai = (overrides: Record<string, unknown> = {}): Step => step("s-ai", "t1", "d1", { executor: "ai", ...overrides }) as Step;
  const attach = (current: Step, n: number, questions: string[]): Step => {
    const result = applyStepAction(current, "attach_output", context({ actor: "ai", payload: { summary: `Round ${n}`, document: `Document ${n}`, requests: [{ to: "plan", text: `Request ${n}` }], questions } }));
    if (!result.ok) throw new Error(result.code);
    return result.step;
  };
  const answer = (current: Step, answers: string[]): Step => {
    const result = applyStepAction(current, "answer", context({ payload: { answers } }));
    if (!result.ok) throw new Error(result.code);
    return result.step;
  };

  test("after three rounds only the latest version has its document; summaries and questions stay", () => {
    const launched = applyStepAction(ai(), "launch", context());
    if (!launched.ok) throw new Error(launched.code);
    let current = attach(launched.step, 1, ["Question 1"]);
    current = answer(current, ["Answer 1"]);
    current = attach(current, 2, ["Question 2"]);
    current = answer(current, ["Answer 2"]);
    current = attach(current, 3, []);

    const outputs = current.outputs as StepOutput[];
    assert.equal(outputs.length, 3);
    assert.equal(outputs[0].document, undefined);
    assert.equal(outputs[1].document, undefined);
    assert.equal(outputs[2].document, "Document 3");
    assert.equal(outputs[2].requests?.[0].text, "Request 3");
    assert.equal(outputs[0].summary, "Round 1");
    assert.deepEqual(outputs[0].questions, [{ question: "Question 1", answer: "Answer 1", answeredAt: T(1) }]);
    assert.equal(outputs[1].questions[0].answer, "Answer 2");
    // The requests of an old version stay with it: only the document is dropped
    assert.equal(outputs[0].requests?.[0].text, "Request 1");
  });
});

describe("plans stored before the change still read", () => {
  test("the restaurant plan parses", () => {
    assert.doesNotThrow(() => parsePlan(restaurantPlan()));
  });
});
