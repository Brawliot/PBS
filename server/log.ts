/**
 * The one way the server writes a failure to its log. A line carries the context, the name of the error, and
 * a short code when there is one. It never carries the message, the stack or the cause of an error, because
 * those can hold values from a request, a plan or a provider's answer.
 */

import { HttpError } from "./request.js";

/** The longest code that is safe to log: a code is lowercase letters and underscores only */
export const MAX_CODE_LENGTH = 40;
/** A code that is safe to log: lowercase letters and underscores only, at most MAX_CODE_LENGTH characters */
const SAFE_CODE = new RegExp(`^[a-z_]{1,${MAX_CODE_LENGTH}}$`);

/** The code of an error, if it has one that is safe to write: an HttpError's status, or a short code */
function safeCode(error: unknown): string | undefined {
  if (error instanceof HttpError) return `status ${error.status}`;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && SAFE_CODE.test(code) ? code : undefined;
}

/** The name of an error: the class name for an Error, the type for anything else */
function nameOf(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

/** Writes "context: Name (code)" for a failure. Only these parts are written. */
export function logFailure(context: string, error: unknown): void {
  const code = safeCode(error);
  console.error(`${context}: ${nameOf(error)}${code ? ` (${code})` : ""}`);
}

/**
 * A failed call to an outside provider. The body of the answer is never written. A body that is JSON with
 * a "type" or "code" that is safe is written as that code; any other body gives no code.
 */
export function logProviderFailure(provider: string, status: number, body: string): void {
  let code: string | undefined;
  try {
    const parsed = JSON.parse(body) as { type?: unknown; code?: unknown; error?: { type?: unknown; code?: unknown } } | null;
    const candidate = [parsed?.type, parsed?.code, parsed?.error?.type, parsed?.error?.code].find(
      (value): value is string => typeof value === "string" && SAFE_CODE.test(value),
    );
    code = candidate;
  } catch {
    code = undefined;
  }
  console.error(`${provider} error: status ${status}${code ? ` (${code})` : ""}`);
}
