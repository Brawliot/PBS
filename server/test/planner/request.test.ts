import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  HttpError,
  MAX_ANSWERS,
  MAX_BODY,
  MAX_IDEA,
  MAX_BUDGET,
  MAX_LOCATION,
  MAX_TEXT,
  parseAnswers,
  parsePlannerRequest,
  readBody,
} from "../../request.js";
import { PREMISES, START_MODES } from "../../planner/fixed-answers.js";
import "./helpers.js";

const validBody = { idea: "A bakery that delivers", budget: 0, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const};
const parse = (overrides: Record<string, unknown>) => parsePlannerRequest(JSON.stringify({ ...validBody, ...overrides }));

function assertHttpError(run: () => unknown, status: number, message?: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof HttpError, `expected HttpError, got ${String(error)}`);
    assert.equal(error.status, status);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}

/** A request stream that delivers the given chunks, the way a socket does */
function streamOf(chunks: (string | Buffer)[]): IncomingMessage {
  const stream = new Readable({ read() {} });
  for (const chunk of chunks) stream.push(chunk);
  stream.push(null);
  return stream as unknown as IncomingMessage;
}

describe("HttpError", () => {
  test("carries the status and the message", () => {
    const error = new HttpError(418, "teapot");
    assert.ok(error instanceof Error);
    assert.equal(error.status, 418);
    assert.equal(error.message, "teapot");
  });
});

describe("parsePlannerRequest", () => {
  test("a valid body returns the normalized input", () => {
    const result = parsePlannerRequest(
      JSON.stringify({
        idea: "  A bakery  ",
        budget: 1000,
        location: "Madrid", start_mode: "scratch" as const, premises: "have" as const,
        final: true,
        answers: [{ topic: " partners ", question: " Who else is in it? ", answer: " Madrid " }],
        analysis: { subsector: "Bakery" },
      }),
    );
    assert.deepEqual(result, {
      input: { idea: "A bakery", budget: 1000, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const},
      answers: [{ topic: "partners", question: "Who else is in it?", answer: "Madrid" }],
      final: true,
      claims: { subsector: "Bakery" },
    });
  });

  for (const idea of ["", "   ", "\n\t", 42, null, ["a bakery"]]) {
    test(`rejects an idea of ${JSON.stringify(idea)} with 400`, () => {
      assertHttpError(() => parse({ idea }), 400, "Idea is required");
    });
  }

  test("rejects a missing idea with 400", () => {
    assertHttpError(() => parsePlannerRequest(JSON.stringify({ budget: 0, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const})), 400, "Idea is required");
  });

  test("accepts an idea of MAX_IDEA characters", () => {
    assert.equal(parse({ idea: "a".repeat(MAX_IDEA) }).input.idea.length, MAX_IDEA);
  });

  test("rejects an idea of MAX_IDEA + 1 characters with 400", () => {
    assertHttpError(() => parse({ idea: "a".repeat(MAX_IDEA + 1) }), 400, "Idea is too long");
  });

  test("measures the idea length after trimming", () => {
    assert.equal(parse({ idea: `${"a".repeat(MAX_IDEA)}   ` }).input.idea.length, MAX_IDEA);
  });

  test("budget accepts 0 and MAX_BUDGET, and refuses a number out of range or a string with 400", () => {
    assert.equal(parse({ budget: 0 }).input.budget, 0);
    assert.equal(parse({ budget: MAX_BUDGET }).input.budget, MAX_BUDGET);
    assertHttpError(() => parse({ budget: -1 }), 400, "budget is not a valid answer");
    assertHttpError(() => parse({ budget: MAX_BUDGET + 1 }), 400);
    assertHttpError(() => parse({ budget: String(10_000) }), 400);
  });

  test("location is trimmed, kept, and refused when empty, too long or with control characters", () => {
    assert.equal(parse({ location: "  Madrid, Malasaña  " }).input.location, "Madrid, Malasaña");
    assert.equal(parse({ location: "online" }).input.location, "online");
    assert.equal(parse({ location: "a".repeat(MAX_LOCATION) }).input.location.length, MAX_LOCATION);
    assertHttpError(() => parse({ location: "   " }), 400, "location is not a valid answer");
    assertHttpError(() => parse({ location: "a".repeat(MAX_LOCATION + 1) }), 400);
    assertHttpError(() => parse({ location: "Madrid\u0000" }), 400);
  });

  for (const mode of START_MODES) {
    test(`start_mode accepts "${mode}"`, () => {
      assert.equal(parse({ start_mode: mode }).input.start_mode, mode);
    });
  }

  for (const premises of PREMISES) {
    test(`premises accepts "${premises}"`, () => {
      assert.equal(parse({ premises }).input.premises, premises);
    });
  }

  test("a choice outside its closed list is refused with 400", () => {
    assertHttpError(() => parse({ start_mode: "franchising" }), 400);
    assertHttpError(() => parse({ premises: "maybe" }), 400);
    assertHttpError(() => parse({ start_mode: undefined }), 400);
  });
  test("rejects bodies that are not JSON objects with 400", () => {
    for (const raw of ["nope", "", "{", "null", "42", '"text"']) {
      assertHttpError(() => parsePlannerRequest(raw), 400, "Invalid JSON");
    }
  });

  test("rejects an array body with 400", () => {
    assertHttpError(() => parsePlannerRequest("[]"), 400);
  });

  test("final must be a boolean: 'yes', 1 and 'true' are rejected with 400", () => {
    for (const final of ["yes", 1, "true"]) {
      assertHttpError(() => parse({ final }), 400, "final must be a boolean");
    }
  });

  test("final defaults to false and true is accepted", () => {
    assert.equal(parse({}).final, false);
    assert.equal(parse({ final: false }).final, false);
    assert.equal(parse({ final: true }).final, true);
  });

  test("an analysis that is not an object is ignored", () => {
    for (const analysis of ["garbage", 42, ["subsector"], null]) {
      assert.deepEqual(parse({ analysis }).claims, {}, JSON.stringify(analysis));
    }
  });
});

describe("parseAnswers", () => {
  const answerOf = (i: number) => ({ topic: "partners", question: `Question ${i}?`, answer: "Madrid" });

  test("undefined gives an empty list", () => {
    assert.deepEqual(parseAnswers(undefined), []);
  });

  test("a value that is not an array is rejected with 400", () => {
    for (const value of [null, "scope", {}, 7]) {
      assertHttpError(() => parseAnswers(value), 400, "answers must be a short list");
    }
  });

  test("MAX_ANSWERS answers are accepted", () => {
    const answers = Array.from({ length: MAX_ANSWERS }, (_, i) => answerOf(i));
    assert.equal(parseAnswers(answers).length, MAX_ANSWERS);
  });

  test("MAX_ANSWERS + 1 answers are rejected with 400", () => {
    const answers = Array.from({ length: MAX_ANSWERS + 1 }, (_, i) => answerOf(i));
    assertHttpError(() => parseAnswers(answers), 400, "answers must be a short list");
  });

  for (const item of [null, "scope", 5]) {
    test(`an answer that is ${JSON.stringify(item)} is rejected with 400`, () => {
      assertHttpError(() => parseAnswers([item]), 400, "Each answer needs a topic, a question and an answer");
    });
  }

  for (const field of ["topic", "question", "answer"] as const) {
    for (const value of ["", "   ", undefined, 7]) {
      test(`${field} of ${JSON.stringify(value)} is rejected with 400`, () => {
        assertHttpError(() => parseAnswers([{ ...answerOf(0), [field]: value }]), 400);
      });
    }

    test(`${field} of MAX_TEXT characters is accepted`, () => {
      const result = parseAnswers([{ ...answerOf(0), [field]: "a".repeat(MAX_TEXT) }]);
      assert.equal(result[0][field], "a".repeat(MAX_TEXT));
    });

    test(`${field} of MAX_TEXT + 1 characters is rejected with 400`, () => {
      assertHttpError(() => parseAnswers([{ ...answerOf(0), [field]: "a".repeat(MAX_TEXT + 1) }]), 400);
    });
  }

  test("a field of MAX_TEXT characters plus spaces around is accepted, because the length is measured after trimming", () => {
    for (const field of ["topic", "question", "answer"] as const) {
      const padded = `   ${"a".repeat(MAX_TEXT)}   `;
      const result = parseAnswers([{ ...answerOf(0), [field]: padded }]);
      assert.equal(result[0][field], "a".repeat(MAX_TEXT));
    }
  });

  test("values are trimmed", () => {
    assert.deepEqual(parseAnswers([{ topic: " partners ", question: " Who else is in it? ", answer: " Madrid " }]), [
      { topic: "partners", question: "Who else is in it?", answer: "Madrid" },
    ]);
  });
});

describe("readBody", () => {
  test("resolves with a body of MAX_BODY bytes", async () => {
    const body = await readBody(streamOf(["a".repeat(MAX_BODY)]));
    assert.equal(Buffer.byteLength(body), MAX_BODY);
  });

  test("rejects a body of MAX_BODY + 1 bytes with a 413 HttpError", async () => {
    await assert.rejects(readBody(streamOf(["a".repeat(MAX_BODY + 1)])), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      return true;
    });
  });

  test("counts bytes: euro signs over MAX_BODY bytes are rejected though they are under it in characters", async () => {
    // Each euro sign is 3 bytes, so this many of them is over MAX_BODY bytes but not in characters
    const count = Math.floor(MAX_BODY / 3) + 1;
    assert.ok(count <= MAX_BODY);
    await assert.rejects(readBody(streamOf(["€".repeat(count)])), { status: 413 });
  });

  test("euro signs that fit in MAX_BODY bytes are accepted", async () => {
    const count = Math.floor(MAX_BODY / 3);
    const body = await readBody(streamOf(["€".repeat(count)]));
    assert.equal(body, "€".repeat(count));
  });

  test("decodes a multibyte character split between two chunks", async () => {
    // "x€y": the euro sign is E2 82 AC, cut after its first two bytes
    const bytes = Buffer.from("x€y", "utf8");
    const body = await readBody(streamOf([bytes.subarray(0, 3), bytes.subarray(3)]));
    assert.equal(body, "x€y");
  });

  test("an empty body resolves to an empty string", async () => {
    assert.equal(await readBody(streamOf([])), "");
  });

  test("a stream error rejects the read", async () => {
    const stream = new Readable({ read() {} });
    const pending = readBody(stream as unknown as IncomingMessage);
    stream.destroy(new Error("connection reset"));
    await assert.rejects(pending, { message: "connection reset" });
  });
});

describe('parsePlannerRequest: "I don\'t know" in the fixed questions', () => {
  test("no list: every number is required and kept, and the input has no unknown key", () => {
    const { input } = parse({ budget: 25_000 });
    assert.equal(input.budget, 25_000);
    assert.equal("unknown" in input, false);
    assertHttpError(() => parse({ budget: undefined }), 400, "budget is not a valid answer");
  });

  test("a flagged input needs no number: the lowest of its range stands in", () => {
    const body = { idea: "A bakery", location: "ignored", start_mode: "franchise", premises: "have", unknown: ["location", "budget"] };
    const { input } = parsePlannerRequest(JSON.stringify(body));
    assert.deepEqual(input, { idea: "A bakery", budget: 0, location: "", start_mode: "franchise", premises: "have", unknown: ["location", "budget"] });
  });

  test("a number sent for a flagged input is ignored, even out of range", () => {
    const { input } = parse({ budget: 50_000, premises: "not a choice", unknown: ["budget", "premises"] });
    assert.equal(input.budget, 0);
    assert.equal(input.premises, PREMISES[0]);
  });

  test("an empty list is the same as none", () => {
    assert.equal("unknown" in parse({ unknown: [] }).input, false);
  });

  test("the inputs that are not flagged keep their checks", () => {
    assertHttpError(() => parse({ unknown: ["budget"], start_mode: "franchising" }), 400);
  });

  const invalid: [string, unknown][] = [
    ["a string", "budget"],
    ["an unknown key", ["budget", "money"]],
    ["a repeated key", ["budget", "budget"]],
    ["a removed key", ["team"]],
    ["a non-string item", [1]],
    ["an object", { budget: true }],
    ["null", null],
  ];
  for (const [name, value] of invalid) {
    test(`${name} is refused with 400`, () => {
      assertHttpError(() => parse({ unknown: value }), 400, "unknown must be a list of distinct keys among location, budget, start_mode, premises");
    });
  }
});
