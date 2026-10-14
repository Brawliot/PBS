/**
 * End-to-end checks of three things: the theme picker (kept in the browser, applied before the page shows),
 * the project list (its rows, the signed-out and empty answers, the way in from the start page), and the
 * report that comes back when the person goes back from the plan. The real server serves the pages; the
 * planner, the plan API and the report and project routes are answered by page.route.
 *
 * Run: npm run test:e2e (from server/). Set PLAYWRIGHT_MODULE and CHROMIUM_PATH as in build-my-plan.mjs.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { watch, assertNoProblems } from "./watch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const PORT = 3978;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
const snapshot = JSON.parse(readFileSync(join(serverDir, "test/planner/fixtures/planner-run.snapshot.json"), "utf8"));
// A stored report: the input and the answers it was made from, and the run's own parts (the server keeps all of them)
const report = {
  input: { idea: "Bakery delivery", budget: 10_000, experience: 1, team: 1, hours: 1 },
  answers: [],
  ...snapshot.noQuestions,
};

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

/** Signed in, with the planner answering a finished analysis; the report route answers `reportStatus` */
async function mockSignedIn(page, { reportStatus = 200 } = {}) {
  await page.route("**/api/auth/session", (route) => route.fulfill(json(200, { user: { name: "Ana" } })));
  let jobs = 0;
  await page.route("**/api/planner", (route) => route.fulfill(json(202, { jobId: JOB_ID.slice(0, -1) + (++jobs) })));
  await page.route("**/api/planner/*", (route) => {
    const number = Number(route.request().url().slice(-1));
    return route.fulfill(json(200, { status: "done", result: { ...report, reportId: REPORT_ID } }));
  });
  await page.route("**/api/plan", (route) => route.fulfill(json(201, { id: PLAN_ID })));
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  await page.route("**/api/reports/**", (route) =>
    reportStatus === 200
      ? route.fulfill(json(200, { id: REPORT_ID, report, planId: null }))
      : route.fulfill(json(404, { error: "Not found", code: "not_found" })),
  );
}

async function analyse(page) {
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", "Bakery delivery");
  for (const id of ["budget", "experience", "team", "hours"]) {
    await page.locator(`#${id}`).evaluate((el) => {
      el.value = el.max;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await page.click(".search__submit");
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
}

const picker = (page) => page.locator(".theme-picker button");

async function scenarioThemes(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  await mockSignedIn(page);
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".theme-picker button");
  assert.equal(await page.locator(".theme-picker button").count(), 4, "four choices: System, Light, Dark, Contrast");
  assert.equal(await page.getAttribute("html", "data-theme"), null, "System sets no attribute");
  await picker(page).nth(2).click();
  assert.equal(await page.getAttribute("html", "data-theme"), "dark");
  assert.equal(await page.getAttribute('meta[name="theme-color"]', "content"), "#0b0c0f", "the browser bar follows the theme");
  assert.equal(await page.evaluate(() => localStorage.getItem("mando.theme")), "dark");
  await page.reload();
  assert.equal(await page.getAttribute("html", "data-theme"), "dark", "the choice survives a reload");
  assert.equal(await page.getAttribute(".theme-picker button[aria-pressed='true']", "data-theme-choice"), "dark");
  await picker(page).nth(3).click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(0, 0, 0)", "contrast: black page");
  await picker(page).nth(0).click();
  assert.equal(await page.getAttribute("html", "data-theme"), null, "System again removes the attribute");
  await context.close();
  return "themes: choice kept, bar colour follows, contrast and system work";
}

async function scenarioSystemDark(browser) {
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  await mockSignedIn(page);
  await page.goto(`${BASE}/`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(11, 12, 15)", "a dark device gets the dark page");
  await picker(page).nth(1).click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(255, 255, 255)", "light beats a dark device");
  await context.close();
  return "system dark: dark page, and an explicit light choice wins";
}

async function scenarioProjects(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  await mockSignedIn(page);
  await page.route("**/api/projects", (route) =>
    route.fulfill(json(200, {
      projects: [
        { id: PLAN_ID, title: "Bakery delivery", updatedAt: "2026-10-13T10:00:00.000Z", status: "in_progress", done: 12, total: 40, percent: 30 },
        { id: REPORT_ID, title: "Ceramics store", updatedAt: "2026-10-02T10:00:00.000Z", status: "done", done: 31, total: 31, percent: 100 },
      ],
    })),
  );
  await page.goto(`${BASE}/`);
  await page.click(".nav__projects");
  await page.waitForURL(`${BASE}/projects`);
  assert.equal(await page.locator(".project").count(), 2, "one row per plan");
  assert.equal(await page.locator(".project__title a").first().getAttribute("href"), `/plan?id=${PLAN_ID}`);
  assert.equal(await page.locator(".project__bar").first().getAttribute("aria-valuenow"), "30");
  assert.match(await page.textContent(".project__meta"), /12 of 40 steps done/);
  await context.close();

  const signedOut = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const other = await signedOut.newPage();
  await watch(other, scenarioLabel());
  await other.route("**/api/projects", (route) => route.fulfill(json(401, { error: "Unauthenticated", code: "unauthenticated" })));
  await other.goto(`${BASE}/projects`);
  await other.waitForSelector("#projects-signed-out:not([hidden])");
  assert.equal(await other.locator(".project").count(), 0);
  await signedOut.close();
  return "projects: rows link to plans, progress is shown, signed-out answer is clear";
}

async function scenarioBackToReport(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  await mockSignedIn(page);
  await analyse(page);
  await page.click("#result-plan");
  await page.waitForURL(`${BASE}/plan?id=${PLAN_ID}`, { timeout: 15_000 });
  await page.goBack();
  await page.waitForSelector("#result:not([hidden])", { timeout: 15_000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem("mando.report")), null, "the report content is not kept in the browser");
  assert.equal(await page.evaluate(() => history.state?.reportId), REPORT_ID, "only the id is in the history entry");
  assert.equal(await page.isEnabled("#result-plan"), true, "the plan can still be built from the restored report");
  await context.close();
  return "back to report: the report comes back from the server by its id";
}

async function scenarioBackToMissingReport(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  await mockSignedIn(page);
  await analyse(page);
  await page.click("#result-plan");
  await page.waitForURL(`${BASE}/plan?id=${PLAN_ID}`, { timeout: 15_000 });
  // The report is gone by the time the person comes back
  await page.unroute("**/api/reports/**");
  await page.route("**/api/reports/**", (route) => route.fulfill(json(404, { error: "Not found", code: "not_found" })));
  await page.goBack();
  await page.waitForSelector(".toast", { timeout: 10_000 });
  assert.match(await page.textContent(".toast"), /could not find that report/);
  assert.equal(await page.evaluate(() => history.state), null, "the dead id is dropped");
  await context.close();
  return "back to a missing report: the start page says so and forgets the id";
}

let currentScenario = "";
const scenarioLabel = () => currentScenario;

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let failed = 0;
try {
  for (const scenario of [scenarioThemes, scenarioSystemDark, scenarioProjects, scenarioBackToReport, scenarioBackToMissingReport]) {
    currentScenario = scenario.name;
    try {
      console.log("ok -", await scenario(browser));
    } catch (error) {
      failed += 1;
      console.error("not ok -", scenario.name, error.message);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
try {
  assertNoProblems();
} catch (error) {
  failed += 1;
  console.error("not ok - security watch:", error.message);
}
if (failed > 0) process.exitCode = 1;
