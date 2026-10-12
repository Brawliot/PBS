/**
 * The session cookie: a random token in the browser, and only its hash on the server (see session-repository).
 * The cookie cannot be read by the page's scripts (HttpOnly), is not sent by other sites' requests (SameSite=Lax),
 * and carries Secure in production, where the TLS is set by the proxy in front of the server.
 */

import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "pbs_session";
/** How long a session lasts after it is made: 30 days */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_SECONDS = SESSION_MS / 1000;
/** 32 random bytes in base64url: always 43 characters */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const newToken = (): string => randomBytes(32).toString("base64url");

/** The value kept in the database: a SHA-256 of the token. A copy of the database cannot be used to sign in. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

/** The cookie that makes the browser forget the session */
export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** The token from a Cookie header, or undefined when there is none or it does not have the right shape */
export function tokenFromCookieHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return TOKEN_SHAPE.test(value) ? value : undefined;
  }
  return undefined;
}
