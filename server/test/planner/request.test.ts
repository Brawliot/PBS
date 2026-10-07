import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  HttpError,
  MAX_ANSWERS,
  MAX_BODY,
  MAX_IDEA,
  MAX_TEXT,
  RANGES,
  parseAnswers,
  parsePlannerRequest,
  readBody,
} from "../../request.js";
import "./helpers.js";

const validBody = { idea: "A bakery that delivers", budget: 0, experience: 0, team: 0, hours: 0 };
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
        experience: 3,
        team: 1,
        hours: 2,
        final: true,
        answers: [{ topic: " scope ", question: " Where? ", answer: " Madrid " }],
        analysis: { subsector: "Bakery" },
      }),
    );
    assert.deepEqual(result, {
      input: { idea: "A bakery", budget: 1000, experience: 3, team: 1, hours: 2 },
      answers: [{ topic: "scope", question: "Where?", answer: "Madrid" }],
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
    assertHttpError(() => parsePlannerRequest(JSON.stringify({ budget: 0, experience: 0, team: 0, hours: 0 })), 400, "Idea is required");
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

  for (const [key, [min, max]] of Object.entries(RANGES)) {
    test(`${key} accepts ${min} and ${max}`, () => {
      assert.equal(parse({ [key]: min }).input[key as keyof typeof RANGES], min);
      assert.equal(parse({ [key]: max }).input[key as keyof typeof RANGES], max);
    });

    test(`${key} rejects ${min - 1}, ${max + 1} and a numeric string with 400`, () => {
      assertHttpError(() => parse({ [key]: min - 1 }), 400, `${key} must be a number between ${min} and ${max}`);
      assertHttpError(() => parse({ [key]: max + 1 }), 400);
      assertHttpError(() => parse({ [key]: String(min) }), 400);
    });
  }

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
  const answerOf = (i: number) => ({ topic: "scope", question: `Question ${i}?`, answer: "Madrid" });

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

  test("values are trimmed", () => {
    assert.deepEqual(parseAnswers([{ topic: " scope ", question: " Where? ", answer: " Madrid " }]), [
      { topic: "scope", question: "Where?", answer: "Madrid" },
    ]);
  });
});

describe("readBody", () => {
  test("resolves with a body of MAX_BODY characters", async () => {
    const body = await readBody(streamOf(["a".repeat(MAX_BODY)]));
    assert.equal(body.length, MAX_BODY);
  });

  test("rejects a body of MAX_BODY + 1 characters with a 413 HttpError", async () => {
    await assert.rejects(readBody(streamOf(["a".repeat(MAX_BODY + 1)])), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      return true;
    });
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
