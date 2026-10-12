/**
 * The auth routes as a pure function, with the stores in memory: the rules of sign-up, sign-in, sign-out and the
 * session, and the limit of failed sign-ins. The same routes on PostgreSQL: test/db/pg-auth-routes.test.ts.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { handleAuthRequest, userIdFromCookie, type AuthDeps, type AuthRequest, type AuthResponse } from "../../auth/auth-routes.js";
import { LoginLimiter } from "../../auth/login-limit.js";
import { hashToken, newToken, SESSION_COOKIE } from "../../auth/session-cookie.js";
import { InMemorySessionRepository } from "../../auth/session-repository-memory.js";
import { InMemoryUserRepository } from "../../user/user-repository-memory.js";

const NOW = new Date("2026-10-11T12:00:00Z");
const PASSWORD = "correct horse battery";

function setup() {
  const deps: AuthDeps = {
    limiter: new LoginLimiter(),
    stores: { users: new InMemoryUserRepository(), sessions: new InMemorySessionRepository() },
  };
  const send = (method: string, path: string, body?: unknown, cookie?: string, now = NOW, secure = false): Promise<AuthResponse | undefined> => {
    const request: AuthRequest = {
      method,
      path,
      body: body === undefined ? "" : JSON.stringify(body),
      cookieHeader: cookie,
      now,
      secure,
    };
    return handleAuthRequest(request, deps);
  };
  return { deps, send };
}

/** The "pbs_session=<token>" part of a Set-Cookie value, for the next request */
const cookieFrom = (response: AuthResponse | undefined) => response?.setCookie?.split(";")[0];
const tokenFrom = (response: AuthResponse | undefined) => cookieFrom(response)?.slice(SESSION_COOKIE.length + 1);

describe("sign-up", () => {
  test("a good sign-up gives 201, the name, and a session cookie: no verification is asked", async () => {
    const { send } = setup();
    const response = await send("POST", "/api/auth/register", { name: "  Ana  ", email: " Ana@Example.test ", password: PASSWORD });
    assert.equal(response?.status, 201);
    assert.deepEqual(response?.body, { user: { name: "Ana" } });
    assert.ok(response?.setCookie?.startsWith("pbs_session="));
    assert.ok(response?.setCookie?.includes("HttpOnly"));
    assert.ok(response?.setCookie?.includes("SameSite=Lax"));
    assert.equal(response?.setCookie?.includes("Secure"), false);
  });

  test("Secure is on for production cookies", async () => {
    const { send } = setup();
    const response = await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD }, undefined, NOW, true);
    assert.ok(response?.setCookie?.endsWith("; Secure"));
  });

  test("an email already used gives 409 email_taken, whatever the case of the email", async () => {
    const { send } = setup();
    await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD });
    const again = await send("POST", "/api/auth/register", { name: "Ana", email: "A@Example.test", password: PASSWORD });
    assert.equal(again?.status, 409);
    assert.equal((again?.body as { code: string }).code, "email_taken");
  });

  test("a weak password is refused with a fixed message", async () => {
    const { send } = setup();
    const response = await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: "short" });
    assert.equal(response?.status, 400);
    assert.deepEqual(response?.body, { error: "The password must have 8 to 64 characters, with no control characters", code: "invalid_password" });
  });

  test("a name of one character is refused, and so is one of 101", async () => {
    const { send } = setup();
    assert.equal((await send("POST", "/api/auth/register", { name: "A", email: "a@example.test", password: PASSWORD }))?.status, 400);
    assert.equal((await send("POST", "/api/auth/register", { name: "x".repeat(101), email: "a@example.test", password: PASSWORD }))?.status, 400);
    assert.equal(((await send("POST", "/api/auth/register", { name: "A", email: "a@example.test", password: PASSWORD }))?.body as { code: string }).code, "invalid_name");
  });

  test("a bad email is refused, and an email longer than 254 characters too", async () => {
    const { send } = setup();
    const bad = await send("POST", "/api/auth/register", { name: "Ana", email: "not-an-email", password: PASSWORD });
    assert.equal((bad?.body as { code: string }).code, "invalid_email");
    const long = `${"a".repeat(250)}@example.test`;
    assert.equal((await send("POST", "/api/auth/register", { name: "Ana", email: long, password: PASSWORD }))?.status, 400);
  });

  test("an extra field, or a missing one, is a bad request: the body is strict", async () => {
    const { send } = setup();
    assert.equal((await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD, birth: "1990-01-01" }))?.status, 400);
    assert.equal((await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test" }))?.status, 400);
    assert.equal((await send("POST", "/api/auth/register", undefined))?.status, 400);
  });

  test("the response of a refused sign-up never carries what was sent", async () => {
    const { send } = setup();
    const secret = "secret-person@example.test";
    const response = await send("POST", "/api/auth/register", { name: "Ana", email: secret, password: "x" });
    assert.equal(JSON.stringify(response?.body).includes(secret), false);
    assert.equal(JSON.stringify(response?.body).includes("secret-person"), false);
  });
});

describe("sign-in and sign-out", () => {
  test("a right password gives 200 and a session; a wrong password and an unknown email give the same answer", async () => {
    const { send } = setup();
    await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD });
    const right = await send("POST", "/api/auth/login", { email: "a@example.test", password: PASSWORD });
    assert.equal(right?.status, 200);
    assert.deepEqual(right?.body, { user: { name: "Ana" } });
    const wrong = await send("POST", "/api/auth/login", { email: "a@example.test", password: "wrong password here" });
    const unknown = await send("POST", "/api/auth/login", { email: "nobody@example.test", password: "wrong password here" });
    assert.equal(wrong?.status, 401);
    assert.deepEqual(wrong?.body, unknown?.body);
    assert.equal(wrong?.setCookie, undefined);
    assert.equal(unknown?.setCookie, undefined);
  });

  test("logout ends the session: the cookie no longer signs in, and the browser is told to forget it", async () => {
    const { deps, send } = setup();
    await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD });
    const login = await send("POST", "/api/auth/login", { email: "a@example.test", password: PASSWORD });
    const cookie = cookieFrom(login);
    assert.deepEqual(await send("GET", "/api/auth/session", undefined, cookie), { status: 200, body: { user: { name: "Ana" } } });
    const out = await send("POST", "/api/auth/logout", undefined, cookie);
    assert.equal(out?.status, 204);
    assert.ok(out?.setCookie?.includes("Max-Age=0"));
    assert.deepEqual(await send("GET", "/api/auth/session", undefined, cookie), { status: 200, body: { user: null } });
    assert.equal(await userIdFromCookie(deps.stores!.sessions, cookie, NOW), undefined);
  });

  test("a session that has expired no longer signs in", async () => {
    const { deps, send } = setup();
    await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD });
    const cookie = cookieFrom(await send("POST", "/api/auth/login", { email: "a@example.test", password: PASSWORD }));
    const thirtyOneDays = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    assert.deepEqual(await send("GET", "/api/auth/session", undefined, cookie, thirtyOneDays), { status: 200, body: { user: null } });
    assert.equal(await userIdFromCookie(deps.stores!.sessions, cookie, NOW), undefined);
  });

  test("after 10 wrong passwords the email is refused, even with the right one; the answer is 429", async () => {
    const { send } = setup();
    await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD });
    for (let i = 0; i < 10; i++) {
      assert.equal((await send("POST", "/api/auth/login", { email: "a@example.test", password: "wrong password here" }))?.status, 401);
    }
    const blocked = await send("POST", "/api/auth/login", { email: "a@example.test", password: PASSWORD });
    assert.equal(blocked?.status, 429);
    assert.equal((blocked?.body as { code: string }).code, "too_many_attempts");
  });

  test("the session answer is 200 with user null without a cookie: it is never a 401", async () => {
    const { send } = setup();
    assert.deepEqual(await send("GET", "/api/auth/session"), { status: 200, body: { user: null } });
  });
});

describe("the routes without a database", () => {
  test("sign-up and sign-in answer 503; the session answer is user null; logout still clears the cookie", async () => {
    const deps: AuthDeps = { limiter: new LoginLimiter() };
    const run = (method: string, path: string, body?: unknown) =>
      handleAuthRequest({ method, path, body: body === undefined ? "" : JSON.stringify(body), now: NOW, secure: false }, deps);
    assert.equal((await run("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD }))?.status, 503);
    assert.equal((await run("POST", "/api/auth/login", { email: "a@example.test", password: PASSWORD }))?.status, 503);
    assert.deepEqual(await run("GET", "/api/auth/session"), { status: 200, body: { user: null } });
    assert.equal((await run("POST", "/api/auth/logout"))?.status, 204);
  });

  test("an unknown auth path is not handled here", async () => {
    const { send } = setup();
    assert.equal(await send("GET", "/api/auth/unknown"), undefined);
    assert.equal(await send("GET", "/api/auth/register"), undefined);
  });
});

describe("the token is never stored", () => {
  test("the session store has the hash of the token", async () => {
    const { deps, send } = setup();
    await send("POST", "/api/auth/register", { name: "Ana", email: "a@example.test", password: PASSWORD });
    const token = tokenFrom(await send("POST", "/api/auth/login", { email: "a@example.test", password: PASSWORD }));
    assert.ok(token);
    assert.ok(await deps.stores!.sessions.findUserId(hashToken(token!), NOW));
    assert.equal(await deps.stores!.sessions.findUserId(token!, NOW), undefined);
    assert.equal(await userIdFromCookie(deps.stores!.sessions, `pbs_session=${newToken()}`, NOW), undefined);
  });
});
