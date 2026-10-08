import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { server } from "../server.js";
import "./planner/helpers.js";

// Every kind of response carries the same security headers, with these exact values
const EXPECTED = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
};

let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function call(method: string, path: string, body?: string): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: body ? { "Content-Type": "application/json" } : {} }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", (error) => (error.message.includes("aborted") || error.message.includes("reset") ? resolve({ status: 413, headers: {} }) : reject(error)));
    req.end(body);
  });
}

/** The security headers of a response, with the exact values */
function assertSecurity(headers: IncomingHttpHeaders, label: string) {
  for (const [name, value] of Object.entries(EXPECTED)) assert.equal(headers[name], value, `${name} on ${label}`);
}

describe("security headers on every kind of response", () => {
  test("a page", async () => {
    assertSecurity((await call("GET", "/")).headers, "index");
    assertSecurity((await call("GET", "/plan")).headers, "plan page");
  });

  test("a static file", async () => {
    assertSecurity((await call("GET", "/styles.css")).headers, "styles");
    assertSecurity((await call("GET", "/giant.js")).headers, "giant.js");
  });

  test("a JSON answer of the plan API, and of the planner API", async () => {
    const plan = await call("GET", "/api/plan/00000000-0000-4000-8000-000000000000");
    assert.equal(plan.status, 503);
    assertSecurity(plan.headers, "plan route");
    assertSecurity((await call("GET", "/api/planner/nope")).headers, "job not found");
  });

  test("an error of the server: not found, and a body too large", async () => {
    const missing = await call("GET", "/does-not-exist");
    assert.equal(missing.status, 404);
    assertSecurity(missing.headers, "404");
    assertSecurity((await call("POST", "/api/planner", "x".repeat(200_000))).headers, "413");
  });
});
