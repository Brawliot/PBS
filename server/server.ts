import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlannerInput } from "./planner/planner-handler.js";
import type { PlannerAnswer } from "./planner/planner-phase2-handler.js";
import type { Claims } from "./planner/planner-validation-handler.js";
import { runPlanner } from "./planner/planner-run.js";
import { JobStore } from "./jobs.js";
import { environmentProblem, originAllowed, securityHeaders } from "./security.js";
import { logFailure } from "./log.js";
import { UUID } from "./ids.js";
import { HttpError, parsePlannerRequest, readBody } from "./request.js";
import type { PlanRepository } from "./plan/plan-repository.js";
import type { ReportRepository } from "./plan/report-repository.js";
import { PgPlanRepository } from "./db/pg-plan-repository.js";
import { createPool } from "./db/pool.js";
import { PgReportRepository } from "./db/pg-report-repository.js";
import { PgUserRepository } from "./db/pg-user-repository.js";
import { PgSessionRepository } from "./auth/session-repository-pg.js";
import { handlePlanRequest, isPlanPath } from "./plan-routes.js";
import { agentsFromEnv } from "./plan/agents/configured-agents.js";
import { handleAuthRequest, userIdFromCookie, type AuthStores } from "./auth/auth-routes.js";
import { LoginLimiter } from "./auth/login-limit.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const JOB_TTL_MS = 10 * 60_000;
const MAX_JOBS = 500;
const NO_STORE = { "Cache-Control": "no-store" };

const jobs = new JobStore({ ttlMs: JOB_TTL_MS, maxJobs: MAX_JOBS });
setInterval(() => jobs.sweep(), 60_000).unref();

// Without DATABASE_URL there are no accounts and no plans: the routes that need them answer 503 (PRODUCTION.md)
const pool = process.env.DATABASE_URL ? createPool(process.env.DATABASE_URL) : undefined;
let planRepository: PlanRepository | undefined = pool && new PgPlanRepository(pool);
let reportRepository: ReportRepository | undefined = pool && new PgReportRepository(pool);
let authStores: AuthStores | undefined = pool && {
  users: new PgUserRepository(pool),
  sessions: new PgSessionRepository(pool),
};
// Failed sign-ins are counted in memory, per email (see auth/login-limit.ts)
const limiter = new LoginLimiter();
// The plan level's assistant: real only when its keys are set (the agent routes answer 503 otherwise)
const agents = agentsFromEnv(process.env);

/** The user a request acts for: the owner of its session cookie, or undefined when nobody is signed in */
async function userOf(req: IncomingMessage): Promise<string | undefined> {
  return authStores ? userIdFromCookie(authStores.sessions, req.headers.cookie, new Date()) : undefined;
}

const UNAUTHENTICATED = { error: "Log in to continue", code: "unauthenticated" };
const NO_DATABASE = { error: "Storage is not configured", code: "storage_unavailable" };

/**
 * Tests only: the stores in memory, so a test needs no database. Refused outside node --test.
 */
export function useTestStores(stores: {
  auth: AuthStores;
  plan?: PlanRepository;
  reports?: ReportRepository;
}): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("useTestStores is only for the tests");
  authStores = stores.auth;
  planRepository = stores.plan;
  reportRepository = stores.reports;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Only these front-end files are public (the repo root also holds .git, server/, etc.)
const STATIC_FILES = new Set(["/plan.html", "/plan.js", "/giant.js", "/loader.js", "/script.js", "/styles.css", "/tech-text.js", "/theme.js", "/projects.html", "/projects.js"]);
const isPublic = (path: string) =>
  STATIC_FILES.has(path) || /^\/fonts\/[\w.-]+$/.test(path);

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { "Content-Type": "application/json", ...securityHeaders(), ...headers });
  res.end(JSON.stringify(body));
}

async function sendFile(res: ServerResponse, file: string) {
  try {
    const content = await readFile(ROOT + file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      ...securityHeaders(),
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

/** Answers 413 and closes the connection once it is out: the rest of the body is not read */
function sendTooLarge(req: IncomingMessage, res: ServerResponse, message: string) {
  res.once("finish", () => req.socket.destroy());
  return sendJson(res, 413, { error: message }, { ...NO_STORE, Connection: "close" });
}

/** The sign-up, sign-in, sign-out and session routes: the logic is in auth/auth-routes.ts */
async function authRoute(req: IncomingMessage, res: ServerResponse, path: string) {
  try {
    const body = req.method === "POST" ? await readBody(req) : "";
    const result = await handleAuthRequest(
      { method: req.method ?? "", path, body, cookieHeader: req.headers.cookie, now: new Date(), secure: process.env.NODE_ENV === "production" },
      { limiter, stores: authStores },
    );
    if (!result) return sendJson(res, 404, { error: "Not found" }, NO_STORE);
    const headers = result.setCookie ? { ...NO_STORE, "Set-Cookie": result.setCookie } : NO_STORE;
    if (result.status === 204) {
      res.writeHead(204, { ...securityHeaders(), ...headers });
      return res.end();
    }
    return sendJson(res, result.status, result.body, headers);
  } catch (e) {
    if (e instanceof HttpError && e.status === 413) return sendTooLarge(req, res, e.message);
    logFailure("auth request", e);
    return sendJson(res, 500, { error: "Internal server error" }, NO_STORE);
  }
}

/** The plan API: the body is read here (same limit as the planner), the rest is plan-routes.ts */
async function planRoute(req: IncomingMessage, res: ServerResponse, path: string) {
  try {
    // The body is read first, so a too-large or broken upload is answered and logged the same whoever sends it
    const body = req.method === "POST" ? await readBody(req) : "";
    const userId = await userOf(req);
    // Without a database there is no session either: the handler then checks the body and answers 503
    if (!userId && planRepository) return sendJson(res, 401, UNAUTHENTICATED, NO_STORE);
    const result = await handlePlanRequest({
      method: req.method ?? "",
      path,
      userId: userId ?? "",
      body,
      repo: planRepository,
      reports: reportRepository,
      agents,
      now: () => new Date().toISOString(),
      env: process.env,
    });
    return sendJson(res, result.status, result.body, NO_STORE);
  } catch (e) {
    if (e instanceof HttpError && e.status === 413) return sendTooLarge(req, res, e.message);
    logFailure("plan request", e);
    return sendJson(res, 500, { error: "Internal server error" }, NO_STORE);
  }
}

export const server = createServer(async (req, res) => {
  // A target that does not parse (or has a broken percent-encoding) is a bad request, not a crash
  let path: string;
  try {
    path = new URL(req.url ?? "/", "http://localhost").pathname;
    decodeURIComponent(path);
  } catch {
    res.writeHead(400, { ...securityHeaders(), "Content-Length": "0" });
    return res.end();
  }
  // Every request that changes something must come from this site (see security.ts). Cancelling a job changes it too.
  if ((req.method === "POST" || req.method === "DELETE") && !originAllowed(req.headers.origin, req.headers.host)) {
    return sendJson(res, 403, { error: "Forbidden origin", code: "forbidden_origin" }, NO_STORE);
  }
  if (path.startsWith("/api/auth/")) return authRoute(req, res, path);
  if (isPlanPath(path)) return planRoute(req, res, path);

  if (req.method === "GET") {
    if (path === "/") return sendFile(res, "index.html");
    if (path === "/plan") return sendFile(res, "plan.html");
    if (path === "/projects") return sendFile(res, "projects.html");
    if (isPublic(path)) return sendFile(res, path.slice(1));
  }

  const jobPath = path.match(/^\/api\/planner\/([^/]+)$/);
  if (req.method === "GET" && jobPath) {
    if (!authStores) return sendJson(res, 503, NO_DATABASE, NO_STORE);
    const owner = await userOf(req);
    if (!owner) return sendJson(res, 401, UNAUTHENTICATED, NO_STORE);
    const id = jobPath[1];
    // Another user's job is not found, the same as a job that does not exist
    const job = UUID.test(id) ? jobs.get(id, owner) : undefined;
    if (!job) return sendJson(res, 404, { error: "Job not found" }, NO_STORE);
    if (job.status === "pending") return sendJson(res, 200, { status: "pending" }, NO_STORE);
    if (job.status === "done") {
      return sendJson(res, 200, { status: "done", result: job.result }, NO_STORE);
    }
    return sendJson(res, 200, { status: "error", message: job.message }, NO_STORE);
  }

  // Cancel: the person stopped waiting. The work is aborted and nothing is kept for it.
  if (req.method === "DELETE" && jobPath) {
    if (!authStores) return sendJson(res, 503, NO_DATABASE, NO_STORE);
    const owner = await userOf(req);
    if (!owner) return sendJson(res, 401, UNAUTHENTICATED, NO_STORE);
    const id = jobPath[1];
    if (!UUID.test(id) || !jobs.cancel(id, owner)) return sendJson(res, 404, { error: "Job not found" }, NO_STORE);
    res.writeHead(204, { ...securityHeaders(), ...NO_STORE });
    return res.end();
  }

  if (path === "/api/planner" && req.method === "POST") {
    try {
      // The body is read first, so a too-large body is 413 whoever sends it
      const raw = await readBody(req);
      // The body is checked first, as on the plan routes: a bad request is 400 whoever sends it
      const { input, answers, final, claims, glance } = parsePlannerRequest(raw);
      if (!authStores || !reportRepository) return sendJson(res, 503, NO_DATABASE, NO_STORE);
      const owner = await userOf(req);
      if (!owner) return sendJson(res, 401, UNAUTHENTICATED, NO_STORE);
      // Planner errors can carry internal details: only HttpError messages reach the client
      const jobId = jobs.start(owner, (signal) =>
        runPlanner(input, answers, final, claims, { reports: reportRepository, owner, signal }, glance).catch((e) => {
          if (e instanceof HttpError) throw e;
          throw new Error("Internal server error", { cause: e });
        }),
      );
      return sendJson(res, 202, { jobId });
    } catch (e) {
      if (e instanceof HttpError && e.status === 413) return sendTooLarge(req, res, e.message);
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      logFailure("planner request", e);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

// Tests import the server and listen on an ephemeral port themselves (NODE_TEST_CONTEXT is set by node --test)
if (!process.env.NODE_TEST_CONTEXT) {
  const problem = environmentProblem(process.env);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  server.listen(PORT, () => console.log(`http://localhost:${PORT}/`));
}
