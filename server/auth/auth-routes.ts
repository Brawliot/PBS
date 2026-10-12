/**
 * The sign-up, sign-in, sign-out and session routes, as a pure function: a request goes in, a status, a body
 * and an optional cookie come out. The repositories, the clock and the limiter are passed in, so the tests
 * need no server. server.ts only reads and writes the headers. There is no email verification: whoever
 * registers is signed in at once.
 *
 * Errors are {error, code}: the text is fixed for each code and never carries what was sent.
 */

import { z } from "zod";
import { checkAgainstNothing, checkPassword, hashPassword, PasswordError, verifyPassword } from "./passwords.js";
import { clearedSessionCookie, hashToken, newToken, SESSION_MS, sessionCookie, tokenFromCookieHeader } from "./session-cookie.js";
import type { SessionRepository } from "./session-repository.js";
import type { LoginLimiter } from "./login-limit.js";
import { MAX_NAME_LENGTH, prepareUser, UserStoreError, type UserRepository } from "../user/user-repository.js";

export const MIN_NAME_LENGTH = 2;

export interface AuthStores {
  users: UserRepository;
  sessions: SessionRepository;
}

export interface AuthRequest {
  method: string;
  path: string;
  /** The body as text; empty for a GET */
  body: string;
  cookieHeader?: string;
  now: Date;
  /** Cookies carry Secure in production */
  secure: boolean;
}

export interface AuthResponse {
  status: number;
  body?: unknown;
  setCookie?: string;
}

export const AUTH_MESSAGES = {
  invalid_body: "The request is not valid",
  invalid_name: `The name must have ${MIN_NAME_LENGTH} to ${MAX_NAME_LENGTH} characters`,
  invalid_email: "The email is not valid",
  invalid_password: "The password must have 8 to 64 characters, with no control characters",
  email_taken: "An account with this email already exists",
  invalid_credentials: "The email or the password is not right",
  too_many_attempts: "Too many attempts. Try again in a few minutes",
  storage_unavailable: "Accounts are not available: the database is not configured",
} as const;

export type AuthCode = keyof typeof AUTH_MESSAGES;

const fail = (status: number, code: AuthCode): AuthResponse => ({ status, body: { error: AUTH_MESSAGES[code], code } });

const RegisterBody = z.strictObject({ name: z.string(), email: z.string(), password: z.string() });
const LoginBody = z.strictObject({ email: z.string(), password: z.string() });

function parseBody<T extends z.ZodType>(schema: T, raw: string): z.output<T> | undefined {
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** The user of a request's session cookie, or undefined when there is no valid session */
export async function userIdFromCookie(
  sessions: SessionRepository,
  cookieHeader: string | undefined,
  now: Date,
): Promise<string | undefined> {
  const token = tokenFromCookieHeader(cookieHeader);
  return token === undefined ? undefined : sessions.findUserId(hashToken(token), now);
}

/** Makes a session for a user and returns the cookie that carries it */
async function startSession(stores: AuthStores, userId: string, now: Date, secure: boolean): Promise<string> {
  const token = newToken();
  await stores.sessions.create({ tokenHash: hashToken(token), userId, expiresAt: new Date(now.getTime() + SESSION_MS) }, now);
  return sessionCookie(token, secure);
}

export interface AuthDeps {
  limiter: LoginLimiter;
  /** Undefined when there is no database: the accounts then cannot be made or checked */
  stores?: AuthStores;
}

export async function handleAuthRequest(request: AuthRequest, deps: AuthDeps): Promise<AuthResponse | undefined> {
  const { method, path, now, secure } = request;
  const stores = deps.stores;

  if (method === "POST" && path === "/api/auth/register") {
    if (!stores) return fail(503, "storage_unavailable");
    const body = parseBody(RegisterBody, request.body);
    if (!body) return fail(400, "invalid_body");
    const name = body.name.trim();
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) return fail(400, "invalid_name");
    let email: string;
    try {
      email = prepareUser(body.email, name).email;
    } catch (error) {
      return fail(400, (error as UserStoreError).code === "invalid_name" ? "invalid_name" : "invalid_email");
    }
    try {
      checkPassword(body.password);
    } catch (error) {
      if (error instanceof PasswordError) return fail(400, "invalid_password");
      throw error;
    }
    const passwordHash = await hashPassword(body.password);
    let user;
    try {
      user = await stores.users.create(email, name, passwordHash);
    } catch (error) {
      if (error instanceof UserStoreError && error.code === "email_taken") return fail(409, "email_taken");
      throw error;
    }
    const setCookie = await startSession(stores, user.id, now, secure);
    return { status: 201, body: { user: { name: user.name } }, setCookie };
  }

  if (method === "POST" && path === "/api/auth/login") {
    if (!stores) return fail(503, "storage_unavailable");
    const body = parseBody(LoginBody, request.body);
    if (!body) return fail(400, "invalid_body");
    const email = body.email.trim().toLowerCase();
    if (deps.limiter.blocked(email, now)) return fail(429, "too_many_attempts");
    const user = await stores.users.findByEmail(email);
    // An unknown email does the same work as a wrong password: the time does not show which emails exist
    const correct = user
      ? await verifyPassword(body.password, user.passwordHash)
      : await checkAgainstNothing(body.password);
    if (!user || !correct) {
      deps.limiter.fail(email, now);
      return fail(401, "invalid_credentials");
    }
    deps.limiter.clear(email);
    await stores.sessions.removeExpired(now);
    const setCookie = await startSession(stores, user.id, now, secure);
    return { status: 200, body: { user: { name: user.name } }, setCookie };
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const token = tokenFromCookieHeader(request.cookieHeader);
    if (token !== undefined && stores) await stores.sessions.remove(hashToken(token));
    return { status: 204, setCookie: clearedSessionCookie(secure) };
  }

  if (method === "GET" && path === "/api/auth/session") {
    const userId = stores ? await userIdFromCookie(stores.sessions, request.cookieHeader, now) : undefined;
    const user = userId && stores ? await stores.users.findById(userId) : undefined;
    return { status: 200, body: { user: user ? { name: user.name } : null } };
  }

  return undefined;
}
