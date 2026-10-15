import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { server } from "../../server.js";
import { mockFetch, jsonResponse, silenceConsoleError } from "./helpers.js";
import { signUp } from "../auth/signed-in.js";
import "./helpers.js";

// POST /api/planner/prefill: the session, the body limits and the all-null fallback, through the real HTTP server
let port = 0;
let cookie = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
  cookie = await signUp(port);
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function post(body: string, withCookie: boolean): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/planner/prefill",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(withCookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const modelReply = (content: unknown) =>
  jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });

describe("POST /api/planner/prefill", () => {
  test("without a session it is 401", async () => {
    const result = await post(JSON.stringify({ idea: "A tapas bar in Malasaña, Madrid" }), false);
    assert.equal(result.status, 401);
  });

  test("an empty idea is 400, signed in or not", async () => {
    assert.equal((await post(JSON.stringify({ idea: "  " }), true)).status, 400);
    assert.equal((await post("not json", true)).status, 400);
  });

  test("a signed-in request gets the checked values", async () => {
    mockFetch(() => modelReply({ location: "Malasaña, Madrid", budget: null, start_mode: null, premises: null }));
    const result = await post(JSON.stringify({ idea: "A tapas bar in Malasaña, Madrid" }), true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { location: "Malasaña, Madrid", budget: null, start_mode: null, premises: null });
  });

  test("a model that fails still answers 200 with all nulls", async () => {
    silenceConsoleError();
    mockFetch(() => new Response("boom", { status: 500 }));
    const result = await post(JSON.stringify({ idea: "A tapas bar in Malasaña, Madrid" }), true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { location: null, budget: null, start_mode: null, premises: null });
  });
});
