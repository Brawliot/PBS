/**
 * Every element a page script looks up by a literal id is in its page. A missing one makes getElementById return
 * null and the next line throw, which stops the flow where it is: removing the diagnosis header from index.html
 * left the report hidden at the end of the questions.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const PAGES = [
  ["script.js", "index.html"],
  ["plan.js", "plan.html"],
  ["projects.js", "projects.html"],
] as const;

describe("page ids", () => {
  for (const [script, page] of PAGES) {
    test(`every getElementById in ${script} finds its element in ${page}`, () => {
      const looked = new Set([...read(script).matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]));
      const present = new Set([...read(page).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      assert.deepEqual([...looked].filter((id) => !present.has(id)), [], `ids ${script} uses that ${page} does not have`);
    });
  }
});
