import { createServer, type ServerResponse } from "node:http";
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
import { HttpError, parsePlannerRequest, readBody } from "./request.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Only these front-end files are public (the repo root also holds .git, server/, etc.)
const STATIC_FILES = new Set(["/script.js", "/styles.css", "/tech-text.js"]);
const isPublic = (path: string) =>
  STATIC_FILES.has(path) || /^\/fonts\/[\w.-]+$/.test(path);

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
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

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET") {
    if (path === "/") return sendFile(res, "index.html");
    if (isPublic(path)) return sendFile(res, path.slice(1));
  }

  if (path === "/api/planner" && req.method === "POST") {
    try {
      const { input, answers, final, claims } = parsePlannerRequest(await readBody(req));
      const jev = await analyzeWithJev(input);

      // Final request: the questions are answered, so only the profile is left
      if (final) {
        return sendJson(res, 200, { jev, ...(await buildReport(input, jev, answers, claims)) });
      }

      const phase2 = await analyzePhase2(input, jev, answers);
      const questions = selectQuestions(
        phase2.questions,
        answers,
        questionLimit(phase2.maturity, input),
      );
      if (questions.length === 0) {
        const report = await buildReport(input, jev, answers, claimsFromPhase2(phase2), phase2);
        return sendJson(res, 200, { jev, phase2: { ...phase2, questions }, ...report });
      }
      return sendJson(res, 200, {
        jev,
        phase2: { ...phase2, questions },
        questionTotal: answers.length + questions.length,
      });
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  }

  sendJson(res, 404, { error: "Not found" });
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
