import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { logFailure, logProviderFailure } from "../log.js";
import { HttpError } from "../request.js";
import { JobStore } from "../jobs.js";
import { server } from "../server.js";
import { silenceConsoleError } from "./planner/helpers.js";
import "./planner/helpers.js";

// The failures are logged with the context, the name and a short code only. Each secret below is put in the
// message, the cause, the stack and the provider body: none of them may reach the log.
const SECRET = ["SECRET-message-1f", "SECRET-cause-2a", "SECRET-body-3c", "SECRET-stack-4d"];
const secretError = (code?: unknown) => {
  const error = Object.assign(new Error(SECRET[0], { cause: new Error(SECRET[1]) }), { code });
  error.stack = `Error: ${SECRET[3]}\n    at somewhere`;
  return error;
};
const written = (log: { mock: { calls: { arguments: unknown[] }[] } }) => log.mock.calls.map((call) => call.arguments.join(" "));
const assertNoSecret = (lines: string[]) => {
  for (const secret of SECRET) for (const line of lines) assert.equal(line.includes(secret), false, line);
};

describe("logFailure and logProviderFailure write only the context, the name and a code", () => {
  test("an error with a message, a cause and a stack: only the name", () => {
    const log = silenceConsoleError();
    logFailure("ctx", secretError());
    assert.deepEqual(written(log), ["ctx: Error"]);
    assertNoSecret(written(log));
  });

  test("a safe code is written; a numeric database code is not", () => {
    const log = silenceConsoleError();
    logFailure("ctx", secretError("invalid_report"));
    logFailure("ctx", secretError("23505"));
    logFailure("ctx", secretError("Has Caps"));
    assert.deepEqual(written(log), ["ctx: Error (invalid_report)", "ctx: Error", "ctx: Error"]);
  });

  test("an HttpError is written with its status", () => {
    const log = silenceConsoleError();
    logFailure("ctx", new HttpError(413, SECRET[0]));
    assert.deepEqual(written(log), ["ctx: Error (status 413)"]);
    assertNoSecret(written(log));
  });

  test("a value that is not an error is written by its type", () => {
    const log = silenceConsoleError();
    logFailure("ctx", SECRET[0]);
    assert.deepEqual(written(log), ["ctx: string"]);
  });

  test("a provider body that is JSON gives its safe type or code; any other body gives no code", () => {
    const log = silenceConsoleError();
    logProviderFailure("Jev API", 429, JSON.stringify({ type: "rate_limit", detail: SECRET[2] }));
    logProviderFailure("Jev API", 400, JSON.stringify({ error: { code: "bad_request", message: SECRET[2] } }));
    logProviderFailure("Jev API", 500, `<html>${SECRET[2]}</html>`);
    logProviderFailure("Jev API", 502, JSON.stringify({ type: SECRET[2] }));
    assert.deepEqual(written(log), [
      "Jev API error: status 429 (rate_limit)",
      "Jev API error: status 400 (bad_request)",
      "Jev API error: status 500",
      "Jev API error: status 502",
    ]);
    assertNoSecret(written(log));
  });
});

describe("the five places that log a failure write no secret", () => {
  test("the planner job: the error of a job with a secret message, cause and code", async () => {
    const log = silenceConsoleError();
    const jobs = new JobStore({ ttlMs: 60_000, maxJobs: 10 });
    const id = jobs.start(() => Promise.reject(secretError("provider_down")));
    for (let i = 0; i < 200 && jobs.get(id)?.status === "pending"; i++) await new Promise((resolve) => setTimeout(resolve, 2));
    assert.deepEqual(written(log), ["planner job: Error (provider_down)"]);
    assertNoSecret(written(log));
  });

  test("the Jev provider: a failed answer with a secret body", async () => {
    // Covered in planner-handler.test.ts (status and safe code only); the list here is the one that must hold
    const log = silenceConsoleError();
    const { mockFetch, jsonResponse, setJevEnv } = await import("./planner/helpers.js");
    setJevEnv({ TYPESAFE_API_KEY: "k", JEV_MODEL: "m" });
    mockFetch(() => jsonResponse(500, { type: "server_error", detail: SECRET[2] }));
    const { callJev } = await import("../planner/planner-handler.js");
    await assert.rejects(callJev("state", {}));
    assert.deepEqual(written(log), ["Jev API error: status 500 (server_error)"]);
    assertNoSecret(written(log));
  });

  describe("the server's own two places, reached by an upload that breaks off half way", () => {
    let port = 0;
    before(async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      port = (server.address() as AddressInfo).port;
    });
    after(() => new Promise<void>((resolve) => server.close(() => resolve())));

    /** Starts an upload that is declared bigger than what is sent, then breaks it off */
    async function breakUpload(path: string) {
      await new Promise<void>((resolve) => {
        const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1000" } });
        req.on("error", () => resolve());
        req.write(`{"idea":"${SECRET[2]}`);
        setTimeout(() => {
          req.destroy();
          resolve();
        }, 50);
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    test("the planner request: a failed upload is logged with its name only", async () => {
      const log = silenceConsoleError();
      await breakUpload("/api/planner");
      const lines = written(log);
      assert.ok(lines.some((line) => line.startsWith("planner request: ")), JSON.stringify(lines));
      assertNoSecret(lines);
    });

    test("the plan request: a failed upload is logged with its name only", async () => {
      const log = silenceConsoleError();
      await breakUpload("/api/plan/00000000-0000-4000-8000-000000000000/steps/s/actions");
      const lines = written(log);
      assert.ok(lines.some((line) => line.startsWith("plan request: ")), JSON.stringify(lines));
      assertNoSecret(lines);
    });
  });
});
