/**
 * The time to open, the upfront cost and the starter templates in Chromium: the block "Time & cost" under the
 * budget, the button that opens the three templates the model picked, and Copy. Shown live and after a reload, the
 * same; a report without these parts looks as it did before. Run by npm run test:e2e. Needs Playwright (see
 * build-my-plan.mjs). Every outside call is answered by page.route, so no key, database or model is needed.
 */

import { spawn, execFileSync } from "node:child_process";
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
const snapshot = JSON.parse(readFileSync(join(serverDir, "test/planner/fixtures/planner-run.snapshot.json"), "utf8"));
// The result of a report kept before the diagnosis: the previous view. The diagnosis has its own e2e (diagnosis-view).
const { diagnosis: _diagnosis, ...finalWithoutDiagnosis } = snapshot.final;
// The catalog the server serves, read from the same module the route uses (it needs no session or database)
const CATALOG = JSON.parse(
  execFileSync(process.execPath, ["--import", "tsx", "-e", 'import("./planner/report-templates.ts").then((m) => process.stdout.write(JSON.stringify(m.REPORT_TEMPLATES)))'], {
    cwd: serverDir,
    encoding: "utf8",
  }),
);

const PORT = 3980;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
// Screenshots for a look at the page: see result-glance.e2e.mjs
const SCREENSHOTS = process.env.SCREENSHOTS;
const SCHEME = process.env.SCHEME ?? "light";
const shoot = async (page, name) => {
  if (!SCREENSHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SCREENSHOTS, `${name}-${SCHEME}.png`), fullPage: true });
};

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Starts server.ts without a database and waits until it listens (the same as result-glance.e2e.mjs) */
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let failed = 0;

const section = (value, source) => ({ value, source, confidence: 80 });
/** A first-round analysis with one question: the browser keeps its phase 2 and sends it back with the final request */
function firstRound(budget, location = section("Madrid", "stated")) {
  return {
    jev: snapshot.withQuestions.jev,
    phase2: {
      maturity: "developing",
      subsector: section("Bakery", "stated"),
      location,
      target_customer: section("Households", "inferred"),
      value_proposition: section("Fresh bread at home", "stated"),
      revenue_model: section("Commission per order", "unknown"),
      stage: section("Idea only", "stated"),
      competition: section("Local bakeries", "stated"),
      constraints: { budget, exclusions: [], risks: [], assumptions: [] },
      questions: [{ topic: "validation", question: "Have you tested it with customers?", options: ["Yes", "No"] }],
    },
    questionTotal: 1,
  };
}
/** The snapshot's result, with the profile values the top of the report reads */
const withProfile = (result) => ({
  ...result,
  profile: {
    ...result.profile,
    values: { ...result.profile.values, validation_stage: "Idea only", time_to_revenue: "0-3 months" },
  },
});
const storedReport = (posts, result, glance) => {
  const body = posts.at(-1);
  const { reportId, glance: _ignored, ...parts } = result;
  return {
    input: { idea: body.idea, location: body.location, budget: body.budget, start_mode: body.start_mode, premises: body.premises },
    answers: body.answers,
    ...parts,
    ...(glance && { glance }),
  };
};
const usd = { min: 5_000, max: 9_000, currency: "USD", fits: "Enough for a first version" };
const glanceOf = (location = { value: "Madrid", source: "stated" }) => ({
  maturity: "developing",
  subsectorSource: "stated",
  location,
  budget: usd,
});

/** The explanations of a report with all three parts: the model's time, the split, and three picks */
const ALL_PARTS = {
  timeToOpen: { min: 3, max: 5, unit: "months", confidence: "medium" },
  costBreakdown: [
    { label: "Equipment", percent: 55 },
    { label: "Licences", percent: 15 },
    { label: "Stock", percent: 30 },
  ],
  templates: ["supplier-quote", "licence-enquiry", "price-test"],
};

/**
 * Answers the planner and the saved report. `results` answers each job in order; a function gets the job's body
 * (the final request echoes its glance, as the server does). `catalog` answers GET /api/report-templates.
 */
/** When what was understood is on screen, it is confirmed with Generate report; then the result is on screen */
async function confirmReview(page) {
  await page.waitForSelector("#review:not([hidden]), #result:not([hidden])", { timeout: 20_000 });
  if (await page.isVisible("#review")) await page.click("#review-generate");
}

async function mockApi(page, { results, report, catalog = () => json(200, { templates: CATALOG }) }) {
  const posts = [];
  await page.route("**/api/auth/session", (route) => route.fulfill(json(200, { user: { name: "Ana" } })));
  await page.route("**/api/planner", (route) => {
    posts.push(JSON.parse(route.request().postData() ?? "null"));
    return route.fulfill(json(202, { jobId: JOB_ID.slice(0, -1) + posts.length }));
  });
  await page.route("**/api/planner/*", (route) => {
    const number = Number(route.request().url().slice(-1));
    const result = results[number - 1];
    return route.fulfill(json(200, { status: "done", result: typeof result === "function" ? result(posts[number - 1]) : result }));
  });
  await page.route("**/api/report-templates", (route) => route.fulfill(catalog()));
  await page.route("**/api/reports/**", (route) => route.fulfill(json(404, { error: "Report not found", code: "not_found" })));
  await page.route(`**/api/reports/${REPORT_ID}`, (route) => route.fulfill(json(200, { id: REPORT_ID, report: report(), planId: null })));
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  return posts;
}

/** Fills the form like a user (every fixed question at its largest value) and submits it */
/** Answers the four fixed questions (location, budget, how they start, premises) with the largest values */
async function answerSituation(page) {
  for (const [index, value] of ["I have them", "From scratch", "Over 150,000 €", "Madrid"].entries()) {
    await page.waitForFunction(
      (number) => document.getElementById("question").classList.contains("is-open")
        && document.getElementById("question-progress").textContent.startsWith(`Question ${number} of`),
      index + 1,
      { timeout: 20_000 },
    );
    await page.fill(".question__input", value);
    await page.press(".question__input", "Enter");
  }
}

async function fillAndSend(page) {
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", "Bakery delivery");
  await page.click(".search__submit");
  await answerSituation(page);
}

/** Runs the analysis to its result: the first round asks one question, then the final request is sent */
async function reachResult(page) {
  await fillAndSend(page);
  await page.waitForSelector("#question.is-open", { timeout: 20_000 });
  await page.click('.question__option:has-text("Yes")');
  await page.click(".question__submit");
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
}

/** What the time and cost block shows, read from the page, and the widths of the bar */
async function timeAndCost(page) {
  return page.evaluate(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, " ").trim();
    return {
      block: shown("result-costs-block"),
      time: shown("result-time-row") ? { value: text("result-time-value"), note: text("result-time-note") } : null,
      cost: shown("result-cost-row")
        ? {
            note: text("result-cost-note"),
            widths: [...document.querySelectorAll("#result-cost-stack > span")].map((span) => span.style.width),
          }
        : null,
      button: !document.getElementById("result-templates-open").hidden,
    };
  });
}

/** Opens the starter templates and reads what the dialog shows */
async function templatesDialog(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("templates-modal");
    return {
      open: dialog.open,
      titles: [...dialog.querySelectorAll(".template__title")].map((title) => title.textContent),
      bodies: [...dialog.querySelectorAll(".template__body")].map((body) => body.textContent),
    };
  });
}

/** Scenario: the final request with all three parts: the block, the dialog, Copy, then the same after a reload */
async function scenarioAllParts(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();
  await watch(page, "all parts");
  const posts = await mockApi(page, {
    results: [
      firstRound(usd),
      (body) => ({ ...withProfile(finalWithoutDiagnosis), reportId: REPORT_ID, glance: body.glance, explanations: ALL_PARTS }),
    ],
    report: () => storedReport(posts, { ...withProfile(finalWithoutDiagnosis), explanations: ALL_PARTS }, posts.at(-1).glance),
  });
  await reachResult(page);

  const live = await timeAndCost(page);
  await shoot(page, "time-cost");
  assert.deepEqual(live.time, { value: "3–5 months", note: "medium confidence · estimate" });
  assert.deepEqual(live.cost, { note: "Equipment 55% · Licences 15% · Stock 30%", widths: ["55%", "15%", "30%"] });
  assert.equal(live.button, true, "the starter templates button is shown");
  const label = await page.textContent("#result-templates-open");
  assert.equal(label, "Starter templates (3)");

  await page.click("#result-detail-open"); // the templates are in the full detail
  await page.click("#result-templates-open");
  await page.waitForSelector("#templates-modal[open]", { timeout: 10_000 });
  const dialog = await templatesDialog(page);
  await shoot(page, "templates-dialog");
  assert.equal(dialog.open, true);
  assert.deepEqual(dialog.titles, ["Supplier quote request", "Licence and permit enquiry", "Price test with real customers"]);
  for (const body of dialog.bodies) assert.ok(!body.includes("{{location}}"), "the placeholder is filled");
  // The first two picks have the placeholder (supplier quote, licence enquiry); the price test has none
  assert.ok(dialog.bodies[0].includes("in Madrid and I am comparing"), "the location of the report is in the text");
  assert.ok(dialog.bodies[1].includes("in Madrid. I would like"), "the location is in the licence text too");

  // Copy: the text on the button changes for two seconds, and the clipboard has the text shown
  const expected = dialog.bodies[0];
  await page.click("#templates-list .template__copy");
  await page.waitForFunction(() => document.querySelector("#templates-list .template__copy").textContent === "Copied", null, { timeout: 5_000 });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected, "Copy puts the shown text on the clipboard");
  await page.waitForFunction(() => document.querySelector("#templates-list .template__copy").textContent === "Copy", null, { timeout: 5_000 });

  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.getElementById("templates-modal").open), false, "Escape closes the dialog");

  await page.reload();
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.deepEqual(await timeAndCost(page), live, "after a reload the block and the button are the same");

  assertNoProblems();
  await context.close();
  return "all parts: the block, the three templates with the location filled, Copy, and the same after a reload";
}

/** Scenario: only some parts (the time, no split and no templates): only the time shows, and no button */
async function scenarioSomeParts(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  const page = await context.newPage();
  await watch(page, "some parts");
  const onlyTime = { timeToOpen: ALL_PARTS.timeToOpen };
  const posts = await mockApi(page, {
    results: [
      firstRound(usd),
      (body) => ({ ...withProfile(finalWithoutDiagnosis), reportId: REPORT_ID, glance: body.glance, explanations: onlyTime }),
    ],
    report: () => storedReport(posts, { ...withProfile(finalWithoutDiagnosis), explanations: onlyTime }, posts.at(-1).glance),
  });
  await reachResult(page);
  const live = await timeAndCost(page);
  await shoot(page, "time-only");
  assert.deepEqual(live, { block: true, time: { value: "3–5 months", note: "medium confidence · estimate" }, cost: null, button: false });

  await page.reload();
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.deepEqual(await timeAndCost(page), live, "after a reload it is the same");
  assertNoProblems();
  await context.close();
  return "some parts: only the time shows, with no split and no templates button";
}

/** Scenario: a report without any of the three parts looks as before: no block, no button */
async function scenarioNoParts(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  const page = await context.newPage();
  await watch(page, "no parts");
  // The fixture's own explanations are left out: this report was kept before the three parts existed
  const { explanations: _kept, ...before } = withProfile(snapshot.noQuestions);
  const posts = await mockApi(page, {
    results: [{ ...before, reportId: REPORT_ID, glance: glanceOf() }],
    report: () => storedReport(posts, before, glanceOf()),
  });
  await fillAndSend(page);
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  const live = await timeAndCost(page);
  await shoot(page, "time-cost-missing");
  assert.deepEqual(live, { block: false, time: null, cost: null, button: false });
  assertNoProblems();
  await context.close();
  return "no parts: the report looks as before, with no block and no button";
}

/** Scenario: the catalog cannot be loaded, or the text cannot be copied: a message, and the report stays usable */
async function scenarioFailures(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  const page = await context.newPage();
  await watch(page, "failures");
  const posts = await mockApi(page, {
    results: [
      firstRound(usd),
      (body) => ({ ...withProfile(finalWithoutDiagnosis), reportId: REPORT_ID, glance: body.glance, explanations: ALL_PARTS }),
    ],
    report: () => storedReport(posts, { ...withProfile(finalWithoutDiagnosis), explanations: ALL_PARTS }, posts.at(-1).glance),
    catalog: () => json(500, { error: "Internal server error" }),
  });
  await reachResult(page);

  await page.click("#result-detail-open"); // the templates are in the full detail
  await page.click("#result-templates-open");
  await page.waitForSelector("#toast.is-open", { timeout: 10_000 });
  assert.equal(await page.textContent("#toast-text"), "We could not load the templates. Try again.");
  assert.equal(await page.evaluate(() => document.getElementById("templates-modal").open), false, "no dialog without the catalog");
  assert.equal(await page.isVisible("#result"), true, "the report stays usable");
  // Time & cost lives in the full detail now: drawn there, not on the card
  assert.equal(await page.evaluate(() => document.getElementById("result-costs-block").hidden), false);
  await context.close();

  // Copy without the clipboard permission: the page says how to copy by hand
  const denied = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  const second = await denied.newPage();
  // The clipboard refuses the copy: this page's clipboard is replaced before the page scripts run
  await second.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) } });
  });
  await watch(second, "copy denied");
  const posts2 = await mockApi(second, {
    results: [
      firstRound(usd),
      (body) => ({ ...withProfile(finalWithoutDiagnosis), reportId: REPORT_ID, glance: body.glance, explanations: ALL_PARTS }),
    ],
    report: () => storedReport(posts2, { ...withProfile(finalWithoutDiagnosis), explanations: ALL_PARTS }, posts2.at(-1).glance),
  });
  await reachResult(second);
  await second.click("#result-detail-open");
  await second.click("#result-templates-open");
  await second.waitForSelector("#templates-modal[open]", { timeout: 10_000 });
  await second.click("#templates-list .template__copy");
  await second.waitForSelector("#toast.is-open", { timeout: 10_000 });
  assert.equal(await second.textContent("#toast-text"), "Could not copy. Select the text and copy it by hand.");
  assert.equal(await second.textContent("#templates-list .template__copy"), "Copy", "the button does not say Copied");
  assertNoProblems();
  await denied.close();
  return "failures: no catalog gives a message and no dialog; a copy that is refused gives a message";
}

const scenarios = [scenarioAllParts, scenarioSomeParts, scenarioNoParts, scenarioFailures];
for (const scenario of scenarios) {
  try {
    console.log(`ok - ${await scenario(browser)}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${scenario.name}: ${error.message}`);
  }
}

await browser.close();
server.kill();
if (failed) {
  console.error(`${failed} time-cost-templates check(s) failed`);
  process.exit(1);
}
