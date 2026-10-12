/**
 * Passwords: how they are checked and how they are kept. A password is never stored, only a hash made with
 * scrypt (a slow function built into Node, so no new dependency). Each hash carries its own random salt and
 * its settings, so the settings can grow later without breaking old hashes:
 *   scrypt$<N>$<r>$<p>$<salt in base64>$<hash in base64>
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 64;

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64, saltLength: 16 };
/** Control characters, tab and new line included: a password is typed on one line */
const NOT_ALLOWED = /[\u0000-\u001F\u007F]/;

export type PasswordCode = "invalid_password";

/** A password that is not allowed. The message is fixed: nothing of the password goes in it. */
export class PasswordError extends Error {
  constructor(readonly code: PasswordCode) {
    super("Password is not allowed");
  }
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Throws PasswordError when the password is too short, too long, or holds a control character */
export function checkPassword(password: string): void {
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH || NOT_ALLOWED.test(password)) {
    throw new PasswordError("invalid_password");
  }
}

/** The hash to keep for this password. Checks it first: throws PasswordError if it is not allowed. */
export async function hashPassword(password: string): Promise<string> {
  checkPassword(password);
  const salt = randomBytes(SCRYPT.saltLength);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** True when the password matches the stored hash. A missing or damaged hash never matches. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split("$") ?? [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length !== SCRYPT.saltLength || expected.length !== SCRYPT.keyLength) return false;
  const key = await derive(password, salt, N, r, p, expected.length);
  return timingSafeEqual(key, expected);
}

/**
 * Used when the email is unknown: it does the same work as a real check, so the time of the answer does not
 * reveal which emails have an account. The answer is always false.
 */
export async function checkAgainstNothing(password: string): Promise<false> {
  await derive(password, DUMMY_SALT, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return false;
}

const DUMMY_SALT = Buffer.alloc(SCRYPT.saltLength, 1);
