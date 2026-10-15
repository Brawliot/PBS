/**
 * "Improve my report" on a report with a diagnosis, in Chromium: a report whose concept is at risk and money at
 * watch asks about those two, concept first; the options are buttons, one answer per question; and the update sends
 * the answers to the planner under their question keys. The questions are the server's own (the fixture's "improve"
 * case, from diagnosis-cases.gen.ts). The planner's and the report's answers are simulated by page.route.
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
const fixture = JSON.parse(readFileSync(join(here, "fixtures/diagnosis-cases.json"), "utf8")).improve;

const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_ID = "77777777-7777-4777-8777-777777777777";
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
process.on("exit", () => server.kill());
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });

async function mockApi(page) {
  const posts = [];
  await page.route("**/api/auth/session", (route) => route.fulfill(json(200, { user: { name: "Ana" } })));
  await page.route("**/api/planner", (route) => {
    posts.push(JSON.parse(route.request().postData() ?? "null"));
    return route.fulfill(json(202, { jobId: JOB_ID.slice(0, -1) + posts.length }));
  });
  await page.route("**/api/planner/*", (route) => {
    const number = Number(route.request().url().slice(-1));
    return route.fulfill(json(200, { status: "done", result: number === 1 ? fixture.firstRound : fixture.final }));
  });
  await page.route("**/api/plan/**", (route) => route.fulfill(json(404, { error: "Plan not found", code: "not_found" })));
  await page.route("**/api/reports/**", (route) => route.fulfill(json(404, { error: "Report not found", code: "not_found" })));
  await page.route(`**/api/reports/${fixture.final.reportId}`, (route) => route.fulfill(json(200, { id: fixture.final.reportId, report: fixture.report, planId: null })));
  // The server's questions for this report. Registered last, so it answers before the catch-all above.
  await page.route(`**/api/reports/${fixture.final.reportId}/improve-questions`, (route) => route.fulfill(json(200, { questions: fixture.improve })));
  await page.route("**/api/planner/detect", (route) => route.fulfill(json(200, { detected: fixture.detect, jevToken: null })));
  return posts;
}

async function reachResult(page) {
  await page.goto(`${BASE}/`);
  await page.fill(".search__input", fixture.input.idea);
  await page.click(".search__submit");
  for (let guard = 0; guard < 6; guard += 1) {
    await page.waitForFunction(
      () => document.getElementById("question").classList.contains("is-open")
        || !document.getElementById("review").hidden
        || !document.getElementById("result").hidden,
      null,
      { timeout: 20_000 },
    );
    if (!(await page.isVisible("#question"))) break;
    if (await page.$(".question__option")) {
      await page.click(".question__option >> nth=0");
      await page.click(".question__submit");
    } else {
      await page.fill(".question__input", "40000");
      await page.press(".question__input", "Enter");
    }
    await page.waitForTimeout(150);
  }
  await page.waitForSelector("#review:not([hidden]), #result:not([hidden])", { timeout: 20_000 });
  if (await page.isVisible("#review")) await page.click("#review-generate");
  await page.waitForSelector("#result:not([hidden])", { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById("diagnosis-title").textContent === "Five checks on your idea");
}

async function scenario() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await watch(page, "improve questions");
  const posts = await mockApi(page);
  await reachResult(page);

  // The link shows once the server's questions are in
  await page.waitForFunction(() => !document.getElementById("result-improve").hidden, null, { timeout: 20_000 });
  assert.match(await page.textContent("#result-improve-text"), /^\d+ quick questions|^1 quick question/);

  await page.click("#result-improve-open");
  const legends = await page.$$eval("#result-quiz .quiz__item legend", (items) => items.map((item) => item.textContent));
  assert.deepEqual(legends, fixture.improve.map(({ question }) => question), "the server's questions, in the server's order");
  assert.equal(legends[0], "What will make you different?", "the concept at risk is asked first");
  const groups = await page.$$eval("#result-quiz .quiz__group", (items) => items.map((item) => item.textContent));
  assert.equal(groups[0], "Concept · ✕ Risk", "each group says its check and its state");
  assert.ok(groups.some((text) => text.startsWith("Money · !")), "money at watch is in the questions");

  // One option each: the button is pressed and the answer is the option's text
  const chosen = [];
  for (const item of fixture.improve.slice(0, 2)) {
    const label = item.options.find((option) => !option.startsWith("I don't know")) ?? item.options[0];
    chosen.push({ key: item.key, label });
    await page.click(`#result-quiz .quiz__item:has(legend:text-is("${item.question}")) .quiz__opts button:text-is("${label}")`);
    assert.equal(
      await page.getAttribute(`#result-quiz .quiz__item:has(legend:text-is("${item.question}")) .quiz__opts button:text-is("${label}")`, "aria-pressed"),
      "true",
    );
  }
  await page.click("#result-quiz-send");
  await page.waitForFunction(() => document.getElementById("result-quiz").hidden, null, { timeout: 20_000 });

  // The update sends the answers under their question keys, and the report is shown again
  const sent = posts.at(-1).answers.filter(({ topic }) => topic.startsWith("imp_"));
  assert.deepEqual(sent.map(({ topic, answer }) => [topic, answer]), chosen.map(({ key, label }) => [key, label]), "the answers go to the update under their keys");
  assertNoProblems();
  await context.close();
  return "the risk first, the options as buttons, and the answers sent under their keys";
}

try {
  console.log(`ok - ${await scenario()}`);
} catch (error) {
  console.error(`not ok - ${error.message}`);
  await browser.close();
  server.kill();
  process.exit(1);
}
await browser.close();
server.kill();
