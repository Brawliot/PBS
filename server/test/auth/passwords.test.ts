import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkAgainstNothing, checkPassword, hashPassword, PasswordError, verifyPassword } from "../../auth/passwords.js";

describe("passwords: the hash", () => {
  test("has the agreed format: scrypt, its settings, a 16-byte salt and a 64-byte hash", async () => {
    const stored = await hashPassword("correct horse");
    const parts = stored.split("$");
    assert.equal(parts.length, 6);
    assert.deepEqual(parts.slice(0, 4), ["scrypt", "16384", "8", "1"]);
    assert.equal(Buffer.from(parts[4], "base64").length, 16);
    assert.equal(Buffer.from(parts[5], "base64").length, 64);
  });

  test("the same password gives a different hash each time (random salt), and the hash is not the password", async () => {
    const first = await hashPassword("correct horse");
    const second = await hashPassword("correct horse");
    assert.notEqual(first, second);
    assert.equal(first.includes("correct horse"), false);
  });
});

describe("passwords: the check", () => {
  test("the right password matches, a wrong one does not", async () => {
    const stored = await hashPassword("correct horse");
    assert.equal(await verifyPassword("correct horse", stored), true);
    assert.equal(await verifyPassword("correct horsE", stored), false);
    assert.equal(await verifyPassword("", stored), false);
  });

  test("a missing or damaged hash never matches", async () => {
    const stored = await hashPassword("correct horse");
    const [, N, r, p, salt, key] = stored.split("$");
    assert.equal(await verifyPassword("correct horse", null), false);
    assert.equal(await verifyPassword("correct horse", ""), false);
    assert.equal(await verifyPassword("correct horse", "bcrypt$1$2$3$4$5"), false);
    assert.equal(await verifyPassword("correct horse", `scrypt$${N}$${r}$${p}$${salt}`), false);
    assert.equal(await verifyPassword("correct horse", `scrypt$0$${r}$${p}$${salt}$${key}`), false);
    assert.equal(await verifyPassword("correct horse", `scrypt$${N}$${r}$${p}$${Buffer.alloc(8).toString("base64")}$${key}`), false);
    assert.equal(await verifyPassword("correct horse", `scrypt$${N}$${r}$${p}$${salt}$${Buffer.alloc(10).toString("base64")}`), false);
  });

  test("a hash of another password, of the same size, does not match", async () => {
    const other = await hashPassword("another pass");
    assert.equal(await verifyPassword("correct horse", other), false);
  });

  test("the check against nothing answers false, and does not depend on the password", async () => {
    assert.equal(await checkAgainstNothing("correct horse"), false);
    assert.equal(await checkAgainstNothing("x".repeat(64)), false);
  });
});

describe("passwords: what is allowed", () => {
  test("8 to 64 characters are allowed, shorter or longer are refused", () => {
    assert.doesNotThrow(() => checkPassword("12345678"));
    assert.doesNotThrow(() => checkPassword("a".repeat(64)));
    assert.throws(() => checkPassword("1234567"), { code: "invalid_password" });
    assert.throws(() => checkPassword("a".repeat(65)), { code: "invalid_password" });
  });

  test("the length counts characters, not bytes: 64 accented letters are allowed", () => {
    assert.doesNotThrow(() => checkPassword("ñ".repeat(64)));
    assert.throws(() => checkPassword("ñ".repeat(65)), PasswordError);
  });

  test("control characters are refused, including NUL, tab and new line", () => {
    for (const bad of ["abcdefg\u0000", "abcdefg\t", "abcdefg\n", "abcdefg\r", "abcdef\u007Fg", "abc\u001Fdefgh"]) {
      assert.throws(() => checkPassword(bad), { code: "invalid_password" }, JSON.stringify(bad));
    }
  });

  test("hashPassword refuses a weak password before hashing it", async () => {
    await assert.rejects(hashPassword("short"), { code: "invalid_password" });
  });

  test("the error message never carries the password", () => {
    try {
      checkPassword("secret-x\u0000");
      assert.fail("should throw");
    } catch (error) {
      assert.equal(String((error as Error).message).includes("secret"), false);
    }
  });
});
