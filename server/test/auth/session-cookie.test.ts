import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { clearedSessionCookie, hashToken, newToken, sessionCookie, tokenFromCookieHeader } from "../../auth/session-cookie.js";

describe("the session cookie", () => {
  test("a new token is 32 random bytes in base64url (43 characters), and two are never equal", () => {
    const first = newToken();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, newToken());
  });

  test("the stored value is a SHA-256 hash, never the token", () => {
    const token = newToken();
    assert.match(hashToken(token), /^[0-9a-f]{64}$/);
    assert.equal(hashToken(token).includes(token), false);
    assert.equal(hashToken(token), hashToken(token));
  });

  test("the cookie is HttpOnly, SameSite=Lax, for the whole site, for 30 days; Secure only when asked", () => {
    const token = newToken();
    const plain = sessionCookie(token, false);
    assert.ok(plain.startsWith(`pbs_session=${token}; `));
    for (const part of ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${30 * 24 * 60 * 60}`]) assert.ok(plain.includes(part), part);
    assert.equal(plain.includes("Secure"), false);
    assert.ok(sessionCookie(token, true).endsWith("; Secure"));
  });

  test("the clearing cookie has the same attributes and Max-Age=0", () => {
    const cleared = clearedSessionCookie(true);
    assert.ok(cleared.startsWith("pbs_session=; "));
    for (const part of ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", "Secure"]) assert.ok(cleared.includes(part), part);
  });

  test("the token is read from the Cookie header among others; a value of the wrong shape is refused", () => {
    const token = newToken();
    assert.equal(tokenFromCookieHeader(`theme=dark; pbs_session=${token}; other=1`), token);
    assert.equal(tokenFromCookieHeader(undefined), undefined);
    assert.equal(tokenFromCookieHeader("theme=dark"), undefined);
    assert.equal(tokenFromCookieHeader("pbs_session=short"), undefined);
    assert.equal(tokenFromCookieHeader(`pbs_session=${"a".repeat(43)}x`), undefined);
  });
});
