import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request, type AddressInfo } from "node:http";
import { readFileSync } from "node:fs";
import { server } from "../../server.js";
import { mockFetch, jsonResponse, type CapturedRequest } from "./helpers.js";
import "./helpers.js";

// Characterization: the three paths of the planner (final request, first round with questions, first
// round without questions) through the real HTTP API, with the outside calls mocked. The expected
// results are in fixtures/planner-run.snapshot.json, taken from the code before runPlanner moved.
const SNAPSHOT = "fixtures/planner-run.snapshot.json";
const snapshotPath = new URL(SNAPSHOT, import.meta.url);

let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** A plain HTTP call: the global fetch is mocked by the tests, so the client is node:http */
function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      { host: "127.0.0.1", port, path, method, headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {} },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** Starts a planner job and polls it until it finishes; returns the job's result */
async function runJob(payload: unknown): Promise<unknown> {
  const start = await call("POST", "/api/planner", payload);
  assert.equal(start.status, 202);
  for (let i = 0; i < 500; i++) {
    const poll = await call("GET", `/api/planner/${start.body.jobId}`);
    if (poll.body.status === "done") return poll.body.result;
    if (poll.body.status === "error") assert.fail(`job failed: ${poll.body.message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("job did not finish");
}

/** The outside calls in order: Jev, then phase 2 (first round only), then Jev again for the profile and the validation */
const hostOf = (call: CapturedRequest) => (call.url.includes("typesafe.ai") ? "jev" : "phase2");
const FIRST_ROUND_CALLS = ["jev", "phase2", "jev", "jev"];
const FINAL_CALLS = ["jev", "jev", "jev"];

const input = { idea: "Bakery delivery", budget: 10_000, experience: 1, team: 1, hours: 1 };

const jevReply = {
  model: "test",
  answers: {
    sector: { type: "choice", choice: "Hospitality/Food service" },
    geographic_scope: { type: "choice", choice: "Local" },
    timeline: { type: "choice", choice: "Fast (3-6m)" },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
};

const section = (value: string, source = "stated", confidence = 80) => ({ value, source, confidence });
/** A phase 2 reply that passes every check: the questions are set per test */
const phase2Reply = (questions: unknown[]) => ({
  maturity: "developing",
  subsector: section("Bakery"),
  location: section("Madrid"),
  target_customer: section("Households", "inferred", 60),
  value_proposition: section("Fresh bread at home"),
  revenue_model: section("Commission per order", "unknown", 0),
  stage: section("Idea only"),
  competition: section("Local bakeries with delivery apps"),
  constraints: {
    budget: { min: 5_000, max: null, currency: "EUR", fits: "Enough for a first version" },
    exclusions: [],
    risks: ["Competition"],
    assumptions: ["Ovens are available"],
  },
  questions,
});

/** Mocks the two outside calls: Jev (typesafe) and phase 2 (OpenAI chat, with the given questions) */
function mockOutside(questions: unknown[]): CapturedRequest[] {
  return mockFetch(({ url }) => {
    if (url.includes("typesafe.ai")) return jsonResponse(200, jevReply);
    return jsonResponse(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(phase2Reply(questions)) } }],
    });
  });
}

describe("runPlanner: characterization of the three paths", () => {
  test("first round without questions: the report comes back with phase 2 and no question", async () => {
    const calls = mockOutside([]);
    const result = await runJob({ ...input, answers: [] });
    assert.deepEqual(calls.map(hostOf), FIRST_ROUND_CALLS);
    assert.deepEqual(result, JSON.parse(readFileSync(snapshotPath, "utf8")).noQuestions);
  });

  test("first round with questions: the questions come back and no profile", async () => {
    const question = { topic: "validation", question: "Have you tested it with customers?", options: ["Yes", "No"] };
    mockOutside([question]);
    const result = await runJob({ ...input, answers: [] });
    assert.deepEqual(result, JSON.parse(readFileSync(snapshotPath, "utf8")).withQuestions);
  });

  test("final request: the answers come in and the report comes back without phase 2", async () => {
    const calls = mockOutside([]);
    const answers = [{ topic: "validation", question: "Have you tested it with customers?", answer: "Yes, ten people" }];
    const result = await runJob({ ...input, answers, final: true, analysis: { subsector: "Bakery" } });
    assert.deepEqual(calls.map(hostOf), FINAL_CALLS);
    assert.deepEqual(result, JSON.parse(readFileSync(snapshotPath, "utf8")).final);
  });
});
