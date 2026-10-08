/**
 * The Decisions page in Chromium. The real server.ts serves the pages; the plan API is answered by
 * page.route with the real plan routes and an in-memory repository, so every decision goes through the
 * same rules as in production. Screenshots go to SCREENSHOTS (or the system temp folder if unset).
 *
 * Run: npm run test:e2e (from server/). Needs Playwright: PLAYWRIGHT_MODULE, and CHROMIUM_PATH if needed.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { handlePlanRequest } from "../../plan-routes.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { reportWith } from "../plan/report-fixtures.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3978;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SCREENSHOTS ?? join(process.env.TMPDIR ?? "/tmp", "plan-decisions-shots");
mkdirSync(SHOTS, { recursive: true });

function startServer(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 20_000);
    child.stdout!.on("data", (chunk) => {
      if (String(chunk).includes("http://localhost")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
}

/** A new plan from the rules, saved in the repository: the gap "Plan the product development" waits for product_type */
async function newPlan(repo: InMemoryPlanRepository): Promise<string> {
  const built = buildPlanSkeleton(reportWith());
  if (!built.ok) throw new Error("no plan");
  return (await repo.create("local", "Restaurante japonés", built.plan)).id;
}

/** Writes through the real routes, as another window would (used to make this one stale) */
async function write(repo: InMemoryPlanRepository, id: string, path: string, body: unknown) {
  const current = await repo.get(id, "local");
  return handlePlanRequest({
    method: "POST",
    path: `/api/plan/${id}${path}`,
    body: JSON.stringify({ ...(body as object), expectedVersion: current!.version }),
    repo,
    reports: undefined,
    now: () => "2026-10-08T10:00:00Z",
    env: {},
  });
}

/** Answers the plan API with the real routes; anything else (the pages, the scripts) goes to the server */
async function serveApi(repo: InMemoryPlanRepository, route: any) {
  const request = route.request();
  const result = await handlePlanRequest({
    method: request.method(),
    path: new URL(request.url()).pathname,
    body: request.postData() ?? "",
    repo,
    reports: undefined,
    now: () => new Date().toISOString(),
    env: {},
  });
  await route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
}

async function openPlan(browser: any, repo: InMemoryPlanRepository, id: string, hash: string, size = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  await page.route("**/api/plan/**", (route: any) => serveApi(repo, route));
  await page.goto(`${BASE}/plan.html?id=${id}${hash}`);
  await page.waitForSelector("#view h1");
  return { context, page };
}

/** The visible notice of the page (the success line, or an error), once it is there */
const notice = (page: any) => page.locator("#view > .notice").first();

async function scenarioDecisions(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const id = await newPlan(repo);
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "mobile_game" } });
  const { context, page } = await openPlan(browser, repo, id, "#/decisions");
  await page.screenshot({ path: join(SHOTS, "decisions-1280x720.png") });

  // 1. Confirm the waiting fact
  await page.locator("li[data-fact-id]", { hasText: "Product type: Mobile game" }).getByRole("button", { name: "Confirm" }).click();
  await notice(page).waitFor();
  assert.match(await notice(page).textContent() ?? "", /Saved\. The plan is at version 3\./);

  // 2. Add a decision: a free-text key and value, saved and confirmed at once
  await page.selectOption("#decision-key", "target_customer");
  await page.fill("#decision-value-text", "Households");
  await page.getByRole("button", { name: "Save and confirm" }).click();
  await page.locator("li[data-fact-id]", { hasText: "Target customer: Households" }).waitFor();

  // 3. Suggest the tasks for the gap, then accept them
  await page.locator('li[data-task-id="plan-product-development"]').getByRole("button", { name: "Suggest tasks" }).click();
  await page.waitForTimeout(1500);
  const suggestion = page.locator("article[data-proposal-id]");
  await suggestion.waitFor();
  assert.match(await suggestion.textContent() ?? "", /3 tasks and 6 steps/);
  await suggestion.getByRole("button", { name: "Accept" }).click();
  await page.locator("details.fold summary", { hasText: "Decided suggestions" }).waitFor();

  // The plan now has the tasks, with the fact they come from
  const stored = (await repo.get(id, "local"))!;
  assert.deepEqual(stored.plan.tasks.filter((task) => task.derivedFrom).map((task) => task.id), [
    "expand-mobile-game-design",
    "expand-mobile-game-prototype",
    "expand-mobile-game-publish",
  ]);
  assert.deepEqual(
    repo.rows.get(id)!.log.map((entry) => entry.kind),
    ["fact_proposed", "fact_confirmed", "fact_proposed", "fact_confirmed", "proposal_created", "proposal_accepted"],
  );
  await context.close();
  return "decisions: confirm, add, suggest and accept, with the log written";
}

async function scenarioNeedsAi(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const id = await newPlan(repo);
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "mobile_app" }, confirm: true });
  const { context, page } = await openPlan(browser, repo, id, "#/decisions");
  await page.locator('li[data-task-id="plan-product-development"]').getByRole("button", { name: "Suggest tasks" }).click();
  const error = page.locator("#view .notice--error");
  await error.waitFor();
  assert.equal((await error.textContent())?.trim(), "There is no ready-made suggestion for this decision yet.");
  assert.equal(await page.locator("article[data-proposal-id]").count(), 0);
  await context.close();
  return "needs_ai: the fixed notice, and no suggestion is listed";
}

async function scenarioStale(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const id = await newPlan(repo);
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "launch_channel" }, value: { kind: "other", text: "Shop" } });
  const { context, page } = await openPlan(browser, repo, id, "#/decisions");
  // Another window confirms a different fact after this page was loaded
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Families" }, confirm: true });
  await page.locator("li[data-fact-id]", { hasText: "Launch channel: Shop" }).getByRole("button", { name: "Confirm" }).click();
  await page.waitForSelector("#view .notice--error");
  assert.match(await page.locator("#view .notice--error").textContent() ?? "", /The plan changed in another window/);
  // The page reloaded the plan: the fact is still waiting, now with the other fact confirmed
  await page.locator("li[data-fact-id]", { hasText: "Launch channel: Shop" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Confirm", exact: true }).count(), 1);
  await context.close();
  return "stale version: 409 reloads the plan and says so";
}

async function scenarioError(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const id = await newPlan(repo);
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "launch_channel" }, value: { kind: "other", text: "Shop" } });
  const { context, page } = await openPlan(browser, repo, id, "#/decisions");
  await page.route("**/facts/*/confirm", (route: any) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Internal server error","code":"internal_error"}' }));
  await page.locator("li[data-fact-id]", { hasText: "Launch channel: Shop" }).getByRole("button", { name: "Confirm" }).click();
  await page.waitForSelector("#view .notice--error");
  assert.equal((await page.locator("#view .notice--error").textContent())?.trim(), "Something went wrong on the server. Try again.");
  await page.waitForFunction(() => !document.body.classList.contains("is-loading"));
  assert.equal(await page.evaluate(() => document.getElementById("view")!.inert), false);
  await context.close();
  return "error: a generic text, the loader goes, the page is usable";
}

async function scenarioScreens(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const id = await newPlan(repo);
  // A confirmed product type, a waiting fact, and a pending suggestion: every block of the page has content
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "mobile_game" }, confirm: true });
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Households" } });
  await write(repo, id, "/gaps/plan-product-development/proposal", {});
  for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 780 }]) {
    const tag = `${size.width}x${size.height}`;
    const overview = await openPlan(browser, repo, id, "#/", size);
    await overview.page.screenshot({ path: join(SHOTS, `overview-${tag}.png`) });
    await overview.context.close();

    const gap = await openPlan(browser, repo, id, `#/task/plan-product-development`, size);
    await gap.page.screenshot({ path: join(SHOTS, `gap-${tag}.png`) });
    await gap.context.close();

    const decisions = await openPlan(browser, repo, id, "#/decisions", size);
    await decisions.page.screenshot({ path: join(SHOTS, `decisions-${tag}.png`) });
    // The page scrolls inside #view: the lower part is shot after scrolling it
    // Wide screens scroll inside #view; phones scroll the whole page
    await decisions.page.evaluate(() => { document.getElementById("view")!.scrollTop = 99999; window.scrollTo(0, document.body.scrollHeight); });
    await decisions.page.screenshot({ path: join(SHOTS, `decisions-${tag}-bottom.png`) });
    await decisions.context.close();
  }
  return "screenshots written to " + SHOTS;
}

/** A suggestion made with mobile_game, then web_app confirmed: the suggestion is obsolete */
async function scenarioObsolete(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const id = await newPlan(repo);
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "mobile_game" }, confirm: true });
  await write(repo, id, "/gaps/plan-product-development/proposal", {});
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" }, confirm: true });

  const { context, page } = await openPlan(browser, repo, id, "#/decisions");
  const obsolete = page.locator("article[data-proposal-id]");
  await obsolete.waitFor();
  assert.match(await obsolete.textContent() ?? "", /This suggestion came from a decision that has changed\./);
  assert.equal(await obsolete.getByRole("button", { name: "Accept", exact: true }).count(), 0, "no Accept on an obsolete suggestion");
  await obsolete.screenshot({ path: join(SHOTS, "obsolete-suggestion-1280x720.png") });
  await page.setViewportSize({ width: 390, height: 780 });
  await obsolete.screenshot({ path: join(SHOTS, "obsolete-suggestion-390x780.png") });

  // The gap says why it cannot be suggested from now on
  await page.goto(`${BASE}/plan.html?id=${id}#/task/plan-product-development`);
  await page.waitForSelector("#view h1");
  const note = page.locator("#view .notice").first();
  assert.match(await note.textContent() ?? "", /came from a decision that has changed\. Reject it to suggest again\./);
  await page.screenshot({ path: join(SHOTS, "gap-obsolete-390x780.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: join(SHOTS, "gap-obsolete-1280x720.png") });

  // Rejected: the gap asks again, with the current value
  await page.goto(`${BASE}/plan.html?id=${id}#/decisions`);
  await page.locator("article[data-proposal-id]").getByRole("button", { name: "Reject" }).click();
  await page.locator("article[data-proposal-id]").waitFor({ state: "detached" });
  await page.locator('li[data-task-id="plan-product-development"]').getByRole("button", { name: "Suggest tasks" }).click();
  const fresh = page.locator("article[data-proposal-id]");
  await fresh.waitFor();
  assert.match(await fresh.textContent() ?? "", /Design the web app/);
  await fresh.getByRole("button", { name: "Accept", exact: true }).click();
  await page.locator("details.fold summary", { hasText: "Decided suggestions" }).waitFor();
  await context.close();
  return "obsolete: no Accept and its notice, reject, then suggest again with the current value";
}

/** Reject and suggest again with the same value, four times: nothing is left blocked */
async function scenarioCycle(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const id = await newPlan(repo);
  await write(repo, id, "/facts", { key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "mobile_game" }, confirm: true });
  const { context, page } = await openPlan(browser, repo, id, "#/decisions");
  const gap = page.locator('li[data-task-id="plan-product-development"]');
  for (let cycle = 1; cycle <= 4; cycle++) {
    await gap.getByRole("button", { name: "Suggest tasks" }).click();
    await page.locator("article[data-proposal-id]").waitFor();
    await page.locator("article[data-proposal-id]").getByRole("button", { name: "Reject" }).click();
    await page.locator("article[data-proposal-id]").waitFor({ state: "detached" });
  }
  await gap.getByRole("button", { name: "Suggest tasks" }).click();
  await page.locator("article[data-proposal-id]").getByRole("button", { name: "Accept", exact: true }).click();
  await page.locator("details.fold summary", { hasText: "Decided suggestions" }).waitFor();
  const stored = (await repo.get(id, "local"))!;
  // Four rejected suggestions took the plain id and -2, -3, -4: the fifth one is -5
  assert.ok(stored.plan.tasks.some((task) => task.id === "expand-mobile-game-5-design"), "the fifth suggestion was accepted");
  await context.close();
  return "cycle: reject and suggest again four times, then accept";
}

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let failed = 0;
try {
  for (const scenario of [scenarioDecisions, scenarioNeedsAi, scenarioStale, scenarioError, scenarioScreens, scenarioObsolete, scenarioCycle]) {
    try {
      console.log("ok -", await scenario(browser));
    } catch (error) {
      failed += 1;
      console.error("not ok -", scenario.name, (error as Error).message);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed > 0) process.exitCode = 1;
