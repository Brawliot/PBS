/**
 * The sign-in through the real HTTP server: the cookie as the browser gets it, the 401 of the protected routes,
 * the 403 of a request from another site, and the two users who do not see each other's plans or jobs.
 * The stores are in memory (signed-in.ts); the outside calls are blocked, so a planner job ends with an error.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { server } from "../../server.js";
import { memory, signUp, TEST_PASSWORD } from "./signed-in.js";
import { hashToken, newToken } from "../../auth/session-cookie.js";
import { reportWith } from "../plan/report-fixtures.js";
import "../planner/helpers.js";

let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: any;
}

function call(method: string, path: string, options: { body?: unknown; cookie?: string; origin?: string } = {}): Promise<Reply> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers: Record<string, string> = {};
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.origin) headers.Origin = options.origin;
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parseOrText(data) }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

/** JSON when the answer is JSON, the text otherwise (a page) */
function parseOrText(data: string): any {
  try {
    return data ? JSON.parse(data) : undefined;
  } catch {
    return data;
  }
}

const cookieOf = (reply: Reply) => (reply.headers["set-cookie"]?.[0] ?? "").split(";")[0];

describe("sign-in over HTTP", () => {
  test("the cookie comes with HttpOnly, SameSite=Lax and no Secure outside production, and the page can read the session", async () => {
    const email = "http-ana@example.test";
    const register = await call("POST", "/api/auth/register", { body: { name: "Ana", email, password: TEST_PASSWORD } });
    assert.equal(register.status, 201);
    const setCookie = register.headers["set-cookie"]?.[0] ?? "";
    assert.ok(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Lax") && setCookie.includes("Path=/"));
    assert.equal(setCookie.includes("Secure"), false);
    const session = await call("GET", "/api/auth/session", { cookie: cookieOf(register) });
    assert.deepEqual(session.body, { user: { name: "Ana" } });
  });

  test("with NODE_ENV=production the cookie carries Secure", async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const register = await call("POST", "/api/auth/register", { body: { name: "Prod", email: "prod@example.test", password: TEST_PASSWORD } });
      assert.ok((register.headers["set-cookie"]?.[0] ?? "").endsWith("; Secure"));
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  });

  test("logout over HTTP: 204, the cookie is cleared, and the old cookie no longer signs in", async () => {
    const cookie = await signUp(port, "http-logout@example.test");
    const out = await call("POST", "/api/auth/logout", { cookie });
    assert.equal(out.status, 204);
    assert.ok((out.headers["set-cookie"]?.[0] ?? "").includes("Max-Age=0"));
    const plans = await call("GET", "/api/plan/00000000-0000-4000-8000-000000000000", { cookie });
    assert.equal(plans.status, 401);
  });

  test("a session that has expired gives 401 on a protected route", async () => {
    const user = await memory.users.create("expired@example.test", "Expired", null);
    const token = newToken();
    await memory.sessions.create({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() - 1000) }, new Date());
    const reply = await call("POST", "/api/planner", { body: { idea: "x", budget: 1, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const }, cookie: `pbs_session=${token}` });
    assert.equal(reply.status, 401);
    assert.equal(reply.body.code, "unauthenticated");
  });

  test("a wrong password over HTTP: 401, and the same body for an unknown email", async () => {
    await signUp(port, "http-wrong@example.test");
    const wrong = await call("POST", "/api/auth/login", { body: { email: "http-wrong@example.test", password: "wrong password here" } });
    const unknown = await call("POST", "/api/auth/login", { body: { email: "nobody@example.test", password: "wrong password here" } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });
});

describe("the protected routes", () => {
  test("without a session: 401 on the planner, the job and the plan routes; the pages stay public", async () => {
    const planner = await call("POST", "/api/planner", { body: { idea: "x", budget: 1, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const } });
    assert.equal(planner.status, 401);
    assert.equal(planner.body.code, "unauthenticated");
    assert.equal((await call("GET", "/api/planner/00000000-0000-4000-8000-000000000001")).status, 401);
    assert.equal((await call("GET", "/api/plan/00000000-0000-4000-8000-000000000000")).status, 401);
    assert.equal((await call("GET", "/plan")).status, 200);
  });

  test("with a database, a plan request without a session is 401 even when its body is wrong; the session comes first", async () => {
    const reply = await call("POST", "/api/plan", { body: { nonsense: true } });
    assert.equal(reply.status, 401);
    assert.equal(reply.body.code, "unauthenticated");
  });

  test("a POST from another site is 403, before anything else", async () => {
    const reply = await call("POST", "/api/auth/login", { body: { email: "a@example.test", password: TEST_PASSWORD }, origin: "https://evil.example" });
    assert.equal(reply.status, 403);
    assert.equal(reply.body.code, "forbidden_origin");
  });

  test("a POST from this same site is accepted", async () => {
    const reply = await call("POST", "/api/auth/login", { body: { email: "nobody@example.test", password: TEST_PASSWORD }, origin: `http://127.0.0.1:${port}` });
    assert.equal(reply.status, 401);
  });

  test("two users: a plan and a planner job of one are not found by the other, and the owner's own are", async () => {
    const cookieA = await signUp(port, "owner-a@example.test");
    const cookieB = await signUp(port, "owner-b@example.test");
    const ownerA = await memory.users.findByEmail("owner-a@example.test");
    const reportId = await memory.reports.create(ownerA!.id, reportWith());
    const created = await call("POST", "/api/plan", { body: { reportId }, cookie: cookieA });
    assert.equal(created.status, 201);
    const planId = created.body.id;
    assert.equal((await call("GET", `/api/plan/${planId}`, { cookie: cookieB })).status, 404);
    assert.equal((await call("GET", `/api/plan/${planId}`, { cookie: cookieA })).status, 200);

    const job = await call("POST", "/api/planner", { body: { idea: "Bakery", budget: 1, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const }, cookie: cookieA });
    assert.equal(job.status, 202);
    assert.equal((await call("GET", `/api/planner/${job.body.jobId}`, { cookie: cookieB })).status, 404);
    assert.equal((await call("GET", `/api/planner/${job.body.jobId}`, { cookie: cookieA })).status, 200);
    // Cancel: only its owner can stop it, a request from another site is refused, and no session is 401
    const cancelPath = `/api/planner/${job.body.jobId}`;
    assert.equal((await call("DELETE", cancelPath)).status, 401);
    assert.equal((await call("DELETE", cancelPath, { cookie: cookieB })).status, 404, "another user's job is not found");
    assert.equal((await call("DELETE", cancelPath, { cookie: cookieA, origin: "https://elsewhere.example" })).status, 403, "a request from another site is refused");
  });
});

describe("no secret reaches the log", () => {
  test("a sign-up, a wrong sign-in and a logout with secret values write nothing that carries them", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    const secretEmail = "secret-person-41@example.test";
    const secretPassword = "hunter2-secret-pass";
    let token = "";
    try {
      const register = await call("POST", "/api/auth/register", { body: { name: "Secret", email: secretEmail, password: secretPassword } });
      const cookie = cookieOf(register);
      token = cookie.slice("pbs_session=".length);
      await call("POST", "/api/auth/login", { body: { email: secretEmail, password: "wrong-secret-pass" } });
      await call("POST", "/api/auth/login", { body: { email: "nobody-secret@example.test", password: secretPassword } });
      await call("POST", "/api/auth/logout", { cookie });
    } finally {
      console.error = original;
    }
    const everything = lines.join("\n");
    for (const secret of [secretEmail, secretPassword, "wrong-secret-pass", token]) {
      assert.equal(everything.includes(secret), false, "a secret reached the log");
    }
  });
});

