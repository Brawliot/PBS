import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithJev, type JevResponse, type PlannerInput } from "./planner/planner-handler.js";
import { analyzePhase2, type Phase2Response, type PlannerAnswer } from "./planner/planner-phase2-handler.js";
import { analyzeProfile } from "./planner/planner-profile-handler.js";
import { questionLimit, selectQuestions } from "./planner/question-policy.js";
import {
  analyzeValidation,
  claimsFromPhase2,
  departmentLevel,
  type Claims,
} from "./planner/planner-validation-handler.js";
import { JobStore } from "./jobs.js";
import { HttpError, parsePlannerRequest, readBody } from "./request.js";
import { createPool, PgPlanRepository } from "./db/pg-plan-repository.js";
import { handlePlanRequest, isPlanPath } from "./plan-routes.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const JOB_TTL_MS = 10 * 60_000;
const MAX_JOBS = 500;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_STORE = { "Cache-Control": "no-store" };

const jobs = new JobStore({ ttlMs: JOB_TTL_MS, maxJobs: MAX_JOBS });
setInterval(() => jobs.sweep(), 60_000).unref();

// Without DATABASE_URL the planner still works; only the plan routes answer 503
const planRepository = process.env.DATABASE_URL
  ? new PgPlanRepository(createPool(process.env.DATABASE_URL))
  : undefined;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Only these front-end files are public (the repo root also holds .git, server/, etc.)
const STATIC_FILES = new Set(["/plan.html", "/plan.js", "/loader.js", "/script.js", "/styles.css", "/tech-text.js"]);
const isPublic = (path: string) =>
  STATIC_FILES.has(path) || /^\/fonts\/[\w.-]+$/.test(path);

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function sendFile(res: ServerResponse, file: string) {
  try {
    const content = await readFile(ROOT + file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

/** Last step: classify the profile and validate the analysis, both at once */
async function buildReport(
  input: PlannerInput,
  jev: JevResponse,
  answers: PlannerAnswer[],
  claims: Claims,
  phase2?: Phase2Response,
) {
  const [profile, validation] = await Promise.all([
    analyzeProfile(input, jev, phase2, answers),
    analyzeValidation(input, jev, claims, answers),
  ]);
  return { profile, validation: { ...validation, level: departmentLevel(profile, input) } };
}

/** One planner run: Jev, then phase 2 or the final report. Returns the response body. */
async function runPlanner(
  input: PlannerInput,
  answers: PlannerAnswer[],
  final: boolean,
  claims: Claims,
) {
  const jev = await analyzeWithJev(input);

  // Final request: the questions are answered, so only the profile is left
  if (final) {
    return { jev, ...(await buildReport(input, jev, answers, claims)) };
  }

  const phase2 = await analyzePhase2(input, jev, answers);
  const questions = selectQuestions(
    phase2.questions,
    answers,
    questionLimit(phase2.maturity, input),
  );
  if (questions.length === 0) {
    const report = await buildReport(input, jev, answers, claimsFromPhase2(phase2), phase2);
    return { jev, phase2: { ...phase2, questions }, ...report };
  }
  return {
    jev,
    phase2: { ...phase2, questions },
    questionTotal: answers.length + questions.length,
  };
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
      now: () => new Date().toISOString(),
      env: process.env,
    });
    return sendJson(res, result.status, result.body, NO_STORE);
  } catch (e) {
    if (e instanceof HttpError && e.status === 413) {
      res.once("finish", () => req.socket.destroy());
      return sendJson(res, 413, { error: e.message }, { ...NO_STORE, Connection: "close" });
    }
    console.error(e instanceof Error ? e.name : "unknown error");
    return sendJson(res, 500, { error: "Internal server error" }, NO_STORE);
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (isPlanPath(path)) return planRoute(req, res, path);

  if (req.method === "GET") {
    if (path === "/") return sendFile(res, "index.html");
    if (path === "/plan") return sendFile(res, "plan.html");
    if (isPublic(path)) return sendFile(res, path.slice(1));
  }

  const jobPath = path.match(/^\/api\/planner\/([^/]+)$/);
  if (req.method === "GET" && jobPath) {
    const id = jobPath[1];
    const job = JOB_ID.test(id) ? jobs.get(id) : undefined;
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
        runPlanner(input, answers, final, claims).catch((e) => {
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
      console.error(e);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  }

  sendJson(res, 404, { error: "Not found" });
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
