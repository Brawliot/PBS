import type { IncomingMessage } from "node:http";
import type { InputKey, PlannerInput } from "./planner/planner-handler.js";
import type { PlannerAnswer } from "./planner/planner-phase2-handler.js";
import { cleanClaims, type Claims } from "./planner/planner-validation-handler.js";
import { parseGlance, type Glance } from "./plan/glance.js";

/** Request parsing and limits for the planner API: everything that turns the body into trusted input */
// Ranges of the four fixed questions (PROFILE_QUESTIONS in script.js)
export const RANGES = {
  budget: [0, 1_000_000],
  experience: [0, 20],
  team: [0, 3],
  hours: [0, 3],
} as const;

export const INPUT_KEYS = Object.keys(RANGES) as InputKey[];

export const MAX_ANSWERS = 12;
export const MAX_TEXT = 1000; // characters per answer field
export const MAX_IDEA = 2000; // characters for the idea field
export const MAX_BODY = 100_000; // bytes for request body
/**
 * Control characters: U+0000 to U+001F and U+007F, except tab and newline. PostgreSQL refuses U+0000 in jsonb,
 * and none of the others belong in an idea or an answer.
 */
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F]/;

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
    let bytes = 0;
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (tooLarge) return;
      // Bytes, not characters: a multibyte character counts for its full size
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY) {
        tooLarge = true;
        data = "";
        reject(new HttpError(413, "Request too large"));
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!tooLarge) resolve(data);
    });
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
    // Checked before the trim: a control character is refused, not silently cut off at the edge
    if ([topic, question, answer].some((field) => typeof field === "string" && CONTROL_CHARACTERS.test(field))) {
      throw new HttpError(400, "Answers cannot contain control characters");
    }
    // Trimmed first, so the length limit applies to the text that is kept
    const [t, q, a] = [topic, question, answer].map((field) =>
      typeof field === "string" ? field.trim() : "",
    );
    for (const field of [t, q, a]) {
      if (!field || field.length > MAX_TEXT) {
        throw new HttpError(400, "Each answer needs a topic, a question and an answer");
      }
    }
    return { topic: t, question: q, answer: a };
  });
}

/**
 * The fixed questions answered "I don't know": a list of distinct keys of RANGES, or nothing. Anything else is
 * refused, so a typo never silently turns a known answer into an unknown one.
 */
export function parseUnknownInputs(value: unknown): InputKey[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((key) => !INPUT_KEYS.includes(key)) ||
    new Set(value).size !== value.length
  ) {
    throw new HttpError(400, `unknown must be a list of distinct keys among ${INPUT_KEYS.join(", ")}`);
  }
  // In the order of RANGES, so the same answers always give the same input
  return INPUT_KEYS.filter((key) => value.includes(key));
}

export function parsePlannerRequest(raw: string): {
  input: PlannerInput;
  answers: PlannerAnswer[];
  final: boolean;
  claims: Claims;
  glance?: Glance;
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

  if (typeof body.idea === "string" && CONTROL_CHARACTERS.test(body.idea)) {
    throw new HttpError(400, "The idea cannot contain control characters");
  }
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (!idea) throw new HttpError(400, "Idea is required");
  if (idea.length > MAX_IDEA) throw new HttpError(400, "Idea is too long");

  if (body.final !== undefined && typeof body.final !== "boolean") {
    throw new HttpError(400, "final must be a boolean");
  }
  const final = body.final === true;

  const unknown = parseUnknownInputs(body.unknown);
  const input = { idea } as PlannerInput;
  for (const [key, [min, max]] of Object.entries(RANGES) as [
    keyof typeof RANGES,
    readonly [number, number],
  ][]) {
    // An "I don't know" has no number: whatever was sent is ignored, and the lowest of the range stands in
    if (unknown.includes(key)) {
      input[key] = min;
      continue;
    }
    const value = body[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new HttpError(400, `${key} must be a number between ${min} and ${max}`);
    }
    input[key] = value;
  }
  if (unknown.length) input.unknown = unknown;
  // The glance is only used by the final request: the first round builds its own from its phase 2
  const glance = final ? parseGlance(body.glance) : undefined;
  return { input, answers: parseAnswers(body.answers), final, claims: cleanClaims(body.analysis), ...(glance && { glance }) };
}
