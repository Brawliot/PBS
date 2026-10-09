import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  AnswerExtrasSchema,
  MAX_AGENT_ATTEMPTS,
  MAX_AGENT_FACTS,
  agentErrorOf,
  contextOf,
  factProposalsValid,
  judgeRelevance,
  withAttempts,
  type AgentResult,
} from "../../../plan/agents/contract.js";
import { RunnerOutputSchema } from "../../../plan/step-runner.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import { proposeFact } from "../../../plan/fact-actions.js";
import { FakeJudge, NOW, now, planWithFact } from "./fakes.js";

describe("the attempts of an agent call", () => {
  test("a retryable failure is retried up to the policy's limit, then returned", async () => {
    let calls = 0;
    const result = await withAttempts(async (): Promise<AgentResult<number>> => {
      calls += 1;
      return { ok: false, code: "invalid_output" };
    });
    assert.deepEqual(result, { ok: false, code: "invalid_output" });
    assert.equal(calls, MAX_AGENT_ATTEMPTS);
  });

  test("a success stops the retries at once", async () => {
    let calls = 0;
    const result = await withAttempts(async (): Promise<AgentResult<string>> => {
      calls += 1;
      return calls < 2 ? { ok: false, code: "agent_failed" } : { ok: true, value: "done" };
    });
    assert.deepEqual(result, { ok: true, value: "done" });
    assert.equal(calls, 2);
  });

  test("a final error (a wrong id) is not retried", async () => {
    let calls = 0;
    const result = await withAttempts(async (): Promise<AgentResult<number>> => {
      calls += 1;
      return { ok: false, code: "unknown_department" };
    });
    assert.deepEqual(result, { ok: false, code: "unknown_department" });
    assert.equal(calls, 1);
  });

  test("an error of the proposal rules keeps its name when the agent can cause it, otherwise it is an invalid result", () => {
    assert.equal(agentErrorOf("not_confirmed"), "not_confirmed");
    assert.equal(agentErrorOf("cycle"), "invalid_result");
    assert.equal(agentErrorOf("not_available"), "invalid_result");
  });
});

describe("the relevance judge", () => {
  test("no judge means the answer is not checked, and the result says so", async () => {
    assert.deepEqual(await judgeRelevance(null, "idea", "proposal"), { ok: true, value: { checked: false } });
  });

  test("a yes is checked, a no is not_relevant, a failure is relevance_unavailable", async () => {
    assert.deepEqual(await judgeRelevance(new FakeJudge([true]), "idea", "p"), { ok: true, value: { checked: true } });
    assert.deepEqual(await judgeRelevance(new FakeJudge([false]), "idea", "p"), { ok: false, code: "not_relevant" });
    assert.deepEqual(await judgeRelevance(new FakeJudge([new Error("down")]), "idea", "p"), { ok: false, code: "relevance_unavailable" });
  });
});

describe("the context an agent receives", () => {
  test("only confirmed facts go in, with their ids; a proposed fact never does", () => {
    const { plan, factId } = planWithFact();
    const extra = proposeFact(plan, { key: { kind: "catalog", id: "revenue_model" }, value: { kind: "other", text: "subscription" } }, { now, actor: "user" });
    if (!extra.ok) throw new Error(extra.code);
    const context = contextOf("A restaurant app", extra.plan);
    assert.deepEqual(
      context.facts.map((fact) => fact.id),
      [factId],
    );
    assert.equal(context.idea, "A restaurant app");
  });

  test("the idea is cut to its limit, never refused", () => {
    const context = contextOf("x".repeat(5000), restaurantPlan());
    assert.equal(context.idea.length, 2000);
    assert.ok(MAX_AGENT_FACTS > 0);
  });
});

describe("shared shapes of an answer", () => {
  test("facts the catalogue does not allow are refused; allowed ones pass", () => {
    const allowed = { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "saas" } };
    const notAllowed = { key: { kind: "catalog", id: "product_type" }, value: { kind: "other", text: "bakery" } };
    assert.equal(factProposalsValid([allowed as never]), true);
    assert.equal(factProposalsValid([notAllowed as never]), false);
  });

  test("the extras of an answer are strict: an unknown key is refused", () => {
    assert.equal(AnswerExtrasSchema.safeParse({ facts: [], requests: [], questions: [], extra: 1 }).success, false);
    assert.equal(AnswerExtrasSchema.safeParse({ facts: [], requests: [{ to: "plan", text: "need a date" }], questions: [] }).success, true);
  });

  test("the step contract accepts optional facts and requests, and still accepts the old shape", () => {
    const old = { summary: "s", document: "d", questions: [] };
    assert.equal(RunnerOutputSchema.safeParse(old).success, true);
    const extended = { ...old, requests: [{ to: "legal", text: "check the licence" }], facts: [{ key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" } }] };
    assert.equal(RunnerOutputSchema.safeParse(extended).success, true);
    assert.equal(RunnerOutputSchema.safeParse({ ...old, requests: [{ to: "bad id!", text: "x" }] }).success, false);
  });

  test("every level schema can be turned into the JSON schema sent to the model", async () => {
    const { PlanGenerateSchema, PlanReviewSchema } = await import("../../../plan/agents/plan-agent.js");
    const { DepartmentTasksSchema } = await import("../../../plan/agents/department-agent.js");
    const { TaskStepsSchema } = await import("../../../plan/agents/task-agent.js");
    for (const schema of [PlanGenerateSchema, PlanReviewSchema, DepartmentTasksSchema, TaskStepsSchema, z.strictObject({})]) {
      assert.equal(typeof z.toJSONSchema(schema), "object");
    }
  });
});

describe("the real model adapter", () => {
  test("without its key it refuses, and it sends nothing", async () => {
    const { openAIModel } = await import("../../../plan/agents/openai-model.js");
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await assert.rejects(openAIModel().complete({ role: "t", system: "s", user: "u", schema: z.strictObject({}) }), /OPENAI_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });
});

test("the fixed clock of the tests is a UTC instant", () => {
  assert.ok(NOW.endsWith("Z"));
});
