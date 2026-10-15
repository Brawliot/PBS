/**
 * The home page's first paint: the header block that shows, the avatar letter and the data-user attribute, and
 * that a name is escaped wherever it goes. The page itself is index.html, read here as the server reads it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escapeHtml, initialOf, renderHome } from "../../auth/home-page.js";

const html = readFileSync(fileURLToPath(new URL("../../../index.html", import.meta.url)), "utf8");

/** The name the page carries in data-user: the attribute decoded, then the JSON parsed */
function dataUserName(page: string): string | undefined {
  const raw = page.match(/<body data-user="([^"]*)">/)?.[1];
  if (raw === undefined) return undefined;
  const decoded = raw.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return JSON.parse(decoded).name;
}

describe("renderHome", () => {
  test("a guest sees Log In / Register, and the profile block stays hidden", () => {
    const page = renderHome(html, undefined);
    assert.ok(page.includes('<div class="nav__guest" id="nav-guest">'));
    assert.ok(page.includes('<div class="nav__user" id="nav-user" hidden>'));
    assert.ok(!page.includes("data-user="));
  });

  test("a signed-in person sees the avatar and the projects button, with the initial and the name", () => {
    const page = renderHome(html, { name: "ana garcía" });
    assert.ok(page.includes('<div class="nav__user" id="nav-user">'));
    assert.ok(page.includes('<div class="nav__guest" id="nav-guest" hidden>'));
    assert.ok(page.includes('aria-label="Your profile">A</button>'));
    assert.equal(dataUserName(page), "ana garcía");
  });

  test("a name with markup and quotes is escaped in the attribute and in the avatar", () => {
    const name = `"><img src=x onerror=alert(1)> & 'x'`;
    const page = renderHome(html, { name });
    assert.ok(!page.includes("<img"), "no raw tag from the name reaches the page");
    assert.equal(dataUserName(page), name);
    assert.ok(page.includes('aria-label="Your profile">&quot;</button>'));
  });

  test("a name with a dollar sign or a replacement pattern is kept as written", () => {
    const page = renderHome(html, { name: "$& $1 $$" });
    assert.ok(page.includes('aria-label="Your profile">$</button>'));
    assert.equal(dataUserName(page), "$& $1 $$");
  });

  test("a page whose markup changed is refused, not half rewritten", () => {
    assert.throws(() => renderHome("<body>", { name: "Ana" }), /must appear exactly once/);
  });
});

describe("escapeHtml and initialOf", () => {
  test("escapes the five characters that matter", () => {
    assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  });

  test("the initial is the first character, upper case, and a whole character when it is not in the basic plane", () => {
    assert.equal(initialOf("  ana"), "A");
    assert.equal(initialOf("😀 ana"), "😀");
    assert.equal(initialOf(""), "?");
  });
});
