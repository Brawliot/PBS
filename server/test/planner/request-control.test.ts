/** Control characters are refused in the idea and in the answers: each boundary of the range, both sides */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, parseAnswers, parsePlannerRequest } from "../../request.js";
import "./helpers.js";

const validBody = { idea: "A bakery that delivers", budget: 0, experience: 0, team: 0, hours: 0 };
const answer = (text: string) => [{ topic: "validation", question: "Tested?", answer: text }];

/** Refused: NUL, the first and last of the C0 range before tab, the range after newline, DEL */
const REFUSED = [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0d, 0x0e, 0x1f, 0x7f];
/** Accepted: tab, newline, the space, the last printable ASCII, and the first characters after DEL */
const ACCEPTED = [0x09, 0x0a, 0x20, 0x7e, 0x80, 0xa0];
const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

describe("the idea refuses control characters", () => {
  for (const code of REFUSED) {
    test(`${hex(code)} is refused with 400`, () => {
      const idea = `A bakery${String.fromCharCode(code)}that delivers`;
      assert.throws(() => parsePlannerRequest(JSON.stringify({ ...validBody, idea })), (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 400);
        assert.equal(error.message, "The idea cannot contain control characters");
        return true;
      });
    });
  }

  for (const code of ACCEPTED) {
    test(`${hex(code)} is accepted`, () => {
      const idea = `A bakery${String.fromCharCode(code)}that delivers`;
      assert.equal(parsePlannerRequest(JSON.stringify({ ...validBody, idea })).input.idea, idea);
    });
  }

  test("a control character at the edge is refused, not trimmed away", () => {
    assert.throws(() => parsePlannerRequest(JSON.stringify({ ...validBody, idea: "\u000bA bakery" })), HttpError);
  });
});

describe("the answers refuse control characters in each of their fields", () => {
  for (const field of ["topic", "question", "answer"] as const) {
    for (const code of REFUSED) {
      test(`${field} with ${hex(code)} is refused with 400`, () => {
        const item = { topic: "validation", question: "Tested?", answer: "Yes" };
        item[field] = `Yes${String.fromCharCode(code)}`;
        assert.throws(() => parseAnswers([item]), (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.status, 400);
          assert.equal(error.message, "Answers cannot contain control characters");
          return true;
        });
      });
    }
  }

  for (const code of ACCEPTED) {
    test(`an answer with ${hex(code)} is accepted`, () => {
      const text = `Yes${String.fromCharCode(code)}ten`;
      assert.equal(parseAnswers(answer(text))[0].answer, text.trim());
    });
  }
});
