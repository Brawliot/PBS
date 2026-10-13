import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { REPORT_TEMPLATES } from "../../planner/report-templates.js";
import { signUp } from "../auth/signed-in.js";
import { server } from "../../server.js";
import "./helpers.js";

// The catalog of starter templates: the text is fixed, the model only picks ids from it. The route serves it to
// a signed-in person, and needs no table.

describe("the catalog of starter templates", () => {
  test("it has eight templates, with unique, non-empty ids, titles, purposes and bodies", () => {
    assert.equal(REPORT_TEMPLATES.length, 8);
    const ids = REPORT_TEMPLATES.map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
    for (const template of REPORT_TEMPLATES) {
      for (const field of ["id", "title", "purpose", "body"] as const) {
        assert.ok(template[field].trim().length > 0, `${template.id}: ${field} is empty`);
      }
    }
  });

  test("the only placeholder is {{location}}: the rest are brackets the person fills in", () => {
    for (const { id, body } of REPORT_TEMPLATES) {
      const placeholders = body.match(/\{\{[^}]*\}\}/g) ?? [];
      assert.ok(placeholders.every((placeholder) => placeholder === "{{location}}"), `${id}: ${placeholders.join(" ")}`);
      assert.equal(body.split("{{").length - 1, placeholders.length, `${id}: a placeholder is not closed`);
    }
  });

  test("every body is copied as it was approved in plantillas-borrador.md", () => {
    const draft = readFileSync(new URL("../../../plantillas-borrador.md", import.meta.url), "utf8");
    for (const { id, body } of REPORT_TEMPLATES) {
      assert.ok(draft.includes(`\`\`\`\n${body}\n\`\`\``), `${id} differs from the draft`);
    }
  });
});

let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function get(path: string, cookie?: string): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers: cookie ? { Cookie: cookie } : {} }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("GET /api/report-templates", () => {
  test("without a session it answers 401, and nothing of the catalog", async () => {
    const response = await get("/api/report-templates");
    assert.equal(response.status, 401);
    assert.equal(response.body.includes("Supplier quote request"), false);
  });

  test("with a session it answers the eight templates, in the exact shape, and is never cached", async () => {
    const cookie = await signUp(port);
    const response = await get("/api/report-templates", cookie);

    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const { templates } = JSON.parse(response.body);
    assert.equal(templates.length, 8);
    for (const template of templates) {
      assert.deepEqual(Object.keys(template).sort(), ["body", "id", "purpose", "title"]);
    }
    assert.deepEqual(templates, REPORT_TEMPLATES.map(({ id, title, purpose, body }) => ({ id, title, purpose, body })));
  });
});
