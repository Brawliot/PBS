import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { analyzeWithJev } from "./planner/planner-handler.js";

const plannerHtml = readFileSync("./planner.html", "utf8"); // tu página /planner

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (path === "/planner" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(plannerHtml);
  }

  if (path === "/api/planner" && req.method === "POST") {
    try {
      const { input } = JSON.parse(await readBody(req));
      if (!input?.trim()) return sendJson(res, 400, { error: "Input is required" });
      return sendJson(res, 200, await analyzeWithJev(input.trim()));
    } catch (e) {
      return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  sendJson(res, 404, { error: "Not found" });
}).listen(3000, () => console.log("http://localhost:3000/planner"));