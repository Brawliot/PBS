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
import { watch, assertNoProblems } from "./watch.mjs";

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
async function mockApi(page, { result, results = [result], plan }) {
  const planRequests = [];
  // The bodies of the POSTs to /api/planner, in order: planRequests.posts
  const posts = [];
  // Not enumerable, so comparing planRequests with an array of requests is not affected
  Object.defineProperty(planRequests, "posts", { value: posts });
  // Signed in: the send is only made with a session (GET /api/auth/session says who it is)
  await page.route("**/api/auth/session", (route) => route.fulfill(json(200, { user: { name: "Ana" } })));
  // Each POST starts the next job; its id ends with its number, and the job answers results[number - 1]
  await page.route("**/api/planner", (route) => {
    posts.push(JSON.parse(route.request().postData() ?? "null"));
    return route.fulfill(json(202, { jobId: JOB_ID.slice(0, -1) + posts.length }));
  });
  await page.route("**/api/planner/*", (route) => {
    const number = Number(route.request().url().slice(-1));
    return route.fulfill(json(200, { status: "done", result: results[number - 1] }));
  });
  await page.route("**/api/plan", (route) => {
    planRequests.push(JSON.parse(route.request().postData() ?? "null"));
    return route.fulfill(plan);
  });
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  return planRequests;
}

/** Fills the form like a user and submits it */
async function fillAndSend(page) {
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", "Bakery delivery");
  for (const id of ["budget", "experience", "team", "hours"]) {
    await page.locator(`#${id}`).evaluate((el) => {
      el.value = el.max;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await page.click(".search__submit");
}

/** Fills the form, submits it and waits until the result is on screen */
async function analyse(page) {
  await fillAndSend(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
}

const withReport = { ...snapshot.noQuestions, reportId: REPORT_ID };

async function scenarioFullFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
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
  await watch(page, scenarioLabel());
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
  await watch(page, scenarioLabel());
  const planRequests = await mockApi(page, { result: snapshot.noQuestions, plan: json(201, { id: PLAN_ID }) });
  await analyse(page);
  assert.equal(await page.isDisabled("#result-plan"), true, "without a saved report the button is off");
  assert.equal(await page.isVisible("#result-plan-note"), true, "and a note says why");
  assert.match(await page.textContent("#result-plan-note"), /could not be saved/);
  assert.equal(await page.isVisible("#result-hint"), true, "with 0 topics defined, a hint says what to add");
  assert.equal(await page.evaluate(() => document.body.classList.contains("is-loading")), false, "no loader without a report");
  assert.equal(planRequests.length, 0, "no request is sent without a report");
  assert.equal(new URL(page.url()).pathname, "/");
  await context.close();
  return "no report id: the button is off with its note, no animation, no request";
}

const questionsResult = {
  ...snapshot.withQuestions,
  phase2: {
    ...snapshot.withQuestions.phase2,
    questions: [
      { topic: "validation", question: "Have you tested it with customers?", options: ["Yes", "No"] },
      { topic: "funding", question: "How will you fund the first year?", options: [] },
      { topic: "team", question: "Who will do the work?", options: [] },
    ],
  },
  questionTotal: 3,
};

const progress = (page, text) =>
  page.waitForFunction((expected) => document.getElementById("question-progress").textContent === expected, text, { timeout: 10_000 });

async function scenarioQuestions(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  const { posts } = await mockApi(page, { results: [questionsResult, withReport], plan: json(201, { id: PLAN_ID }) });
  await fillAndSend(page);
  await page.waitForSelector("#question.is-open", { timeout: 20_000 });
  assert.equal(await page.textContent("#question-progress"), "Question 1 of 3");

  // An empty answer says what to do and sends nothing
  await page.press(".question__input", "Enter");
  assert.equal(await page.textContent("#question-note"), "Type an answer to continue.");
  assert.equal(await page.isVisible("#question-note"), true);
  assert.equal(posts.length, 1, "nothing is sent");

  // The counter shows near the limit; at the limit a note says so
  await page.fill(".question__input", "x".repeat(899));
  assert.equal(await page.isVisible("#question-count"), false);
  await page.fill(".question__input", "x".repeat(950));
  assert.equal(await page.textContent("#question-count"), "950 / 1000");
  await page.fill(".question__input", "x".repeat(1000));
  assert.match(await page.textContent("#question-note"), /1000-character limit/);

  // A click on an option marks it and fills the field, but does not send; typing removes the mark
  await page.fill(".question__input", "");
  await page.click(".question__option >> text=Yes");
  assert.equal(await page.inputValue(".question__input"), "Yes");
  assert.equal(await page.getAttribute(".question__option >> text=Yes", "aria-pressed"), "true");
  assert.equal(posts.length, 1, "an option does not send by itself");
  await page.press(".question__input", "End");
  await page.keyboard.type("!");
  assert.equal(await page.getAttribute(".question__option >> text=Yes", "aria-pressed"), "false");
  await page.fill(".question__input", "Yes");

  // Enter sends it, the next question comes, and Back returns to the first one with its answer
  assert.equal(await page.isVisible("#question-back"), false, "no Back on the first question");
  await page.press(".question__input", "Enter");
  await progress(page, "Question 2 of 3");
  assert.equal(await page.isVisible("#question-back"), true);
  await page.click("#question-back");
  await progress(page, "Question 1 of 3");
  assert.equal(await page.inputValue(".question__input"), "Yes", "the answer is back in the field");

  // Escape cancels: the loader goes, the idea is still there and has the focus, nothing more is sent
  await page.press(".question__input", "Escape");
  await page.waitForFunction(() => !document.body.classList.contains("is-loading"), null, { timeout: 5_000 });
  assert.equal(await page.evaluate(() => document.getElementById("question").classList.contains("is-open")), false);
  assert.equal(await page.inputValue(".search__input"), "Bakery delivery");
  await page.waitForFunction(() => document.activeElement?.classList.contains("search__input"), null, { timeout: 5_000 });
  assert.equal(posts.length, 1, "cancelling sends nothing");
  await context.close();
  return "questions: empty answer, counter and limit, option marks, Back, Escape cancels";
}

async function scenarioQuestionsFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  const { posts } = await mockApi(page, { results: [questionsResult, withReport], plan: json(201, { id: PLAN_ID }) });
  await fillAndSend(page);
  await page.waitForSelector("#question.is-open", { timeout: 20_000 });
  await page.click(".question__option >> text=No");
  await page.press(".question__input", "Enter");
  await progress(page, "Question 2 of 3");
  await page.fill(".question__input", "Savings");
  await page.press(".question__input", "Enter");
  await progress(page, "Question 3 of 3");
  await page.fill(".question__input", "Me and a friend");
  await page.press(".question__input", "Enter");
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.equal(posts.length, 2, "one first request and one final request");
  assert.equal(posts[1].final, true);
  assert.deepEqual(posts[1].answers.map((entry) => entry.answer), ["No", "Savings", "Me and a friend"]);
  assert.equal(await page.isDisabled("#result-plan"), false, "with a saved report the button is on");
  await context.close();
  return "questions flow: three answers, the final request carries them, the report opens";
}

const reportResult = {
  ...snapshot.final,
  reportId: REPORT_ID,
  profile: { ...snapshot.final.profile, known: 5 },
  validation: {
    ...snapshot.final.validation,
    warnings: ["budget_fit", "timeline_realistic", "team_fit", "experience_fit", "model_fit", "regulation_fit", "consistency"],
    departments: snapshot.final.validation.departments.map((area, index) => (index === 0 ? { ...area, tier: "core" } : area)),
    groups: snapshot.final.validation.groups.map((area, index) => (index === 0 ? { ...area, tier: "core" } : area)),
  },
};

async function scenarioReport(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await watch(page, scenarioLabel());
  await mockApi(page, { result: reportResult, plan: json(201, { id: PLAN_ID }) });
  await analyse(page);

  // Lists say what they leave out: 3 of 7 warnings are shown, and the rest is counted
  const warnings = await page.$$eval("#result-warnings li", (items) => items.map((item) => ({ text: item.textContent, more: item.classList.contains("is-more") })));
  assert.equal(warnings.length, 4);
  assert.deepEqual(warnings[3], { text: "and 4 more to check in the full detail", more: true });

  // Key areas: one row each, with its level in words
  const areas = await page.$$eval("#result-departments-top li", (items) => items.filter((item) => !item.classList.contains("is-more")).map((item) => item.querySelector(".tier")?.textContent));
  assert.ok(areas.length >= 1 && areas.every((label) => ["Essential", "Recommended", "Optional"].includes(label)), `levels: ${areas}`);
  assert.ok(areas.includes("Essential"));
  assert.equal(await page.textContent("#result-meta"), "5 of 15 topics defined");
  assert.equal(await page.isVisible("#result-hint"), false, "the hint is only for 0 topics");

  // While the report is open, the header stays usable: the profile menu, the projects and the theme still answer
  assert.equal(await page.evaluate(() => document.querySelector(".header").inert), false);
  assert.equal(await page.evaluate(() => document.querySelector(".header").contains(document.activeElement)), false, "the focus stays in the report");
  await page.click("#avatar");
  assert.equal(await page.isVisible("#profile-menu"), true, "the profile menu opens over the report");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#profile-menu"), false, "Escape closes the menu");

  // Start over asks first; "Keep my analysis" is the default and leaves everything as it was
  await page.evaluate(() => { window.__alive = true; });
  await page.click("#result-restart");
  await page.waitForSelector("#restart-modal[open]");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "restart-cancel");
  await page.click("#restart-cancel");
  assert.equal(await page.evaluate(() => document.getElementById("restart-modal").open), false);
  assert.equal(await page.evaluate(() => window.__alive === true && !document.getElementById("result").hidden), true, "the report is still there, no reload");

  // Only the confirmation reloads the page
  await page.click("#result-restart");
  await page.waitForSelector("#restart-modal[open]");
  await Promise.all([page.waitForEvent("load"), page.click("#restart-confirm")]);
  assert.equal(await page.evaluate(() => window.__alive === undefined && document.getElementById("result").hidden), true, "reloaded: the report is gone");
  await context.close();
  return "report: lists say what they leave out, levels in words, header usable, Start over asks first";
}

let currentScenario = "";
const scenarioLabel = () => currentScenario;

const server = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
let failed = 0;
try {
  for (const scenario of [scenarioFullFlow, scenarioError, scenarioNoReport, scenarioQuestions, scenarioQuestionsFlow, scenarioReport]) {
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
