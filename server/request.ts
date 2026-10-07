import type { IncomingMessage } from "node:http";
import type { PlannerInput } from "./planner/planner-handler.js";
import type { PlannerAnswer } from "./planner/planner-phase2-handler.js";
import { cleanClaims, type Claims } from "./planner/planner-validation-handler.js";

/** Request parsing and limits for the planner API: everything that turns the body into trusted input */
// Slider ranges, same as index.html
export const RANGES = {
  budget: [0, 1_000_000],
  experience: [0, 20],
  team: [0, 3],
  hours: [0, 3],
} as const;

export const MAX_ANSWERS = 12;
export const MAX_TEXT = 1000; // characters per answer field
export const MAX_IDEA = 2000; // characters for the idea field
export const MAX_BODY = 100_000; // bytes for request body

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new HttpError(413, "Request too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function parseAnswers(value: unknown): PlannerAnswer[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ANSWERS) {
    throw new HttpError(400, "answers must be a short list");
  }
  return value.map((item) => {
    const { topic, question, answer } = item ?? {};
    for (const field of [topic, question, answer]) {
      if (typeof field !== "string" || !field.trim() || field.length > MAX_TEXT) {
        throw new HttpError(400, "Each answer needs a topic, a question and an answer");
      }
    }
    return { topic: topic.trim(), question: question.trim(), answer: answer.trim() };
  });
}

export function parsePlannerRequest(raw: string): {
  input: PlannerInput;
  answers: PlannerAnswer[];
  final: boolean;
  claims: Claims;
} {
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
  if (idea.length > MAX_IDEA) throw new HttpError(400, "Idea is too long");

  if (body.final !== undefined && typeof body.final !== "boolean") {
    throw new HttpError(400, "final must be a boolean");
  }
  const final = body.final === true;

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
  return { input, answers: parseAnswers(body.answers), final, claims: cleanClaims(body.analysis) };
}
