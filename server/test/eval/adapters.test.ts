import { test } from "node:test";
import assert from "node:assert/strict";
import { jevJudge, type JudgeCall } from "../../plan/agents/jev-judge.js";
import { openAIModel, type ModelCall } from "../../plan/agents/openai-model.js";
import { z } from "zod";

/** Replaces fetch for one test, and gives the environment its keys. Restores both afterwards. */
async function withFetch(answer: (url: string) => Response, body: () => Promise<void>, env: Record<string, string> = {}): Promise<void> {
  const original = globalThis.fetch;
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  globalThis.fetch = (async (url: string | URL | Request) => answer(String(url))) as typeof fetch;
  Object.assign(process.env, env);
  try {
    await body();
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const OPENAI_ENV = { OPENAI_API_KEY: "sk-test-openai", OPENAI_MODEL: "model-test" };
const JEV_ENV = { TYPESAFE_API_KEY: "jev-test-key", JEV_MODEL: "jev-test" };
const request = { role: "plan_generate", system: "s", user: "u", schema: z.object({ a: z.number() }) };

const openAnswer = (content: string, usage?: object) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], ...(usage && { usage }) }), { status: 200 });

test("openAIModel reports tokens and time of a call, and returns the same answer as without the report", async () => {
  const calls: ModelCall[] = [];
  await withFetch(
    () => openAnswer('{"a":1}', { prompt_tokens: 120, completion_tokens: 30 }),
    async () => {
      const reported = await openAIModel({ onCall: (call) => calls.push(call) }).complete(request);
      const plain = await openAIModel().complete(request);
      assert.deepEqual(reported, { a: 1 });
      assert.deepEqual(plain, reported, "without the report, the answer is the same");
    },
    OPENAI_ENV,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, "plan_generate");
  assert.equal(calls[0].ok, true);
  assert.equal(calls[0].inputTokens, 120);
  assert.equal(calls[0].outputTokens, 30);
  assert.equal(calls[0].status, undefined);
  assert.ok(calls[0].ms >= 0);
});

test("openAIModel without a count of tokens reports the call without them", async () => {
  const calls: ModelCall[] = [];
  await withFetch(
    () => openAnswer('{"a":2}'),
    async () => {
      await openAIModel({ onCall: (call) => calls.push(call) }).complete(request);
    },
    OPENAI_ENV,
  );
  assert.equal(calls[0].ok, true);
  assert.equal(calls[0].inputTokens, undefined);
});

test("openAIModel reports a failed call with its status only, never the body", async () => {
  const calls: ModelCall[] = [];
  await withFetch(
    () => new Response("the body that must not be reported", { status: 503 }),
    async () => {
      await assert.rejects(openAIModel({ onCall: (call) => calls.push(call) }).complete(request), /The agent service failed/);
    },
    OPENAI_ENV,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ok, false);
  assert.equal(calls[0].status, 503);
  assert.equal(JSON.stringify(calls).includes("must not be reported"), false);
});

test("openAIModel reports a call that never reached an answer, with no status", async () => {
  const calls: ModelCall[] = [];
  await withFetch(
    () => openAnswer("not json"),
    async () => {
      await assert.rejects(openAIModel({ onCall: (call) => calls.push(call) }).complete(request));
    },
    OPENAI_ENV,
  );
  assert.equal(calls[0].ok, false);
  assert.equal(calls[0].status, undefined);
});

test("jevJudge reports the verdict and the tokens of the call, and the same verdict without the report", async () => {
  const calls: JudgeCall[] = [];
  const jevAnswer = (choice: string) =>
    new Response(JSON.stringify({ answers: { relevance: { type: "choice", choice } }, usage: { input_tokens: 80, output_tokens: 5 } }), { status: 200 });
  await withFetch(
    () => jevAnswer("Fits"),
    async () => {
      assert.equal(await jevJudge({ onCall: (call) => calls.push(call) }).judge("idea", "proposal"), true);
      assert.equal(await jevJudge().judge("idea", "proposal"), true);
    },
    JEV_ENV,
  );
  assert.equal(calls[0].ok, true);
  assert.equal(calls[0].verdict, "fits");
  assert.equal(calls[0].inputTokens, 80);
  assert.equal(calls[0].outputTokens, 5);
});

test("jevJudge reports a 'does not fit' verdict, and a failed call as not ok with no verdict", async () => {
  const calls: JudgeCall[] = [];
  await withFetch(
    () => new Response(JSON.stringify({ answers: { relevance: { type: "choice", choice: "Does not fit" } } }), { status: 200 }),
    async () => {
      assert.equal(await jevJudge({ onCall: (call) => calls.push(call) }).judge("i", "p"), false);
    },
    JEV_ENV,
  );
  assert.equal(calls[0].verdict, "doesNotFit");

  const failed: JudgeCall[] = [];
  await withFetch(
    () => new Response("secret jev body", { status: 500 }),
    async () => {
      await assert.rejects(jevJudge({ onCall: (call) => failed.push(call) }).judge("i", "p"));
    },
    JEV_ENV,
  );
  assert.equal(failed[0].ok, false);
  assert.equal(failed[0].verdict, undefined);
  assert.equal(JSON.stringify(failed).includes("secret jev body"), false);
});
