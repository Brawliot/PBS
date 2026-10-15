import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { server } from "../../server.js";
import { mockFetch, jsonResponse, silenceConsoleError } from "./helpers.js";
import { signUp } from "../auth/signed-in.js";
import "./helpers.js";

// POST /api/planner/detect: the session, the body limits and the all-null fallback, through the real HTTP server
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
        path: "/api/planner/detect",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(withCookie ? { Cookie: cookie } : {}) },
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

const jevReply = (answers: Record<string, unknown>) =>
  jsonResponse(200, {
    answers: {
      sector: { type: "choice", choice: "Hospitality/Food service" },
      geographic_scope: { type: "choice", choice: "Local" },
      timeline: { type: "choice", choice: "Not specified" },
      ...answers,
    },
  });
const SALON = "Taking over a hair salon in Seville with 40,000 €";
const choice = (value: string) => ({ type: "choice", choice: value });

describe("POST /api/planner/detect", () => {
  test("without a session it is 401", async () => {
    assert.equal((await post(JSON.stringify({ idea: SALON }), false)).status, 401);
  });

  test("an empty idea is 400, signed in or not", async () => {
    assert.equal((await post(JSON.stringify({ idea: "  " }), true)).status, 400);
    assert.equal((await post("not json", true)).status, 400);
  });

  test("a signed-in request gets the checked values and a token for the Jev result", async () => {
    mockFetch(() => jevReply({ start_mode: choice("Taking over an existing business"), budget: choice("30,000-75,000 €") }));
    const result = await post(JSON.stringify({ idea: SALON }), true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.detected, { location: null, budget: 50_000, start_mode: "takeover", premises: null });
    assert.match(result.body.jevToken, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("a Jev failure answers 200 with nothing detected and no token", async () => {
    silenceConsoleError();
    mockFetch(() => new Response("boom", { status: 500 }));
    const result = await post(JSON.stringify({ idea: SALON }), true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { detected: { location: null, budget: null, start_mode: null, premises: null }, jevToken: null });
  });
});
