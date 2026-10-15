/**
 * The home page over HTTP: the header is already in its state in the first answer (no script needed), the
 * response is not cached and varies by Cookie, and a session that cannot be read still loads the page as a guest.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { server, useTestStores } from "../../server.js";
import { memory } from "./signed-in.js";
import { hashToken, newToken } from "../../auth/session-cookie.js";
import type { SessionRepository } from "../../auth/session-repository.js";

let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** The name in data-user: the attribute decoded, then the JSON parsed */
function dataUserName(html: string): string | undefined {
  const raw = html.match(/<body data-user="([^"]*)">/)?.[1];
  if (raw === undefined) return undefined;
  const decoded = raw.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return JSON.parse(decoded).name;
}

interface Page {
  status: number;
  headers: IncomingHttpHeaders;
  html: string;
}

function home(cookie?: string): Promise<Page> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};
    const req = request({ host: "127.0.0.1", port, path: "/", method: "GET", headers }, (res) => {
      let html = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (html += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, html }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** A user with a session cookie, made straight in the in-memory stores (the name is not checked here on purpose) */
async function sessionFor(name: string): Promise<string> {
  const email = `home-${Math.random().toString(36).slice(2)}@example.test`;
  const user = await memory.users.create(email, name, null);
  const token = newToken();
  await memory.sessions.create({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) }, new Date());
  return `pbs_session=${token}`;
}

describe("the home page's first answer", () => {
  test("a signed-in person gets the avatar, the projects button and their name in the page, not cached, varying by Cookie", async () => {
    const page = await home(await sessionFor("Ana López"));
    assert.equal(page.status, 200);
    assert.ok(page.html.includes('<div class="nav__user" id="nav-user">'));
    assert.ok(page.html.includes('<div class="nav__guest" id="nav-guest" hidden>'));
    assert.ok(page.html.includes('aria-label="Your profile">A</button>'));
    assert.equal(dataUserName(page.html), "Ana López");
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers.vary, "Cookie");
    assert.equal(page.headers["content-security-policy"]?.includes("script-src 'self'"), true);
    assert.equal(page.html.includes("<script>"), false, "no inline script");
  });

  test("a name with markup reaches the page escaped, and as one attribute value", async () => {
    const page = await home(await sessionFor(`<script>alert("x")</script>`));
    assert.equal(page.html.includes("<script>alert"), false);
    assert.equal(dataUserName(page.html), `<script>alert("x")</script>`);
  });

  test("without a session, Log In / Register is shown and no user is written", async () => {
    const page = await home();
    assert.equal(page.status, 200);
    assert.ok(page.html.includes('<div class="nav__guest" id="nav-guest">'));
    assert.ok(page.html.includes('<div class="nav__user" id="nav-user" hidden>'));
    assert.equal(page.html.includes("data-user="), false);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers.vary, "Cookie");
  });

  test("an expired or unknown session is a guest page, not an error", async () => {
    const user = await memory.users.create(`home-expired-${Math.random()}@example.test`, "Expired", null);
    const token = newToken();
    await memory.sessions.create({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() - 1000) }, new Date());
    const page = await home(`pbs_session=${token}`);
    assert.equal(page.status, 200);
    assert.ok(page.html.includes('<div class="nav__guest" id="nav-guest">'));
  });

  test("when the session cannot be read, the page still loads as a guest", async () => {
    const broken: SessionRepository = {
      create: async () => {},
      findUserId: async () => {
        throw new Error("connection refused");
      },
      remove: async () => {},
      removeExpired: async () => {},
    };
    useTestStores({ auth: { users: memory.users, sessions: broken }, plan: memory.plans, reports: memory.reports });
    try {
      const page = await home(`pbs_session=${newToken()}`);
      assert.equal(page.status, 200);
      assert.ok(page.html.includes('<div class="nav__guest" id="nav-guest">'));
      assert.equal(page.html.includes("data-user="), false);
    } finally {
      useTestStores({ auth: { users: memory.users, sessions: memory.sessions }, plan: memory.plans, reports: memory.reports });
    }
  });
});
