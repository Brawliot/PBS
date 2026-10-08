/** .env.example is copied to .env by people: its DATABASE_URL carries placeholders, never working credentials */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const example = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../.env.example"), "utf8");

describe(".env.example", () => {
  test("DATABASE_URL has the placeholders USER and PASSWORD, not real credentials", () => {
    const line = example.split("\n").find((entry) => entry.startsWith("DATABASE_URL="));
    assert.equal(line, "DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/pbs");
  });
});
