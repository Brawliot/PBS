import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildState, callJev, analyzeWithJev, type JevQuestion } from "../../planner/planner-handler.js";
import { mockFetch, jsonResponse, setJevEnv, silenceConsoleError } from "./helpers.js";
import "./helpers.js";

const questions: Record<string, JevQuestion> = {
  check: { type: "noul", instructions: "Something is true." },
};
const reply = { model: "test", answers: { check: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } };

describe("buildState", () => {
  test("turns the form into the JSON state with readable labels", () => {
    const state = JSON.parse(
      buildState({ idea: "Bakery", budget: 5_000, experience: 2, team: 2, hours: 3 }),
    );
    assert.deepEqual(state, {
      idea: "Bakery",
      budget_usd: 5_000,
      experience_years: 2,
      team_size: "Medium (4-10)",
      weekly_hours: "Full time",
    });
  });

  test("an out-of-range slider index is sent as its number", () => {
    const state = JSON.parse(buildState({ idea: "x", budget: 0, experience: 0, team: 9, hours: 9 }));
    assert.equal(state.team_size, "9");
    assert.equal(state.weekly_hours, "9");
  });
});

describe("callJev", () => {
  test("throws the expected error when TYPESAFE_API_KEY is missing, without calling the API", async () => {
    setJevEnv({ TYPESAFE_API_KEY: undefined });
    const calls = mockFetch(() => jsonResponse(200, reply));
    await assert.rejects(callJev("state", questions), { message: "TYPESAFE_API_KEY is not set" });
    assert.equal(calls.length, 0);
  });

  test("throws the expected error when JEV_MODEL is missing, without calling the API", async () => {
    setJevEnv({ JEV_MODEL: undefined });
    const calls = mockFetch(() => jsonResponse(200, reply));
    await assert.rejects(callJev("state", questions), { message: "JEV_MODEL is not set" });
    assert.equal(calls.length, 0);
  });

  test("a failed response throws a generic error and logs the upstream detail", async () => {
    const errorLog = silenceConsoleError();
    mockFetch(() => new Response("upstream says: sk-secret-detail", { status: 500 }));

    await assert.rejects(callJev("state", questions), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "The analysis service failed");
      assert.ok(!error.message.includes("sk-secret-detail"));
      return true;
    });

    assert.equal(errorLog.mock.callCount(), 1);
    const logged = String(errorLog.mock.calls[0].arguments[0]);
    assert.ok(logged.includes("Jev API error 500"));
    assert.ok(logged.includes("sk-secret-detail"));
  });

  test("sends the bearer key, the environment model and the questions to the Jev endpoint", async () => {
    const calls = mockFetch(() => jsonResponse(200, reply));
    const result = await callJev("the state", questions);

    assert.deepEqual(result, reply);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.Authorization, "Bearer test-key");
    assert.deepEqual(calls[0].body, { state: "the state", model: "test-model", questions });
  });

  describe("response validation", () => {
    const SENTINEL = "SENTINEL-body-7f3a";
    const GENERIC = "The analysis service returned an unexpected response";
    const answersOf = (answers: unknown, extra: Record<string, unknown> = {}) =>
      ({ model: "test", answers, debug: SENTINEL, ...extra });

    const invalid: [string, () => Response][] = [
      ["no answers field", () => jsonResponse(200, { model: "test", debug: SENTINEL })],
      ["answers that is not an object", () => jsonResponse(200, answersOf(SENTINEL))],
      ["answers that is a list", () => jsonResponse(200, answersOf([SENTINEL]))],
      [
        "a noul given as a string",
        () => jsonResponse(200, answersOf({ check: { type: "noul", noul: SENTINEL } })),
      ],
      [
        "a choice given as a number",
        () => jsonResponse(200, answersOf({ check: { type: "choice", choice: 42 } })),
      ],
      [
        "an answer type that is not known",
        () => jsonResponse(200, answersOf({ check: { type: SENTINEL, noul: 0.5 } })),
      ],
      ["a body that is not JSON", () => new Response(`<html>${SENTINEL}</html>`, { status: 200 })],
    ];

    for (const [name, respond] of invalid) {
      test(`${name} throws the generic error and logs without the body`, async () => {
        const errorLog = silenceConsoleError();
        mockFetch(respond);

        await assert.rejects(callJev("state", questions), { message: GENERIC });

        assert.equal(errorLog.mock.callCount(), 1);
        const logged = String(errorLog.mock.calls[0].arguments.join(" "));
        assert.ok(!logged.includes(SENTINEL), logged);
        assert.ok(!logged.includes("<html>"), logged);
      });
    }

    test("the log names the failing path and the code, not the value", async () => {
      const errorLog = silenceConsoleError();
      mockFetch(() => jsonResponse(200, answersOf({ check: { type: "noul", noul: SENTINEL } })));

      await assert.rejects(callJev("state", questions));

      const logged = String(errorLog.mock.calls[0].arguments.join(" "));
      assert.ok(logged.includes("answers.check.noul invalid_type"), logged);
    });

    test("a valid response with extra fields passes and the extra fields are dropped", async () => {
      const extra = {
        model: "test",
        usage: { input_tokens: 3, output_tokens: 4, cost: 0.01 },
        answers: { check: { type: "noul", noul: 0.9, reason: "because" } },
        request_id: "abc",
      };
      mockFetch(() => jsonResponse(200, extra));

      const result = await callJev("state", questions);

      assert.deepEqual(result, {
        model: "test",
        usage: { input_tokens: 3, output_tokens: 4 },
        answers: { check: { type: "noul", noul: 0.9 } },
      });
    });

    test("model and usage are optional", async () => {
      mockFetch(() => jsonResponse(200, { answers: { check: { type: "noul", noul: 0.1 } } }));
      const result = await callJev("state", questions);
      assert.deepEqual(result, { answers: { check: { type: "noul", noul: 0.1 } } });
    });
  });

  test("analyzeWithJev asks the three context questions about the form data", async () => {
    const calls = mockFetch(() => jsonResponse(200, reply));
    await analyzeWithJev({ idea: "Bakery", budget: 0, experience: 0, team: 0, hours: 0 });

    assert.deepEqual(Object.keys(calls[0].body.questions), ["sector", "geographic_scope", "timeline"]);
    assert.equal(JSON.parse(calls[0].body.state).idea, "Bakery");
  });
});
