import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { InputKey, PlannerInput } from "./planner/planner-handler.js";
import { START_MODES, PREMISES } from "./planner/fixed-answers.js";
import type { PlannerAnswer } from "./planner/planner-phase2-handler.js";
import { cleanClaims, type Claims } from "./planner/planner-validation-handler.js";
import { parseGlance, type Glance } from "./plan/glance.js";
import { IMPROVE_KEY, isImproveAnswer } from "./plan/improve-questions.js";

/** The body of the detection request: only the idea. The same limits as the planner's idea. */
export function parseDetectRequest(raw: string): { idea: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  if (typeof body !== "object" || body === null) throw new HttpError(400, "Invalid JSON");
  const value = (body as { idea?: unknown }).idea;
  if (typeof value === "string" && CONTROL_CHARACTERS.test(value)) {
    throw new HttpError(400, "The idea cannot contain control characters");
  }
  const idea = typeof value === "string" ? value.trim() : "";
  if (!idea) throw new HttpError(400, "Idea is required");
  if (idea.length > MAX_IDEA) throw new HttpError(400, "Idea is too long");
  return { idea };
}

/** Request parsing and limits for the planner API: everything that turns the body into trusted input */
export const MAX_LOCATION = 200; // characters for the location answer
/** Budget in euros: the most the budget question can give (PROFILE_QUESTIONS in script.js) */
export const MAX_BUDGET = 1_000_000;

/** The fixed questions, in the order they are asked (PROFILE_QUESTIONS in script.js) */
export const INPUT_KEYS: InputKey[] = ["location", "budget", "start_mode", "premises"];

/**
 * The value each fixed question takes when it is answered "I don't know". It is only a placeholder: the key is in
 * `unknown` and every reader checks that first (see isUnknown).
 */
const UNKNOWN_PLACEHOLDER = { location: "", budget: 0, start_mode: START_MODES[0], premises: PREMISES[0] } as const;

/** The value of each fixed question when it is answered. Closed lists for the choices, a limit for the free text. */
const FIELD_SCHEMA = {
  location: z
    .string()
    .trim()
    .max(MAX_LOCATION)
    .refine((value) => value.length > 0 && !CONTROL_CHARACTERS.test(value), "location must be a place"),
  budget: z.number().finite().min(0).max(MAX_BUDGET),
  start_mode: z.enum(START_MODES),
  premises: z.enum(PREMISES),
} as const;

export const MAX_ANSWERS = 12;
export const MAX_TEXT = 1000; // characters per answer field
export const MAX_IDEA = 2000; // characters for the idea field
const JEV_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    // An answer of "Improve my report" is one of the options of its question, never free text (improve-questions.ts)
    if (IMPROVE_KEY.test(t) && !isImproveAnswer(t, a)) {
      throw new HttpError(400, "An improve answer is not one of its options");
    }
    return { topic: t, question: q, answer: a };
  });
}

/**
 * The fixed questions answered "I don't know": a list of distinct fixed keys, or nothing. Anything else is
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
  // In the order of the fixed questions, so the same answers always give the same input
  return INPUT_KEYS.filter((key) => value.includes(key));
}

/** The fixed answers of the body, checked against FIELD_SCHEMA. A key answered "I don't know" has no value. */
export function parseFixedInputs(body: Record<string, unknown>, unknown: InputKey[]): Omit<PlannerInput, "idea" | "unknown"> {
  const known = INPUT_KEYS.filter((key) => !unknown.includes(key));
  const schema = z.object(Object.fromEntries(known.map((key) => [key, FIELD_SCHEMA[key]])));
  const parsed = schema.safeParse(Object.fromEntries(known.map((key) => [key, body[key]])));
  if (!parsed.success) {
    const key = String(parsed.error.issues[0]?.path[0] ?? "answer");
    throw new HttpError(400, `${key} is not a valid answer`);
  }
  return { ...UNKNOWN_PLACEHOLDER, ...parsed.data } as Omit<PlannerInput, "idea" | "unknown">;
}

export function parsePlannerRequest(raw: string): {
  input: PlannerInput;
  answers: PlannerAnswer[];
  final: boolean;
  claims: Claims;
  glance?: Glance;
  jevToken?: string;
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
  const input: PlannerInput = { idea, ...parseFixedInputs(body, unknown) };
  if (unknown.length) input.unknown = unknown;
  // The glance is only used by the final request: the first round builds its own from its phase 2
  const glance = final ? parseGlance(body.glance) : undefined;
  // A token that is not in the shape of one is ignored: the planner then asks Jev itself
  const jevToken = typeof body.jevToken === "string" && JEV_TOKEN.test(body.jevToken) ? body.jevToken : undefined;
  return {
    input,
    answers: parseAnswers(body.answers),
    final,
    claims: cleanClaims(body.analysis),
    ...(glance && { glance }),
    ...(jevToken && { jevToken }),
  };
}
