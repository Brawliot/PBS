/**
 * The shared loader in Chromium: show(), hide() and show() in a row never leave two wordmarks in the page, whether
 * or not the first hide() has finished its fade. Run by npm run test:e2e. Needs Playwright (see build-my-plan.mjs).
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const PORT = 3978;
const BASE = `http://127.0.0.1:${PORT}`;

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

/** Runs one sequence of calls on the page and returns the most wordmarks seen at once, and the count at the end */
async function sequence(steps) {
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}/plan.html`);
    await page.waitForFunction(() => window.Loader && window.createTechText);
    await page.evaluate(() => {
      window.__most = 0;
      const count = () => document.querySelectorAll(".loader").length;
      new MutationObserver(() => (window.__most = Math.max(window.__most, count()))).observe(document.body, { childList: true, subtree: true });
    });
    for (const step of steps) {
      // hide() is not awaited: the page must go on while the loader fades, as the screens do
      if (step === "show") await page.evaluate(() => window.Loader.show());
      else if (step === "hide") await page.evaluate(() => void window.Loader.hide());
      else if (step.startsWith("wait")) await page.waitForTimeout(Number(step.slice(4)));
    }
    await page.waitForTimeout(700);
    return {
      most: await page.evaluate(() => window.__most),
      end: await page.evaluate(() => document.querySelectorAll(".loader").length),
    };
  } finally {
    await page.close();
  }
}

const SCENARIOS = [
  { name: "show, hide, show in a row", steps: ["show", "hide", "show"], most: 1, end: 1 },
  { name: "show, hide, wait 100 ms, show (the fade is still running)", steps: ["show", "hide", "wait100", "show"], most: 1, end: 1 },
  { name: "show, hide, wait for the fade, show", steps: ["show", "hide", "wait600", "show"], most: 1, end: 1 },
  { name: "show, hide, hide, show, show", steps: ["show", "hide", "hide", "show", "show"], most: 1, end: 1 },
];

try {
  for (const scenario of SCENARIOS) {
    try {
      const result = await sequence(scenario.steps);
      assert.equal(result.most, scenario.most, `most loaders at once: ${result.most}`);
      assert.equal(result.end, scenario.end, `loaders at the end: ${result.end}`);
      console.log("ok -", scenario.name);
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
