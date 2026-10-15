/**
 * The diagnosis of the report in Chromium: the five checks with their states (symbol and word), the reason and the
 * estimate, the main risks, the three lines of who does what (an empty one is not shown), the improve link opening
 * its form, the focus on the title, and the old view for a report kept without a diagnosis. Run by npm run test:e2e.
 * Every outside call is answered by page.route: the diagnosis is simulated until the model writes it (the text here
 * is the mockup's). Content security policy violations and console errors fail the run.
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

const PORT = 3985;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const improveQuestions = JSON.parse(readFileSync(join(here, "fixtures/diagnosis-cases.json"), "utf8")).improve.improve;

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

const section = (value, source) => ({ value, source, confidence: 80 });
const metric = (level, missing, essentialMissing) => ({ level, score: 50, missing, essentialMissing });
/** Missing items make the report yellow, so the improve link is there */
const YELLOW = {
  version: 2,
  concept: metric("medium", ["How it makes money", "How it reaches customers", "What sets it apart"], true),
  person: metric("medium", ["What you can do yourself", "Handling other people's money", "Fixed deadline"], true),
  readiness: "yellow",
};
const firstRound = {
  jev: snapshot.withQuestions.jev,
  phase2: {
    maturity: "developing",
    subsector: section("Tapas bar", "stated"),
    location: section("Malasaña, Madrid", "stated"),
    target_customer: section("Locals and after-work crowds", "inferred"),
    value_proposition: section("Tapas for the neighbourhood", "stated"),
    revenue_model: section("unknown", "unknown"),
    stage: section("Idea only", "stated"),
    competition: section("Many tapas bars", "stated"),
    constraints: { budget: { min: 45_000, max: 60_000, currency: "EUR", fits: "" }, exclusions: [], risks: [], assumptions: [] },
    questions: [{ topic: "existing_customers", question: "Do you already have customers?", options: ["Yes", "No"] }],
  },
  questionTotal: 1,
};

/** The mockup's example, with one check of each state, the estimates marked, and two of the three lines of who does what */
const DIAGNOSIS = {
  idea: "A neighborhood tapas bar for locals and after-work crowds.",
  checks: [
    { key: "concept", status: "watch", why: "Clear, but not yet distinct. Decide what is yours: product, hours, price or atmosphere.", estimated: true, decidedBy: "jev" },
    { key: "location", status: "watch", why: "A busy street with real foot traffic, but high rent.", estimated: true, decidedBy: "jev" },
    { key: "money", status: "watch", why: "€40k is tight against a typical €45–60k takeover. About €8k of cushion is missing.", estimated: true, decidedBy: "rule" },
    { key: "experience", status: "strong", why: "Three years in hospitality: you already know the work.", estimated: false, decidedBy: "rule" },
    { key: "competition", status: "risk", why: "Very dense: many tapas bars in Malasaña, so price alone will not set you apart.", estimated: true, decidedBy: "jev" },
  ],
  risks: ["High rent in this area.", "Dependence on the terrace: licence and season.", "Very dense competition."],
  split: { mando: ["Online store"], you: ["Pick the menu and the suppliers"], outsource: [] },
};

async function mockApi(page, { finalResult, report }) {
  const posts = [];
  await page.route("**/api/auth/session", (route) => route.fulfill(json(200, { user: { name: "Ana" } })));
  await page.route("**/api/planner", (route) => {
    posts.push(JSON.parse(route.request().postData() ?? "null"));
    return route.fulfill(json(202, { jobId: JOB_ID.slice(0, -1) + posts.length }));
  });
  await page.route("**/api/planner/*", (route) => {
    const number = Number(route.request().url().slice(-1));
    // The job of the final request is the last one posted: a poll that comes first still finds its body
    const result = number === 1 ? firstRound : finalResult(posts[number - 1] ?? posts.at(-1));
    return route.fulfill(json(200, { status: "done", result }));
  });
  await page.route("**/api/reports/**", (route) => route.fulfill(json(404, { error: "Report not found", code: "not_found" })));
  await page.route(`**/api/reports/${REPORT_ID}`, (route) => route.fulfill(json(200, { id: REPORT_ID, report: report(posts), planId: null })));
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  // The planning questions of this report (the server's own, from the fixture's improve case). Before the catch-all.
  await page.route(`**/api/reports/${REPORT_ID}/improve-questions`, (route) => route.fulfill(json(200, { questions: improveQuestions })));
  // Registered last, so it is matched before the job route: the description has nothing to fill in
  await page.route("**/api/planner/detect", (route) =>
    route.fulfill(json(200, { detected: { location: null, budget: null, start_mode: null, premises: null }, jevToken: null })));
  return posts;
}

/** The report the server keeps: the input and answers sent, the run's parts, the glance and, when there is one, the diagnosis */
const storedReport = (posts, glance, diagnosis) => {
  const body = posts.at(-1);
  return {
    input: { idea: body.idea, location: body.location ?? "", budget: body.budget ?? 0, start_mode: body.start_mode ?? "scratch", premises: body.premises ?? "have" },
    answers: body.answers,
    jev: snapshot.final.jev,
    profile: snapshot.final.profile,
    validation: snapshot.final.validation,
    explanations: snapshot.final.explanations,
    glance,
    clarity: YELLOW,
    ...(diagnosis && { diagnosis }),
  };
};

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

/** Opens the result of a final request: the first round, the answer, then the result (the review is confirmed if shown) */
async function reachResult(page) {
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", "Tapas bar in Malasaña");
  await page.click(".search__submit");
  await answerSituation(page);
  await page.waitForSelector("#question.is-open", { timeout: 20_000 });
  await page.click('.question__option:has-text("Yes")');
  await page.click(".question__submit");
  await page.waitForSelector("#review:not([hidden]), #result:not([hidden])", { timeout: 20_000 });
  if (await page.isVisible("#review")) await page.click("#review-generate");
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
}

/** What the diagnosis shows, read from the page */
const readDiagnosis = (page) =>
  page.evaluate(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    // The older blocks are hidden by the stylesheet's class, so what counts is what is drawn
    const drawn = (id) => getComputedStyle(document.getElementById(id)).display !== "none";
    const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
    return {
      visible: shown("diagnosis"),
      eyebrow: text(document.getElementById("diagnosis-eyebrow")),
      title: text(document.getElementById("diagnosis-title")),
      idea: text(document.getElementById("diagnosis-idea")),
      checks: [...document.querySelectorAll("#diagnosis-checks > li")].map((item) => ({
        symbol: item.querySelector(".mark").textContent,
        mark: item.querySelector(".mark").className.replace("mark ", ""),
        name: text(item.querySelector(".name")),
        state: text(item.querySelector(".state")),
        why: item.querySelector(".why").firstChild.textContent.trim(),
        estimated: !!item.querySelector(".why .tier"),
      })),
      risks: [...document.querySelectorAll("#diagnosis-risks > li")].map(text),
      plan: shown("diagnosis-plan-block") ? [...document.querySelectorAll("#diagnosis-split > li")].map(text) : null,
      oldBlocks: ["result-clarity", "result-understood", "result-detail-open", "result-warnings-block", "result-departments-block"].map((id) => [id, drawn(id)]),
      headShown: drawn("result-head"),
      focused: document.activeElement?.id ?? null,
      isDiagnosisView: document.getElementById("result").classList.contains("is-diagnosis"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

async function scenarioDiagnosis(browser, { width, scheme }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  await watch(page, `diagnosis ${width}px ${scheme}`);
  const posts = await mockApi(page, {
    finalResult: (body) => ({ ...snapshot.final, reportId: REPORT_ID, glance: body.glance, clarity: YELLOW, diagnosis: DIAGNOSIS }),
    report: (posts) => storedReport(posts, posts.at(-1).glance, DIAGNOSIS),
  });
  await reachResult(page);
  await page.waitForFunction(() => document.getElementById("diagnosis-title").textContent === "Five checks on your idea");

  const view = await readDiagnosis(page);
  assert.equal(view.visible, true, "the diagnosis is shown");
  assert.equal(view.isDiagnosisView, true, "the result takes the diagnosis view");
  assert.equal(view.eyebrow, "Business analysis · Malasaña, Madrid", "the eyebrow names the location");
  assert.equal(view.title, "Five checks on your idea");
  assert.equal(view.idea, DIAGNOSIS.idea);
  assert.equal(view.focused, "diagnosis-title", "the title takes the focus when the diagnosis appears");
  assert.deepEqual(view.checks.map(({ name, state, symbol }) => [name, state, symbol]), [
    ["Concept", "Watch", "!"],
    ["Location", "Watch", "!"],
    ["Money", "Watch", "!"],
    ["Experience", "Strong", "✓"],
    ["Competition", "Risk", "✕"],
  ], "five checks, each with its word and symbol, in order");
  assert.deepEqual(view.checks.map(({ mark }) => mark), ["mark--watch", "mark--watch", "mark--watch", "mark--strong", "mark--risk"]);
  assert.deepEqual(view.checks.map(({ estimated }) => estimated), [true, true, true, false, true], "the estimate shows beside its reason");
  assert.equal(view.checks[4].why, DIAGNOSIS.checks[4].why);
  assert.deepEqual(view.risks, DIAGNOSIS.risks, "the three main risks");
  assert.deepEqual(view.plan, ["Mando builds: Online store", "You handle: Pick the menu and the suppliers"], "the empty line (hire out) is not shown");
  for (const [id, shownNow] of view.oldBlocks) assert.equal(shownNow, false, `${id} is not part of the diagnosis view`);
  assert.equal(view.headShown, false, "the old heading is not shown");
  assert.ok(view.overflow <= 0, `no horizontal scroll (${view.overflow}px)`);

  // Improve my report sits under the checks and opens the form that already exists
  await page.click("#result-improve-open");
  assert.equal(await page.isVisible("#result-quiz"), true, "the improve link opens the form");
  assert.ok((await page.$$("#result-quiz legend")).length > 0, "the form has its questions");
  await page.click("#result-quiz-cancel");

  assertNoProblems();
  await context.close();
  return `${width}px ${scheme}: five checks with symbols and words, risks, the plan lines, the improve form, focus and no problems`;
}

async function scenarioOldReport(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await watch(page, "old report");
  const { diagnosis: _diagnosis, ...finalWithoutDiagnosis } = snapshot.final;
  const posts = await mockApi(page, {
    finalResult: (body) => ({ ...finalWithoutDiagnosis, reportId: REPORT_ID, glance: body.glance, clarity: YELLOW }),
    report: (posts) => storedReport(posts, posts.at(-1).glance, undefined),
  });
  await reachResult(page);
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  const view = await readDiagnosis(page);
  assert.equal(view.visible, false, "a report without a diagnosis does not show it");
  assert.equal(view.isDiagnosisView, false);
  assert.equal(view.headShown, true, "the previous heading is shown");
  assert.equal(view.oldBlocks.find(([id]) => id === "result-detail-open")[1], true, "the previous view keeps its full detail");

  await page.reload();
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  assert.equal((await readDiagnosis(page)).visible, false, "after a reload, the same old view");
  assertNoProblems();
  await context.close();
  return "a report without a diagnosis keeps the previous view, also after a reload";
}

for (const scenario of [
  (b) => scenarioDiagnosis(b, { width: 1280, scheme: "light" }),
  (b) => scenarioDiagnosis(b, { width: 390, scheme: "dark" }),
  scenarioOldReport,
]) {
  try {
    console.log(`ok - ${await scenario(browser)}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${error.message}`);
  }
}

await browser.close();
server.kill();
if (failed) {
  console.error(`${failed} diagnosis-view check(s) failed`);
  process.exit(1);
}
