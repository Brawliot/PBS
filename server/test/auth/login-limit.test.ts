import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LoginLimiter } from "../../auth/login-limit.js";

const T0 = new Date("2026-10-11T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

describe("LoginLimiter: failed sign-ins per email", () => {
  test("an email is refused after the failures of its window, and not before", () => {
    const limiter = new LoginLimiter(3, 15 * MINUTE);
    limiter.fail("a@example.test", T0);
    limiter.fail("a@example.test", T0);
    assert.equal(limiter.blocked("a@example.test", T0), false);
    limiter.fail("a@example.test", T0);
    assert.equal(limiter.blocked("a@example.test", T0), true);
  });

  test("the limit is per email: another email is not refused", () => {
    const limiter = new LoginLimiter(2, 15 * MINUTE);
    limiter.fail("a@example.test", T0);
    limiter.fail("a@example.test", T0);
    assert.equal(limiter.blocked("a@example.test", T0), true);
    assert.equal(limiter.blocked("b@example.test", T0), false);
  });

  test("after the window the count starts again", () => {
    const limiter = new LoginLimiter(2, 15 * MINUTE);
    limiter.fail("a@example.test", T0);
    limiter.fail("a@example.test", T0);
    assert.equal(limiter.blocked("a@example.test", at(15 * MINUTE - 1)), true);
    assert.equal(limiter.blocked("a@example.test", at(15 * MINUTE)), false);
  });

  test("a right password clears the count", () => {
    const limiter = new LoginLimiter(2, 15 * MINUTE);
    limiter.fail("a@example.test", T0);
    limiter.clear("a@example.test");
    limiter.fail("a@example.test", T0);
    assert.equal(limiter.blocked("a@example.test", T0), false);
  });

  test("the defaults are 10 failures in 15 minutes", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 9; i++) limiter.fail("a@example.test", T0);
    assert.equal(limiter.blocked("a@example.test", T0), false);
    limiter.fail("a@example.test", T0);
    assert.equal(limiter.blocked("a@example.test", T0), true);
  });
});
