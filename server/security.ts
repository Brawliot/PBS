/**
 * The headers that every response carries: pages, files, JSON, errors and the 413. securityHeaders() is the
 * one place that computes them; every response writer in server.ts takes its headers from it.
 * HSTS and TLS are not set here: they belong to the proxy in front of the server (see PRODUCTION.md).
 */

/**
 * The pages load nothing from outside the site and run no inline script or style (see giant.js and the
 * style attributes set through the DOM in plan.js). Keep the pages and this policy in step.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'";

export function securityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  };
}

/**
 * Why the server must not start with this environment, or undefined when it may. The development routes
 * (ENABLE_DEV_ROUTES=1) answer with fake data, so they never run in production.
 */
export function environmentProblem(env: Record<string, string | undefined>): string | undefined {
  if (env.ENABLE_DEV_ROUTES === "1" && env.NODE_ENV === "production") {
    return "The server does not start: ENABLE_DEV_ROUTES=1 is not allowed when NODE_ENV=production.";
  }
  return undefined;
}

/** Whether the development routes may answer: they are on, and this is not production */
export const devRoutesAllowed = (env: Record<string, string | undefined>): boolean =>
  env.ENABLE_DEV_ROUTES === "1" && env.NODE_ENV !== "production";

/**
 * A request that changes something must come from this same site. A browser sends its Origin header on such a
 * request: it must be the host the request was sent to. No Origin header (a tool, or a same-site form in an old
 * browser) is allowed; SameSite=Lax on the cookie is the second line of defence.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
