import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithJev, type PlannerInput } from "./planner/planner-handler.js";

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

// Slider ranges, same as index.html
const RANGES = {
  budget: [0, 1_000_000],
  experience: [0, 20],
  team: [0, 3],
  hours: [0, 3],
} as const;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

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

function parsePlannerInput(raw: string): PlannerInput {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "Invalid JSON");
  }

  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (!idea) throw new HttpError(400, "Idea is required");

  const input = { idea } as PlannerInput;
  for (const [key, [min, max]] of Object.entries(RANGES) as [
    keyof typeof RANGES,
    readonly [number, number],
  ][]) {
    const value = body[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new HttpError(400, `${key} must be a number between ${min} and ${max}`);
    }
    input[key] = value;
  }
  return input;
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET") {
    if (path === "/") return sendFile(res, "index.html");
    if (isPublic(path)) return sendFile(res, path.slice(1));
  }

  if (path === "/api/planner" && req.method === "POST") {
    try {
      const input = parsePlannerInput(await readBody(req));
      return sendJson(res, 200, await analyzeWithJev(input));
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  }

  sendJson(res, 404, { error: "Not found" });
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
