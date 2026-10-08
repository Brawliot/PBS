/**
 * End-to-end checks of "Build my plan" in Chromium. The real server (server.ts) serves the pages; the planner
 * and plan API are answered by page.route, so no key, database or outside service is needed.
 *
 * Run: npm run test:e2e (from server/). Needs Playwright: set PLAYWRIGHT_MODULE to its path if it is not
 * installed next to this project, and CHROMIUM_PATH to a Chromium binary if the default one is not there.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const PORT = 3977;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
// The planner's result without questions, as the characterization snapshot records it
const snapshot = JSON.parse(readFileSync(join(serverDir, "test/planner/fixtures/planner-run.snapshot.json"), "utf8"));

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Starts server.ts without a database and waits until it listens */
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

/**
 * Answers the planner and the plan API. `options.result` is the planner's job result; `options.plan` answers
 * POST /api/plan. Returns the list of the requests made to the plan API.
 */
async function mockApi(page, { result, plan }) {
  const planRequests = [];
  await page.route("**/api/planner", (route) => route.fulfill(json(202, { jobId: JOB_ID })));
  await page.route(`**/api/planner/${JOB_ID}`, (route) => route.fulfill(json(200, { status: "done", result })));
  await page.route("**/api/plan", (route) => {
    planRequests.push(JSON.parse(route.request().postData() ?? "null"));
    return route.fulfill(plan);
  });
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  return planRequests;
}

/** Fills the form like a user and submits it; waits until the result is on screen */
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

const withReport = { ...snapshot.noQuestions, reportId: REPORT_ID };

async function scenarioFullFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const planRequests = await mockApi(page, { result: withReport, plan: json(201, { id: PLAN_ID }) });
  await analyse(page);
  await page.click("#result-plan");
  await page.waitForURL(`${BASE}/plan?id=${PLAN_ID}`, { timeout: 15_000 });
  assert.deepEqual(planRequests, [{ reportId: REPORT_ID }], "one request, with the report's id only");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("mando.report")), null, "the report is not kept in the browser");
  await context.close();
  return "full flow: the plan opens with its id";
}

async function scenarioError(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const planRequests = await mockApi(page, { result: withReport, plan: json(500, { error: "Could not build the plan", code: "skeleton_failed" }) });
  await analyse(page);
  await page.click("#result-plan");
  await page.waitForSelector("#toast.is-open", { timeout: 15_000 });
  assert.equal(await page.textContent("#toast-text"), "Could not open the plan. Please try again.");
  assert.equal(planRequests.length, 1);
  await page.waitForFunction(() => !document.body.classList.contains("is-loading"), null, { timeout: 5_000 });
  const restored = await page.evaluate(() => {
    const result = document.getElementById("result");
    return { inert: result.inert, leaving: result.classList.contains("is-leaving"), visible: !result.hidden };
  });
  assert.deepEqual(restored, { inert: false, leaving: false, visible: true }, "the result is back and usable");
  assert.equal(new URL(page.url()).pathname, "/", "the page did not move");
  await context.close();
  return "error: the loader goes, the result comes back, a generic message shows";
}

async function scenarioNoReport(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const planRequests = await mockApi(page, { result: snapshot.noQuestions, plan: json(201, { id: PLAN_ID }) });
  await analyse(page);
  await page.click("#result-plan");
  await page.waitForSelector("#toast.is-open", { timeout: 5_000 });
  assert.equal(await page.textContent("#toast-text"), "Plans are not available right now.");
  assert.equal(await page.evaluate(() => document.body.classList.contains("is-loading")), false, "no loader without a report");
  assert.equal(planRequests.length, 0, "no request is sent without a report");
  assert.equal(new URL(page.url()).pathname, "/");
  await context.close();
  return "no report id: the fixed notice, no animation, no request";
}

const server = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
let failed = 0;
try {
  for (const scenario of [scenarioFullFlow, scenarioError, scenarioNoReport]) {
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
if (failed > 0) process.exitCode = 1;
