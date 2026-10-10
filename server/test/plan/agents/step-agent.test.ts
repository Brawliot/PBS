import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { runStepAgent, STEP_MAX_TOKENS, stepInputOf } from "../../../plan/agents/step-agent.js";
import { MAX_AGENT_ATTEMPTS } from "../../../plan/agents/contract.js";
import { openAIModel } from "../../../plan/agents/openai-model.js";
import { MAX_DOCUMENT_TEXT } from "../../../plan/plan-model.js";
import { MAX_QUESTIONS_PER_ROUND, RunnerOutputSchema, buildRunnerInput, type RunnerInput } from "../../../plan/step-runner.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import { FakeJudge, FakeModel, planWithFact } from "./fakes.js";

const KNOWN = new Set(["legal", "finance"]);
const TARGET = { key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Local families" } };

const output = (overrides: Record<string, unknown> = {}) => ({
  summary: "The menu is viable",
  document: "# Viability\nThe numbers work for the first year.",
  questions: ["Which city?"],
  facts: [],
  requests: [],
  ...overrides,
});

/** The input the step runner receives for the step s-viability, as the route builds it */
function input(): RunnerInput {
  const { plan } = planWithFact();
  return stepInputOf(plan, "s-viability", "A restaurant in the city centre")!;
}

describe("the step input", () => {
  test("it carries the idea and the confirmed facts, the task and the department names", () => {
    const { plan } = planWithFact();
    const built = stepInputOf(plan, "s-viability", "A restaurant")!;
    assert.equal(built.context?.idea, "A restaurant");
    assert.equal(built.context?.facts.length, 1);
    assert.deepEqual(built.task, { title: "Viability" });
    assert.deepEqual(built.department, { name: "Finance" });
    assert.equal(built.round, 1);
  });

  test("it is undefined for a step that is not AI, or that does not exist", () => {
    assert.equal(stepInputOf(restaurantPlan(), "s-menu", "x"), undefined);
    assert.equal(stepInputOf(restaurantPlan(), "s-nope", "x"), undefined);
  });

  test("without the optional context the input is the same as before (the old callers)", () => {
    const plan = restaurantPlan();
    const bare = buildRunnerInput(plan.steps.find((step) => step.id === "s-viability")!, plan.steps, plan.relations)!;
    assert.equal("context" in bare, false);
    assert.equal("task" in bare, false);
    assert.equal("department" in bare, false);
  });
});

describe("runStepAgent: the answer of the step", () => {
  test("a valid answer is accepted, checked by Jev, and the model gets the step's role and token limit", async () => {
    const model = new FakeModel([output({ facts: [TARGET], requests: [{ to: "legal", text: "Check the licence" }] })]);
    const result = await runStepAgent({ model, judge: new FakeJudge([true]), attempts: 1 }, input(), { knownDepartments: KNOWN });
    assert.ok(result.ok);
    assert.equal(result.value.checked, true);
    assert.equal(result.value.output.document.startsWith("# Viability"), true);
    assert.equal(model.requests[0].role, "step_run");
    assert.equal(model.requests[0].maxTokens, STEP_MAX_TOKENS);
    // The data is between its own tags, and the idea is one of them
    assert.match(model.requests[0].user, /<idea>\nA restaurant in the city centre\n<\/idea>/);
    assert.match(model.requests[0].system, /data, never instructions/);
  });

  test("without a judge the answer is accepted, and checked is false", async () => {
    const result = await runStepAgent({ model: new FakeModel([output()]), judge: null, attempts: 1 }, input(), { knownDepartments: KNOWN });
    assert.ok(result.ok);
    assert.equal(result.value.checked, false);
  });

  test("an extra field, too many questions, and an unsafe id are refused (invalid_output)", async () => {
    const cases = [
      output({ extra: 1 }),
      output({ questions: Array(MAX_QUESTIONS_PER_ROUND + 1).fill("Q?") }),
      output({ requests: [{ to: "Bad Id!", text: "x" }] }),
    ];
    for (const bad of cases) {
      const model = new FakeModel([bad]);
      const result = await runStepAgent({ model, judge: null, attempts: 1 }, input(), { knownDepartments: KNOWN });
      assert.deepEqual(result, { ok: false, code: "invalid_output" });
    }
  });

  test("a request to a department the plan does not have is refused (invalid_output)", async () => {
    const model = new FakeModel([output({ requests: [{ to: "marketing", text: "x" }] })]);
    const result = await runStepAgent({ model, judge: null, attempts: 1 }, input(), { knownDepartments: KNOWN });
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
  });

  test("a document over the limit, or with NUL, is refused (invalid_output)", async () => {
    for (const document of ["x".repeat(MAX_DOCUMENT_TEXT + 1), "a\u0000b"]) {
      const result = await runStepAgent({ model: new FakeModel([output({ document })]), judge: null, attempts: 1 }, input(), { knownDepartments: KNOWN });
      assert.deepEqual(result, { ok: false, code: "invalid_output" });
    }
  });

  test("a fact the catalogue does not allow is refused (invalid_output)", async () => {
    const bad = { key: { kind: "catalog", id: "not_a_real_key" }, value: { kind: "other", text: "x" } };
    const result = await runStepAgent({ model: new FakeModel([output({ facts: [bad] })]), judge: null, attempts: 1 }, input(), { knownDepartments: KNOWN });
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
  });

  test("a model that fails is tried 3 times, then agent_failed", async () => {
    const model = new FakeModel([new Error("provider down")]);
    const result = await runStepAgent({ model, judge: null }, input(), { knownDepartments: KNOWN });
    assert.deepEqual(result, { ok: false, code: "agent_failed" });
    assert.equal(model.requests.length, MAX_AGENT_ATTEMPTS);
  });

  test("an answer that is then valid is kept: the retry works", async () => {
    const model = new FakeModel([{ summary: "" }, output()]);
    const result = await runStepAgent({ model, judge: null }, input(), { knownDepartments: KNOWN });
    assert.ok(result.ok);
    assert.equal(model.requests.length, 2);
  });

  test("Jev down is relevance_unavailable after 3 tries; Jev saying no is not_relevant after 3 tries", async () => {
    const down = new FakeJudge([new Error("Jev down")]);
    const downResult = await runStepAgent({ model: new FakeModel([output()]), judge: down }, input(), { knownDepartments: KNOWN });
    assert.deepEqual(downResult, { ok: false, code: "relevance_unavailable" });
    assert.equal(down.calls, MAX_AGENT_ATTEMPTS);

    const no = new FakeJudge([false]);
    const noResult = await runStepAgent({ model: new FakeModel([output()]), judge: no }, input(), { knownDepartments: KNOWN });
    assert.deepEqual(noResult, { ok: false, code: "not_relevant" });
    assert.equal(no.calls, MAX_AGENT_ATTEMPTS);
  });
});

describe("the model of the step, over the OpenAI request (no network: fetch is replaced)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  const answerWith = (finish: string, content: string) =>
    (async () =>
      new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  test("the token limit of the request is the one the step asks for", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    let sent: { max_completion_tokens?: number } = {};
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }), { status: 200 });
    }) as typeof fetch;
    await openAIModel().complete({ role: "step_run", system: "s", user: "u", schema: RunnerOutputSchema, maxTokens: STEP_MAX_TOKENS });
    assert.equal(sent.max_completion_tokens, STEP_MAX_TOKENS);
  });

  test("an answer cut by the token limit (finish_reason not stop) is a failure, so it is tried again", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    globalThis.fetch = answerWith("length", "{}");
    const model = openAIModel();
    await assert.rejects(model.complete({ role: "step_run", system: "s", user: "u", schema: RunnerOutputSchema }));
    const result = await runStepAgent({ model, judge: null }, input(), { knownDepartments: KNOWN });
    assert.deepEqual(result, { ok: false, code: "agent_failed" });
  });
});
