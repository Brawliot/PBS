/**
 * The top of the report in Chromium: what was understood with its source marks, the budget range with its bar and fit
 * (in the full detail), the four needs against what the person has, and the clarity. Shown live (after the questions, and on a first round without them) and
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
      questions: [{ topic: "existing_customers", question: "Do you already have customers?", options: ["Yes", "No"] }],
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
    // As the server keeps it: an "I don't know" has the lowest number of its range as a placeholder
    input: {
      idea: body.idea,
      location: body.location ?? "",
      budget: body.budget ?? 0,
      start_mode: body.start_mode ?? "scratch",
      premises: body.premises ?? "have",
      ...(body.unknown && { unknown: body.unknown }),
    },
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
  sources: { target_customer: "inferred", value_proposition: "stated", revenue_model: "unknown", stage: "stated", competition: "stated" },
});
/** The clarity the server computes (server/plan/clarity.ts); the page only draws it */
const CLARITY = {
  version: 1,
  concept: { level: "medium", score: 61, missing: ["How it makes money", "How it reaches customers", "What sets it apart"] },
  person: { level: "medium", score: 61, missing: ["What you can do yourself", "Handling other people's money", "Fixed deadline"] },
};

/**
 * Answers the planner and the saved report. `results` answers each job in order: a function gets the job's body
 * (the final request echoes its glance, as the server does); `report` answers GET /api/reports/:id.
 * Returns the bodies of the planner POSTs.
 */
/** When what was understood is on screen, it is confirmed with Generate report; then the result is on screen */
async function confirmReview(page) {
  await page.waitForSelector("#review:not([hidden]), #result:not([hidden])", { timeout: 20_000 });
  if (await page.isVisible("#review")) await page.click("#review-generate");
}

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

/** What the top of the report shows, read from the page: the text of each part, and the bar's positions */
async function topOfReport(page) {
  return page.evaluate(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, " ").trim();
    return {
      understood: text("result-understood-business"),
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
      clarity: shown("result-clarity")
        ? [...document.querySelectorAll("#result-clarity .clarity__row")].map((row) => row.innerText.replace(/\s+/g, " ").trim())
        : null,
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
      (body) => ({ ...withProfile(snapshot.final), reportId: REPORT_ID, glance: body.glance, clarity: CLARITY }),
    ],
    report: () => ({ ...storedReport(posts, withProfile(snapshot.final), posts.at(-1).glance), clarity: CLARITY }),
  });
  await fillAndSend(page);
  await page.waitForSelector("#question.is-open", { timeout: 20_000 });
  // An option fills the answer; the arrow sends it
  await page.click('.question__option:has-text("Yes")');
  await page.click(".question__submit");
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });

  assert.deepEqual(posts.at(-1).glance, expected, "the final request sends the first round's glance, built from its analysis");
  const live = await topOfReport(page);
  await shoot(page, "glance-complete");
  assert.equal(live.understood, "Bakery you said · for Households inferred · Madrid you said · Idea only", "the business in one line, the stage included");
  assert.equal(await page.textContent("#result-understood-you"), "You: €200,000 to invest · From scratch · I have them");
  assert.equal(live.budget.row, "Budget €5,000 – €9,000 estimated");
  assert.equal(live.budget.note, "Estimated budget: €5,000 – €9,000. Your budget: €200,000.");
  assert.equal(live.budget.fits, "Enough for a first version", "the fit text is shown under the range");
  assert.match(live.budget.bar.zoneLeft, /^2\.5/);
  assert.equal(live.budget.bar.you, "100%", "the person's budget is the top of the scale");
  // The fixed questions were answered with their largest values: the budget range's top, and the rest as they are
  assert.deepEqual(live.needs, NEEDS_FOR_BUDGET_TOP, "the money against the person's budget, and the time and team");
  assert.deepEqual(live.clarity, [
    "Your business Medium Missing: How it makes money, how it reaches customers…",
    "You Medium Missing: What you can do yourself, handling other people's money…",
  ], "two short items at most on the card");

  await page.reload();
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.deepEqual(await topOfReport(page), live, "after a reload the top of the report is the same");

  assertNoProblems();
  await context.close();
  return "final request: what was understood, the budget bar and the needs are the same live and after a reload";
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
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });

  const live = await topOfReport(page);
  await shoot(page, "glance-no-questions");
  assert.match(live.understood, /Manchester, UK inferred/);
  // Not euros: no mark of the person's budget, and the range keeps its currency code
  assert.equal(live.budget.row, "Budget GBP 5,000 – GBP 9,000 estimated");
  assert.equal(live.budget.bar.you, null, "no mark of the person's budget for a currency other than euros");
  assert.equal(live.budget.note, "Estimated budget: GBP 5,000 – GBP 9,000.");

  await page.reload();
  await confirmReview(page);
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
  // A report kept before the clarity existed: the block is not drawn
  const { clarity: _old, ...older } = snapshot.noQuestions;
  await mockApi(page, { results: [{ ...withProfile(older), reportId: REPORT_ID, glance }] });
  await fillAndSend(page);
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  const live = await topOfReport(page);
  await shoot(page, "glance-missing");
  assert.equal(live.budget.row, null, "no range, no row");
  assert.equal(live.budget.bar, null, "no range, no bar");
  assert.equal(live.budget.fits, "Not enough information to compare");
  assert.doesNotMatch(live.understood, /Madrid|unknown/i, "a place with no value is not said");
  assert.equal(live.clarity, null, "a report without clarity shows no clarity block");
  assertNoProblems();
  await context.close();
  return "no range: only the fit text shows, and the location chip is left out";
}

// The needs, as the profile above and the budget's top range read them
const NEEDS_FOR_BUDGET_TOP = [
  { term: "Money", value: "€5,000 – €9,000", small: ["You have €200,000: covers it"] },
  { term: "Your time", value: "Not known yet", small: ["For your own parts"] },
  { term: "Team", value: "Feasible solo", small: ["Estimate"] },
  { term: "First revenue", value: "0-3 months", small: ["Estimate"] },
];

/**
 * "I don't know" in the fixed questions, at phone width: the option counts as answered, Back says it can be changed,
 * the request carries the unknown list and no number for it, and the result shows no budget mark and no team offer.
 */
async function scenarioDontKnow(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: SCHEME });
  const page = await context.newPage();
  await watch(page, "I don't know");
  const glance = { ...glanceOf(eur), budget: { ...eur, fits: "" } };
  const clarity = {
    version: 1,
    concept: CLARITY.concept,
    person: { level: "low", score: 44, missing: ["How you start", "Premises", "What you can do yourself"] },
  };
  const posts = await mockApi(page, {
    results: [{ ...withProfile(snapshot.noQuestions), reportId: REPORT_ID, glance, clarity }],
    report: () => ({ ...storedReport(posts, withProfile(snapshot.noQuestions), glance), clarity }),
  });
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", "Bakery delivery");
  await page.click(".search__submit");
  const at = (number) =>
    page.waitForFunction(
      (n) => document.getElementById("question").classList.contains("is-open")
        && document.getElementById("question-progress").textContent.startsWith(`Question ${n} of`),
      number,
      { timeout: 20_000 },
    );

  // Premises first now: the "I don't know" option, sent with the arrow, then Back to it
  await at(1);
  const options = await page.$$eval(".question__option", (buttons) => buttons.map((b) => b.textContent));
  assert.equal(options.at(-1), "I don't know", "every fixed question offers I don't know");
  await page.click('.question__option:has-text("I don\'t know")');
  await page.click(".question__submit");
  await at(2);
  await page.click("#question-back");
  await at(1);
  assert.equal(await page.inputValue(".question__input"), "I don't know");
  assert.match(await page.textContent("#question-note"), /You can change it/);
  assert.equal(await page.getAttribute(".question__input", "aria-invalid"), null, "the note is not an error");
  await shoot(page, "dont-know-back");
  // Typed over it: "not sure" is an answer for premises, sent as it is
  await page.fill(".question__input", "Not sure if I need one");
  await page.press(".question__input", "Enter");
  // How they start: typed "I don't know"
  await at(2);
  await page.fill(".question__input", "i dont know");
  await page.press(".question__input", "Enter");
  // Budget: typed
  await at(3);
  await page.fill(".question__input", "25,000");
  await page.press(".question__input", "Enter");
  // Location last: "I don't know", sent with the arrow
  await at(4);
  await page.click('.question__option:has-text("I don\'t know")');
  await page.click(".question__submit");
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });

  const body = posts[0];
  assert.deepEqual(body.unknown, ["start_mode", "location"], "in the order the questions are asked");
  assert.equal("location" in body, false, "no value for an unknown location");
  assert.equal("start_mode" in body, false, "no value for an unknown start");
  assert.equal(body.budget, 25_000);
  assert.equal(body.premises, "unsure", "not sure is an answer, sent as it is");

  const live = await topOfReport(page);
  await shoot(page, "dont-know-result");
  assert.equal(live.budget.bar.you !== null, true, "the budget typed is marked");
  assert.deepEqual(live.clarity, [
    "Your business Medium Missing: How it makes money, how it reaches customers…",
    "You Low Missing: How you start, premises…",
  ]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no horizontal scroll at phone width (${overflow}px)`);

  await page.reload();
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.deepEqual(await topOfReport(page), live, "after a reload the same, with the placeholders of the saved report not shown");
  assertNoProblems();
  await context.close();
  return "I don't know: counts as answered, Back can change it, the request flags it, and the result leaves it out";
}

const scenarios = [scenarioFinalRequest, scenarioNoQuestions, scenarioNoRange, scenarioDontKnow];
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
