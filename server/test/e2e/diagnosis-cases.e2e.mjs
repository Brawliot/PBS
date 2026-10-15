/**
 * The four cases of the report in Chromium, with the planner's answers simulated by page.route. The answers are the
 * server's own (test/e2e/fixtures/diagnosis-cases.json, written by diagnosis-cases.gen.ts): the checks, the split and
 * the words come from the real rules, and only the model is simulated. Checks the states and texts of each case,
 * the questions the model asked (none), the confirmation card, and that Mando builds never names the client's product.
 *
 * Screenshots (desktop and phone, light and dark) go to SCREENSHOTS, a folder outside the repository, when it is set.
 * Content security policy violations and console errors fail the run.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { watch, assertNoProblems } from "./watch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const cases = JSON.parse(readFileSync(join(here, "fixtures/diagnosis-cases.json"), "utf8"));

const PORT = 3986;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "66666666-6666-4666-8666-666666666666";
const SCREENSHOTS = process.env.SCREENSHOTS;
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function startServer() {
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 20_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("http://localhost")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
}

const server = await startServer();
// A run that fails in the middle must not leave its server listening on the port
process.on("exit", () => server.kill());
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let failed = 0;

/** Answers the planner and the report of one case. The first round is the server's first answer, the final one its final. */
async function mockApi(page, caseData) {
  const posts = [];
  await page.route("**/api/auth/session", (route) => route.fulfill(json(200, { user: { name: "Ana" } })));
  await page.route("**/api/planner", (route) => {
    posts.push(JSON.parse(route.request().postData() ?? "null"));
    return route.fulfill(json(202, { jobId: JOB_ID.slice(0, -1) + posts.length }));
  });
  await page.route("**/api/planner/*", (route) => {
    const number = Number(route.request().url().slice(-1));
    const result = number === 1 ? caseData.firstRound : caseData.final;
    return route.fulfill(json(200, { status: "done", result }));
  });
  await page.route("**/api/reports/**", (route) => route.fulfill(json(200, { id: caseData.final.reportId, report: caseData.report, planId: null })));
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  // Registered last, so it answers first: the description is read as the fixture's detection
  await page.route("**/api/planner/detect", (route) => route.fulfill(json(200, { detected: caseData.detect, jevToken: null })));
  return posts;
}

/** Answers the fixed questions that remain (the detection fills the rest), by their first option or a typed value */
async function answerRemaining(page) {
  for (let guard = 0; guard < 6; guard += 1) {
    await page.waitForFunction(
      () => document.getElementById("question").classList.contains("is-open")
        || !document.getElementById("review").hidden
        || !document.getElementById("result").hidden,
      null,
      { timeout: 20_000 },
    );
    if (!(await page.isVisible("#question"))) return;
    if (await page.$(".question__option")) {
      await page.click(".question__option >> nth=0");
      await page.click(".question__submit");
    } else {
      await page.fill(".question__input", "40000");
      await page.press(".question__input", "Enter");
    }
    await page.waitForTimeout(150);
  }
}

/** The confirmation card (or the result, when there is nothing to confirm), then the result */
async function reachResult(page, caseData) {
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", caseData.input.idea);
  await page.click(".search__submit");
  await answerRemaining(page);
  await page.waitForSelector("#review:not([hidden]), #result:not([hidden])", { timeout: 20_000 });
  if (await page.isVisible("#review")) await page.click("#review-generate");
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById("diagnosis-title").textContent === "Five checks on your idea");
}

/** What the page shows of the diagnosis */
const readDiagnosis = (page) =>
  page.evaluate(() => {
    const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
    return {
      eyebrow: text(document.getElementById("diagnosis-eyebrow")),
      idea: text(document.getElementById("diagnosis-idea")),
      checks: [...document.querySelectorAll("#diagnosis-checks > li")].map((item) => ({
        name: text(item.querySelector(".name")),
        state: text(item.querySelector(".state")),
        symbol: item.querySelector(".mark").textContent,
        why: item.querySelector(".why").firstChild.textContent.trim(),
        estimated: !!item.querySelector(".why .tier"),
      })),
      risks: [...document.querySelectorAll("#diagnosis-risks > li")].map(text),
      plan: [...document.querySelectorAll("#diagnosis-split > li")].map(text),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

async function shoot(page, caseName, device, scheme) {
  if (!SCREENSHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SCREENSHOTS, `${caseName}-${device}-${scheme}.png`), fullPage: true });
}

/** One case on the four combinations of device and colour scheme: the same checks each time */
async function scenario(caseName, check) {
  const caseData = cases[caseName];
  for (const [device, width] of [["desktop", 1280], ["phone", 390]]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width, height: 1100 }, colorScheme: scheme });
      const page = await context.newPage();
      await watch(page, `${caseName} ${device} ${scheme}`);
      const posts = await mockApi(page, caseData);
      await reachResult(page, caseData);
      const view = await readDiagnosis(page);
      await check({ view, posts, page, caseData });
      assert.ok(view.overflow <= 0, `${caseName} ${device}: no horizontal scroll (${view.overflow}px)`);
      await shoot(page, caseName, device, scheme);
      assertNoProblems();
      await context.close();
    }
  }
  return caseName;
}

const stateOf = (view, name) => view.checks.find((c) => c.name === name);

const scenarios = [
  () => scenario("tapas", async ({ view, posts, caseData }) => {
    assert.equal(view.eyebrow, "Business analysis · Malasaña, Madrid");
    assert.deepEqual(view.checks.map(({ name, state }) => [name, state]), [
      ["Concept", "Strong"], ["Location", "Strong"], ["Money", "Watch"], ["Experience", "Watch"], ["Competition", "Risk"],
    ], "money watch, experience by Jev's answer, competition risk");
    assert.match(stateOf(view, "Money").why, /€40k/, "the money reason is the model's text, not the default");
    assert.equal(stateOf(view, "Money").estimated, true);
    assert.equal(posts.length, 2, "no question from the model: the first round and the final request only");
    assert.deepEqual(view.plan, ["Mando builds: Website", "You handle: Menu and recipes"]);
    assert.equal(caseData.firstRound.phase2.questions.length, 0);
  }),
  () => scenario("physio", async ({ view, caseData }) => {
    assert.equal(stateOf(view, "Experience").state, "Risk", "a regulated profession without credentials is risk");
    assert.match(stateOf(view, "Experience").why, /No degree or registration/);
    assert.equal(stateOf(view, "Location").state, "Strong");
    assert.equal(view.eyebrow, "Business analysis · Valencia");
    assert.equal(caseData.report.diagnosis.checks.find((c) => c.key === "experience").decidedBy, "rule");
  }),
  () => scenario("salon", async ({ view, page, caseData }) => {
    assert.equal(view.eyebrow, "Business analysis · Seville", "the location of the idea is in the eyebrow");
    assert.equal(stateOf(view, "Location").state, "Strong");
    assert.equal(caseData.firstRound.phase2.questions.length, 0, "the model asked no question");
    assert.equal(view.checks.length, 5);
    assert.equal(await page.isVisible("#diagnosis"), true);
  }),
  () => scenario("software", async ({ view, caseData }) => {
    assert.deepEqual(view.checks.map(({ name }) => name), ["Concept", "Reach", "Money", "Experience", "Competition"], "reach in place of location");
    assert.equal(view.checks.some(({ name }) => name === "Location"), false);
    assert.equal(view.plan.find((line) => line.startsWith("Mando builds:")), "Mando builds: Website");
    assert.equal(view.plan.some((line) => line.startsWith("Mando builds") && line.includes("Bar booking software")), false, "Mando builds never names the client's product");
    assert.ok(view.plan.includes("Hire out: Bar booking software"), "a product that costs money is not Mando's");
    assert.equal(caseData.report.diagnosis.split.mando.includes("Bar booking software"), false);
  }),
];

for (const run of scenarios) {
  try {
    console.log(`ok - ${await run()}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${error.message}`);
  }
}

await browser.close();
server.kill();
if (failed) {
  console.error(`${failed} diagnosis-case check(s) failed`);
  process.exit(1);
}
