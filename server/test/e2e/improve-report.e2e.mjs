/**
 * Readiness and "Improve my report" in Chromium: the light from clarity.readiness, the plan buttons it gates, the
 * round of questions about what is missing, the final request it sends again, and the new report with the change
 * of level. Run by npm run test:e2e. Needs Playwright (see build-my-plan.mjs). Every outside call is answered by
 * page.route, so no key, database or model is needed.
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
// The result of a report kept before the diagnosis: the previous view. The diagnosis has its own e2e (diagnosis-view).
const { diagnosis: _diagnosis, ...finalWithoutDiagnosis } = snapshot.final;

const PORT = 3981;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_IDS = ["33333333-3333-4333-8333-333333333331", "33333333-3333-4333-8333-333333333332", "33333333-3333-4333-8333-333333333333"];

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
const firstRound = {
  jev: snapshot.withQuestions.jev,
  phase2: {
    maturity: "developing",
    subsector: section("Bakery", "stated"),
    location: section("Madrid", "stated"),
    target_customer: section("Households", "inferred"),
    value_proposition: section("Fresh bread at home", "stated"),
    revenue_model: section("unknown", "unknown"),
    stage: section("Idea only", "stated"),
    competition: section("Local bakeries", "stated"),
    constraints: { budget: { min: 5_000, max: 9_000, currency: "EUR", fits: "" }, exclusions: [], risks: [], assumptions: [] },
    questions: [{ topic: "existing_customers", question: "Do you already have customers?", options: ["Yes", "No"] }],
  },
  questionTotal: 1,
};
const metric = (level, missing, essentialMissing) => ({ level, score: 50, missing, essentialMissing });
const YELLOW = {
  version: 2,
  concept: metric("medium", ["How it makes money", "How it reaches customers", "What sets it apart"], true),
  person: metric("medium", ["What you can do yourself", "Handling other people's money", "Fixed deadline"], true),
  readiness: "yellow",
};
const GREEN = {
  version: 2,
  concept: metric("high", ["What sets it apart"], false),
  person: metric("medium", ["Fixed deadline", "Existing assets"], false),
  readiness: "green",
};
const RED = {
  version: 2,
  concept: metric("low", ["Value proposition", "Target customer", "How it makes money"], true),
  person: metric("medium", ["What you can do yourself"], true),
  readiness: "red",
};

/** The planner answers each job in order with `results`; each report id is served back with its clarity */
/** When what was understood is on screen, it is confirmed with Generate report; then the result is on screen */
async function confirmReview(page) {
  await page.waitForSelector("#review:not([hidden]), #result:not([hidden])", { timeout: 20_000 });
  if (await page.isVisible("#review")) await page.click("#review-generate");
}

async function mockApi(page, results) {
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
  await page.route("**/api/reports/**", (route) => {
    const id = route.request().url().split("/").pop();
    const index = REPORT_IDS.indexOf(id);
    if (index === -1) return route.fulfill(json(404, { error: "Report not found", code: "not_found" }));
    const body = posts[index + 1];
    const { reportId: _id, ...parts } = typeof results[index + 1] === "function" ? results[index + 1](body) : results[index + 1];
    return route.fulfill(json(200, {
      id,
      report: { input: { idea: body.idea, location: body.location ?? "", budget: body.budget ?? 0, start_mode: body.start_mode ?? "scratch", premises: body.premises ?? "have" }, answers: body.answers, ...parts },
      planId: null,
    }));
  });
  return posts;
}

const finalResult = (index, clarity) => (body) => ({ ...finalWithoutDiagnosis, reportId: REPORT_IDS[index], glance: body.glance, clarity });

async function reachReport(page) {
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", "Bakery delivery");
  await page.click(".search__submit");
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
  await page.waitForSelector("#question.is-open", { timeout: 20_000 });
  await page.click('.question__option:has-text("Yes")');
  await page.click(".question__submit");
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
}

/** What the readiness part shows, read from the page */
const readiness = (page) => page.evaluate(() => {
  const shown = (id) => !document.getElementById(id).hidden;
  return {
    state: document.getElementById("result-ready").dataset.state,
    title: document.getElementById("result-ready-title").textContent,
    improve: shown("result-improve"),
    plan: shown("result-plan") ? (document.getElementById("result-plan").disabled ? "disabled" : "enabled") : "hidden",
    anyway: shown("result-plan-anyway"),
    levels: [...document.querySelectorAll("#result-clarity .clarity__level")].map((el) => el.textContent),
  };
});

async function scenarioYellowToGreen(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await watch(page, "yellow to green");
  const posts = await mockApi(page, [firstRound, finalResult(0, YELLOW), finalResult(1, GREEN)]);
  await reachReport(page);

  assert.deepEqual(await readiness(page), {
    state: "yellow",
    title: "I can build a plan, but a generic one",
    improve: true,
    plan: "hidden",
    anyway: true,
    levels: ["Medium", "Medium"],
  });

  await page.click("#result-improve-open");
  // The person comes first while the business is not Low: trade experience, then how it makes money, then how customers find it
  const legends = await page.$$eval("#result-quiz legend", (items) => items.map((item) => item.textContent));
  assert.deepEqual(legends, [
    "Have you worked in this trade or sector before?",
    "How will it make money?",
    "How will customers find you?",
  ]);
  const items = page.locator("#result-quiz .quiz__item");
  await items.nth(0).locator('button:has-text("Yes, for years")').click();
  await items.nth(1).locator('button:has-text("Subscription")').click();
  await items.nth(2).locator("button.is-unsure").click();
  await page.click("#result-quiz-send");
  await page.waitForFunction(() => document.getElementById("result-ready").dataset.state === "green", null, { timeout: 20_000 });

  assert.equal(await page.textContent("#toast-text"), "Report updated: 2 answers added · your business high.", "the update says what changed");
  const sent = posts.at(-1);
  assert.equal(sent.final, true, "the round sends the final request again");
  assert.deepEqual(sent.answers.map(({ topic }) => topic), ["existing_customers", "trade_experience", "revenue"], "the new answers are added; an I don't know is not sent");
  assert.equal(sent.answers[2].answer, "Subscription");
  assert.deepEqual(sent.glance, posts[1].glance, "the same glance as the first final request");
  assert.equal(sent.budget, 200_000);

  assert.deepEqual(await readiness(page), {
    state: "green",
    title: "Ready for a plan made for you",
    improve: true, // optional in green while there is something left to ask
    plan: "enabled",
    anyway: false,
    levels: ["Medium → High", "Medium"],
  });
  assert.equal(await page.evaluate(() => history.state.reportId), REPORT_IDS[1], "the new report replaces the old one");

  await page.reload();
  await confirmReview(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  const after = await readiness(page);
  assert.equal(after.state, "green");
  assert.deepEqual(after.levels, ["High", "Medium"], "after a reload the levels show without the change");
  assert.match(await page.textContent("#result-clarity-concept-missing"), /^To verify in your plan: /, "in green what is missing goes to the plan");
  assert.match(await page.textContent("#result-improve-text"), /^Optional/);
  assertNoProblems();
  await context.close();
  return "yellow: Build anyway, a round of three questions, the final request again, then green with the change shown";
}

async function scenarioRed(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await watch(page, "red");
  // The model had no budget range and wrote "unknown" as its fit and its place: neither is shown as text
  const blank = structuredClone(firstRound);
  blank.phase2.constraints.budget = { min: null, max: null, currency: "EUR", fits: "unknown" };
  blank.phase2.location = section("unknown", "unknown");
  await mockApi(page, [blank, finalResult(0, RED), finalResult(1, RED), finalResult(2, RED)]);
  await reachReport(page);
  assert.equal(await page.evaluate(() => document.getElementById("result-budget").hidden), true, "no budget box that only says unknown");
  assert.doesNotMatch(await page.textContent("#result"), /unknown/i, "the word unknown is never shown");

  const red = await readiness(page);
  assert.equal(red.state, "red");
  assert.equal(red.plan, "disabled", "a red report that can be improved cannot build a plan yet");
  assert.equal(red.improve, true);
  // The business goes first while it is Low
  await page.click("#result-improve-open");
  assert.equal(await page.textContent("#result-quiz legend"), "What problem do you solve for your customers?");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no horizontal scroll at phone width (${overflow}px)`);

  // Two rounds of "I don't know": nothing left to ask, so the red report is no dead end
  for (let round = 0; round < 2; round++) {
    if (round) await page.click("#result-improve-open");
    for (const button of await page.$$("#result-quiz button.is-unsure")) await button.click();
    await page.click("#result-quiz-send");
    await page.waitForFunction(() => document.getElementById("result-quiz").hidden, null, { timeout: 20_000 });
  }
  const last = await readiness(page);
  assert.equal(last.improve, false, "two rounds at most");
  assert.equal(last.plan, "enabled", "with nothing left to improve the plan can be built");
  assertNoProblems();
  await context.close();
  return "red: the plan waits for the round; after two rounds it can be built anyway";
}

/** The parts of the business, as the server checks and adds them up (plan/execution.ts) */
const part = (name, who, mandoKey, costMin, costMax, hoursWeek, reason = "") => ({ name, who, mandoKey, costMin, costMax, hoursWeek, reason });
const EXECUTION = {
  items: [
    part("Online store", "mando", "online_store", 3000, 6000, null),
    part("CRM", "mando", "crm", 1000, 2000, null),
    part("Stock", "you", null, 2000, 3000, 6),
    part("Sales and suppliers", "you", null, null, null, 30),
    part("Tax advice", "outsource", null, 600, 900, null, "A legal obligation: a gestor keeps it right."),
  ],
  pay: { min: 2600, max: 3900 },
  saved: { min: 4000, max: 8000 },
  hours: 36,
};

async function scenarioExecution(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await watch(page, "execution");
  const glance = {
    maturity: "developing",
    subsectorSource: "stated",
    location: { value: "Madrid", source: "stated" },
    budget: { min: 2600, max: 3900, currency: "EUR", fits: "" },
    sources: { target_customer: "inferred", value_proposition: "stated", revenue_model: "unknown", stage: "stated", competition: "stated" },
    execution: EXECUTION,
  };
  // The first round carries the server's glance: the final request sends it back as it is
  const posts = await mockApi(page, [{ ...firstRound, glance }, finalResult(0, YELLOW)]);
  await reachReport(page);
  assert.deepEqual(posts[1].glance, glance, "the final request sends back the server's glance, parts included");

  const cells = await page.$$eval("#result-needs > div", (items) => items.map((cell) => cell.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(cells.slice(0, 2), [
    "Money €2,600 – €3,900 You have €200,000: covers it Mando covers Online store, CRM: saves ~€4,000 – €8,000",
    "Your time ~36 h a week For your own parts",
  ]);
  await page.click("#result-detail-open");
  const groups = await page.$$eval("#detail-execution .execution__group", (items) => items.map((group) => group.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(groups, [
    "Mando does it Online store Included · saves ~€3,000 – €6,000 CRM Included · saves ~€1,000 – €2,000",
    "You do it Stock €2,000 – €3,000 · ~6 h a week Sales and suppliers ~30 h a week",
    "Hire it out Tax advice €600 – €900 A legal obligation: a gestor keeps it right.",
  ]);
  assertNoProblems();
  await context.close();
  return "execution: the money the person pays, what Mando saves, the hours asked, and who does what in the detail";
}

for (const scenario of [scenarioYellowToGreen, scenarioRed, scenarioExecution]) {
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
  console.error(`${failed} improve-report check(s) failed`);
  process.exit(1);
}
