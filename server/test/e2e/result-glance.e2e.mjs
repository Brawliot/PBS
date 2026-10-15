/**
 * The top of the report in Chromium: the chips, the source marks, the budget range with its bar and fit, the four
 * needs, and the line about the basis. Shown live (after the questions, and on a first round without them) and
 * again after a reload, the same. Run by npm run test:e2e. Needs Playwright (see build-my-plan.mjs). Every outside
 * call is answered by page.route, so no key, database or model is needed.
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
const snapshot = JSON.parse(readFileSync(join(serverDir, "test/planner/fixtures/planner-run.snapshot.json"), "utf8"));

const PORT = 3979;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
// Screenshots for a look at the page: SCREENSHOTS is the folder, SCHEME the colour scheme the browser reports
// (light or dark, for the "System" theme), THEME the theme picked in the header (system, light, dark or contrast)
const SCREENSHOTS = process.env.SCREENSHOTS;
const SCHEME = process.env.SCHEME ?? "light";
const THEME = process.env.THEME ?? "system";
/** The card's entrance is 0.55 s: a screenshot waits for it to finish, in the theme chosen */
const shoot = async (page, name) => {
  if (!SCREENSHOTS) return;
  if (THEME !== "system") await page.click(`[data-theme-choice="${THEME}"]`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SCREENSHOTS, `${name}-${THEME}-${SCHEME}.png`) });
};

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Starts server.ts without a database and waits until it listens (the same as build-my-plan.mjs) */
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
/** A first-round analysis with questions: its phase 2 is what the browser keeps and sends back with the final request */
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
/** The snapshot's result, with a profile that has the values the top of the report reads */
const withProfile = (result) => ({
  ...result,
  profile: {
    ...result.profile,
    values: {
      ...result.profile.values,
      validation_stage: "Idea only",
      time_to_revenue: "0-3 months",
      capital_intensity: "Low (digital, near-zero marginal cost)",
      team_requirement: "Feasible solo",
      regulatory_load: "Heavy (health, finance, food)",
    },
  },
});
/** The report the server keeps for the run: the input and answers that were sent, the run's own parts, the glance */
const storedReport = (posts, result, glance) => {
  const body = posts.at(-1);
  const { reportId, glance: _ignored, ...parts } = result;
  return {
    input: { idea: body.idea, budget: body.budget, experience: body.experience, team: body.team, hours: body.hours },
    answers: body.answers,
    ...parts,
    ...(glance && { glance }),
  };
};
const eur = { min: 5_000, max: 9_000, currency: "EUR", fits: "Enough for a first version" };
const glanceOf = (budget, location = { value: "Madrid", source: "stated" }) => ({
  maturity: "developing",
  subsectorSource: "stated",
  location,
  budget,
});

/**
 * Answers the planner and the saved report. `results` answers each job in order: a function gets the job's body
 * (the final request echoes its glance, as the server does); `report` answers GET /api/reports/:id.
 * Returns the bodies of the planner POSTs.
 */
async function mockApi(page, { results, report }) {
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
  // The last route registered answers first: the catch-all goes before the saved report
  await page.route("**/api/reports/**", (route) => route.fulfill(json(404, { error: "Report not found", code: "not_found" })));
  await page.route(`**/api/reports/${REPORT_ID}`, (route) => route.fulfill(json(200, { id: REPORT_ID, report: report(), planId: null })));
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  return posts;
}

/** Fills the form like a user (every fixed question at its largest value) and submits it */
/** Answers the four fixed questions (budget, experience, team, hours) with the largest values */
async function answerSituation(page) {
  for (const [index, value] of ["1,000,000 €", "20", "Large (10+)", "Full time"].entries()) {
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

/** What the top of the report shows, read from the page: the text of each part, and the bar's positions */
async function topOfReport(page) {
  return page.evaluate(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, " ").trim();
    return {
      chips: shown("result-glance") ? [...document.querySelectorAll("#result-glance li")].map((li) => li.textContent) : null,
      budget: shown("result-budget")
        ? {
            row: shown("result-budget-row") ? text("result-budget-row") : null,
            bar: shown("result-budget-scale")
              ? {
                  zoneLeft: document.getElementById("result-budget-zone").style.left,
                  zoneWidth: document.getElementById("result-budget-zone").style.width,
                  you: shown("result-budget-you") ? document.getElementById("result-budget-you").style.left : null,
                }
              : null,
            note: text("result-budget-note"),
            fits: shown("result-budget-fits") ? text("result-budget-fits") : null,
          }
        : null,
      needs: shown("result-needs-block")
        ? [...document.querySelectorAll("#result-needs > div")].map((cell) => ({
            term: cell.querySelector("dt").textContent,
            value: cell.querySelector("dd").firstChild.textContent,
            small: [...cell.querySelectorAll("small")].map((small) => small.textContent),
          }))
        : null,
      next: text("result-next"),
    };
  });
}

/** Opens the result page with a finished analysis and keeps the top of the report it shows */
async function scenarioFinalRequest(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  const page = await context.newPage();
  await watch(page, "final request");
  const expected = glanceOf(eur);
  const posts = await mockApi(page, {
    results: [
      firstRound(eur),
      // The final request: the server keeps the glance it was sent (the mock echoes it, as the server does)
      (body) => ({ ...withProfile(snapshot.final), reportId: REPORT_ID, glance: body.glance }),
    ],
    report: () => storedReport(posts, withProfile(snapshot.final), posts.at(-1).glance),
  });
  await fillAndSend(page);
  await page.waitForSelector("#question.is-open", { timeout: 20_000 });
  // An option fills the answer; the arrow sends it
  await page.click('.question__option:has-text("Yes")');
  await page.click(".question__submit");
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });

  assert.deepEqual(posts.at(-1).glance, expected, "the final request sends the first round's glance, built from its analysis");
  const live = await topOfReport(page);
  await shoot(page, "glance-complete");
  assert.deepEqual(live.chips, ["Idea: In development", "Stage: Idea only", "Location: Madrid you said"]);
  assert.equal(live.budget.row, "Budget €5,000 – €9,000 estimated");
  assert.equal(live.budget.note, "Estimated budget: €5,000 – €9,000. Your budget: €1,000,000.");
  assert.equal(live.budget.fits, "Enough for a first version", "the fit text is shown under the range");
  assert.match(live.budget.bar.zoneLeft, /^0\.5/);
  assert.equal(live.budget.bar.you, "100%", "the person's budget is the top of the scale");
  assert.equal(live.next, "From your idea and 1 answer. Next: phases, departments, tasks, calendar.");
  // The fixed questions were answered with their largest values: team 3 is "Large (10+)"
  assert.deepEqual(live.needs, NEEDS_FOR_TEAM_LARGE, "the four needs, and what the person offers under Team");

  await page.reload();
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.deepEqual(await topOfReport(page), live, "after a reload the top of the report is the same");

  assertNoProblems();
  await context.close();
  return "final request: the chips, the budget bar and the basis line are the same live and after a reload";
}

/** A first round without questions: the server builds the glance itself; here the page is only checked */
async function scenarioNoQuestions(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  const page = await context.newPage();
  await watch(page, "no questions");
  const glance = glanceOf({ min: 5_000, max: 9_000, currency: "GBP", fits: "Enough for a first version" }, { value: "Manchester, UK", source: "inferred" });
  const posts = await mockApi(page, {
    results: [{ ...withProfile(snapshot.noQuestions), reportId: REPORT_ID, glance }],
    report: () => storedReport(posts, withProfile(snapshot.noQuestions), glance),
  });
  await fillAndSend(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });

  const live = await topOfReport(page);
  await shoot(page, "glance-no-questions");
  assert.deepEqual(live.chips, ["Idea: In development", "Stage: Idea only", "Location: Manchester, UK inferred"]);
  // Not euros: no mark of the person's budget, and the range keeps its currency code
  assert.equal(live.budget.row, "Budget GBP 5,000 – GBP 9,000 estimated");
  assert.equal(live.budget.bar.you, null, "no mark of the person's budget for a currency other than euros");
  assert.equal(live.budget.note, "Estimated budget: GBP 5,000 – GBP 9,000.");
  assert.equal(live.next, "From your idea. Next: phases, departments, tasks, calendar.");

  await page.reload();
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.deepEqual(await topOfReport(page), live, "after a reload the top of the report is the same");
  assertNoProblems();
  await context.close();
  return "no questions: a currency other than euros has no mark, and the same after a reload";
}

/** A report without a range: only the fit text is shown, and the report without a glance shows as before */
async function scenarioNoRange(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: SCHEME });
  const page = await context.newPage();
  await watch(page, "no range");
  const glance = glanceOf({ min: null, max: null, currency: "", fits: "Not enough information to compare" }, { value: "", source: "unknown" });
  await mockApi(page, { results: [{ ...withProfile(snapshot.noQuestions), reportId: REPORT_ID, glance }] });
  await fillAndSend(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  const live = await topOfReport(page);
  await shoot(page, "glance-missing");
  assert.equal(live.budget.row, null, "no range, no row");
  assert.equal(live.budget.bar, null, "no range, no bar");
  assert.equal(live.budget.fits, "Not enough information to compare");
  assert.deepEqual(live.chips, ["Idea: In development", "Stage: Idea only"], "the location has no value, so it has no chip");
  assertNoProblems();
  await context.close();
  return "no range: only the fit text shows, and the location chip is left out";
}

// The four needs, as the profile above and the form's team (3) read them
const NEEDS_FOR_TEAM_LARGE = [
  { term: "Time to first revenue", value: "0-3 months", small: [] },
  { term: "Capital", value: "Low", small: ["digital, near-zero marginal cost"] },
  { term: "Team", value: "Feasible solo", small: ["You offer: Large (10+)"] },
  { term: "Regulation", value: "Heavy", small: ["health, finance, food"] },
];

const scenarios = [scenarioFinalRequest, scenarioNoQuestions, scenarioNoRange];
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
  console.error(`${failed} result-glance check(s) failed`);
  process.exit(1);
}
