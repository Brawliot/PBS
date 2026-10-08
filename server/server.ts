import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlannerInput } from "./planner/planner-handler.js";
import type { PlannerAnswer } from "./planner/planner-phase2-handler.js";
import type { Claims } from "./planner/planner-validation-handler.js";
import { runPlanner } from "./planner/planner-run.js";
import { JobStore } from "./jobs.js";
import { environmentProblem, securityHeaders } from "./security.js";
import { logFailure } from "./log.js";
import { UUID } from "./ids.js";
import { HttpError, parsePlannerRequest, readBody } from "./request.js";
import { PgPlanRepository } from "./db/pg-plan-repository.js";
import { createPool } from "./db/pool.js";
import { PgReportRepository } from "./db/pg-report-repository.js";
import { handlePlanRequest, isPlanPath, LOCAL_USER } from "./plan-routes.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const JOB_TTL_MS = 10 * 60_000;
const MAX_JOBS = 500;
const NO_STORE = { "Cache-Control": "no-store" };

const jobs = new JobStore({ ttlMs: JOB_TTL_MS, maxJobs: MAX_JOBS });
setInterval(() => jobs.sweep(), 60_000).unref();

// Without DATABASE_URL the planner still works; the plan routes answer 503 and no report is kept
const pool = process.env.DATABASE_URL ? createPool(process.env.DATABASE_URL) : undefined;
const planRepository = pool && new PgPlanRepository(pool);
const reportRepository = pool && new PgReportRepository(pool);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Only these front-end files are public (the repo root also holds .git, server/, etc.)
const STATIC_FILES = new Set(["/plan.html", "/plan.js", "/giant.js", "/loader.js", "/script.js", "/styles.css", "/tech-text.js"]);
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

/** The plan API: the body is read here (same limit as the planner), the rest is plan-routes.ts */
async function planRoute(req: IncomingMessage, res: ServerResponse, path: string) {
  try {
    const body = req.method === "POST" ? await readBody(req) : "";
    const result = await handlePlanRequest({
      method: req.method ?? "",
      path,
      body,
      repo: planRepository,
      reports: reportRepository,
      now: () => new Date().toISOString(),
      env: process.env,
    });
    return sendJson(res, result.status, result.body, NO_STORE);
  } catch (e) {
    if (e instanceof HttpError && e.status === 413) {
      res.once("finish", () => req.socket.destroy());
      return sendJson(res, 413, { error: e.message }, { ...NO_STORE, Connection: "close" });
    }
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
  if (isPlanPath(path)) return planRoute(req, res, path);

  if (req.method === "GET") {
    if (path === "/") return sendFile(res, "index.html");
    if (path === "/plan") return sendFile(res, "plan.html");
    if (isPublic(path)) return sendFile(res, path.slice(1));
  }

  const jobPath = path.match(/^\/api\/planner\/([^/]+)$/);
  if (req.method === "GET" && jobPath) {
    const id = jobPath[1];
    const job = UUID.test(id) ? jobs.get(id) : undefined;
    if (!job) return sendJson(res, 404, { error: "Job not found" }, NO_STORE);
    if (job.status === "pending") return sendJson(res, 200, { status: "pending" }, NO_STORE);
    if (job.status === "done") {
      return sendJson(res, 200, { status: "done", result: job.result }, NO_STORE);
    }
    return sendJson(res, 200, { status: "error", message: job.message }, NO_STORE);
  }

  if (path === "/api/planner" && req.method === "POST") {
    try {
      const { input, answers, final, claims } = parsePlannerRequest(await readBody(req));
      // Planner errors can carry internal details: only HttpError messages reach the client
      const jobId = jobs.start(() =>
        runPlanner(input, answers, final, claims, { reports: reportRepository, owner: LOCAL_USER }).catch((e) => {
          if (e instanceof HttpError) throw e;
          throw new Error("Internal server error", { cause: e });
        }),
      );
      return sendJson(res, 202, { jobId });
    } catch (e) {
      if (e instanceof HttpError && e.status === 413) {
        // The rest of the oversized body is not read: close the connection once the 413 is out
        res.once("finish", () => req.socket.destroy());
        return sendJson(res, 413, { error: e.message }, { Connection: "close" });
      }
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
