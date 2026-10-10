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
// @ts-ignore: a plain module, shared with the other e2e script
import { watch, assertNoProblems } from "./watch.mjs";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { buildPlanSkeleton } from "../../plan/plan-skeleton.js";
import { reportWith } from "../plan/report-fixtures.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import type { AgentDeps } from "../../plan/agents/contract.js";
import type { Plan } from "../../plan/plan-model.js";
import { FakeJudge, FakeModel, planWithFact } from "../plan/agents/fakes.js";

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
async function serveApi(repo: InMemoryPlanRepository, route: any, ai?: Ai) {
  const request = route.request();
  const result = await handlePlanRequest({
    method: request.method(),
    path: new URL(request.url()).pathname,
    body: request.postData() ?? "",
    repo,
    reports: ai?.reports,
    agents: ai?.agents,
    now: () => new Date().toISOString(),
    env: {},
  });
  await route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
}

/** The report and the assistant of the plan level, for the scenarios that use them (the others have none) */
interface Ai {
  reports: InMemoryReportRepository;
  agents: AgentDeps;
}

async function openPlan(browser: any, repo: InMemoryPlanRepository, id: string, hash: string, size = { width: 1280, height: 720 }, ai?: Ai) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  await watch(page, `plan page ${hash}`);
  await page.route("**/api/plan/**", (route: any) => serveApi(repo, route, ai));
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

    // The timeline draws its bars with style values: it must load under the Content-Security-Policy too
    const timeline = await openPlan(browser, repo, id, "#/timeline", size);
    await timeline.page.waitForSelector(".bar");
    await timeline.context.close();

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
  assert.equal(await obsolete.locator(".badge", { hasText: "Obsolete" }).count(), 1, "the obsolete label");
  assert.equal(await obsolete.getByRole("button", { name: "Accept", exact: true }).count(), 0, "no Accept on an obsolete suggestion");
  assert.equal(await obsolete.getByRole("button", { name: "Reject", exact: true }).count(), 0, "no Reject on an obsolete suggestion");
  assert.equal(await obsolete.getByRole("button", { name: "Retire", exact: true }).count(), 1, "Retire on an obsolete suggestion");
  await obsolete.screenshot({ path: join(SHOTS, "obsolete-suggestion-1280x720.png") });
  await page.setViewportSize({ width: 390, height: 780 });
  await obsolete.screenshot({ path: join(SHOTS, "obsolete-suggestion-390x780.png") });

  // The gap says why it cannot be suggested from now on
  await page.goto(`${BASE}/plan.html?id=${id}#/task/plan-product-development`);
  await page.waitForSelector("#view h1");
  const note = page.locator("#view .notice").first();
  assert.match(await note.textContent() ?? "", /came from a decision that has changed\. Retire it to suggest again\./);
  await page.screenshot({ path: join(SHOTS, "gap-obsolete-390x780.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: join(SHOTS, "gap-obsolete-1280x720.png") });

  // Rejected: the gap asks again, with the current value
  await page.goto(`${BASE}/plan.html?id=${id}#/decisions`);
  await page.locator("article[data-proposal-id]").getByRole("button", { name: "Retire", exact: true }).click();
  await page.locator("article[data-proposal-id]").waitFor({ state: "detached" });
  await page.locator('li[data-task-id="plan-product-development"]').getByRole("button", { name: "Suggest tasks" }).click();
  const fresh = page.locator("article[data-proposal-id]");
  await fresh.waitFor();
  assert.match(await fresh.textContent() ?? "", /Design the web app/);
  await fresh.getByRole("button", { name: "Accept", exact: true }).click();
  await page.locator("details.fold summary", { hasText: "Decided suggestions" }).waitFor();
  await context.close();
  return "obsolete: label, no Accept or Reject, Retire, then suggest again with the current value";
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

/** A plan made from a report, so the assistant has its idea; the answer is built from the plan's own departments and phases */
async function planWithReport(repo: InMemoryPlanRepository): Promise<{ id: string; ai: Ai; model: FakeModel }> {
  const id = await newPlan(repo);
  const reports = new InMemoryReportRepository();
  const reportId = await reports.create("local", reportWith());
  await reports.attachPlan(reportId, "local", id);
  const answer = (plan: Plan) => {
    const [first, second] = plan.departments;
    return {
      // The first phase is renamed, so the accepted structure is visible on the other pages
      phases: plan.phases.map((phase, index) => (index === 0 ? { ...phase, name: "Launch preparation" } : phase)),
      // Light, not core: the first department starts as core in the skeleton, so the change must be visible
      tiers: [{ departmentId: first.id, tier: "light" }],
      relations: second ? [{ level: "department", from: first.id, to: second.id, type: "blocks", aspect: { kind: "catalog", id: "budget" } }] : [],
      facts: [{ key: { kind: "catalog", id: "launch_channel" }, value: { kind: "other", text: "Delivery app" } }],
      requests: [{ to: "plan", text: "Confirm the opening date" }],
      questions: ["Do you want delivery?"],
    };
  };
  const plan = (await repo.get(id, "local"))!.plan;
  const model = new FakeModel([answer(plan)]);
  return { id, ai: { reports, agents: { model, judge: new FakeJudge([true]) } }, model };
}

async function scenarioStructure(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const { id, ai, model } = await planWithReport(repo);
  const before = (await repo.get(id, "local"))!;
  const { context, page } = await openPlan(browser, repo, id, "#/decisions", undefined, ai);

  // The suggestion is asked for by the button, and only then
  assert.equal(model.requests.length, 0, "nothing is asked when the page opens");
  await page.getByRole("button", { name: "Suggest plan structure" }).click();
  const card = page.locator("article[data-structure]");
  await card.waitFor();
  const text = (await card.textContent()) ?? "";
  assert.match(text, /Launch preparation/);
  assert.match(text, /Legal & Compliance: .* to Light/);
  await card.screenshot({ path: join(SHOTS, "structure-card.png") });

  // The facts it found wait in the list of facts to confirm, as the assistant's
  const fact = page.locator("li[data-fact-id]", { hasText: "Launch channel: Delivery app" });
  await fact.waitFor();
  assert.match((await fact.textContent()) ?? "", /Suggested by the assistant/);

  // A second suggestion is not offered while this one waits
  assert.equal(await page.getByRole("button", { name: "Suggest plan structure" }).count(), 0);

  // Accepting it changes the phases and the tiers, on the plan page
  await card.getByRole("button", { name: "Accept" }).click();
  await card.waitFor({ state: "detached" });
  const after = (await repo.get(id, "local"))!;
  assert.equal(after.plan.phases[0].name, "Launch preparation");
  assert.equal(after.plan.departments.find((department) => department.id === before.plan.departments[0].id)?.tier, "light");
  // The other pages show the accepted phases too
  await page.goto(`${BASE}/plan.html?id=${id}#/timeline`);
  await page.getByText("Launch preparation").first().waitFor();
  await context.close();
  return "structure: suggest, see the card and the fact, accept, and the phases and tiers change";
}

async function scenarioStructureFailure(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const { id, ai } = await planWithReport(repo);
  // The assistant fails on every try: the screen says so and nothing is saved
  ai.agents.model = new FakeModel([new Error("provider down")]);
  const version = (await repo.get(id, "local"))!.version;
  const { context, page } = await openPlan(browser, repo, id, "#/decisions", undefined, ai);
  await page.getByRole("button", { name: "Suggest plan structure" }).click();
  await notice(page).waitFor();
  assert.match((await notice(page).textContent()) ?? "", /The assistant is not available right now/);
  assert.equal(await page.locator("article[data-structure]").count(), 0, "no card is shown");
  assert.equal((await repo.get(id, "local"))!.version, version, "nothing is saved");
  await context.close();
  return "structure failure: the assistant fails after its tries, the screen says so, nothing is saved";
}

/** A model that answers from its role, for the scenarios where several departments are asked at once */
class RoleModel {
  readonly roles: string[] = [];
  constructor(private readonly answer: (role: string) => unknown) {}
  async complete(request: { role: string }): Promise<unknown> {
    this.roles.push(request.role);
    const answer = this.answer(request.role);
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  }
}

/** A plan with a confirmed decision (the assistant builds on it), and an assistant that answers by role */
async function planForDepartments(repo: InMemoryPlanRepository, answer: (role: string, plan: Plan, factId: string) => unknown) {
  const { id, ai } = await planWithReport(repo);
  const at = (await repo.get(id, "local"))!.version;
  const confirmed = await handlePlanRequest({
    method: "POST",
    path: `/api/plan/${id}/facts`,
    body: JSON.stringify({ key: { kind: "catalog", id: "product_type" }, value: { kind: "catalog", id: "web_app" }, confirm: true, expectedVersion: at }),
    repo,
    reports: ai.reports,
    now: () => new Date().toISOString(),
    env: {},
  });
  assert.equal(confirmed.status, 201);
  const stored = (await repo.get(id, "local"))!;
  const factId = stored.plan.facts!.find((fact) => fact.status === "confirmed")!.id;
  const model = new RoleModel((role) => answer(role, stored.plan, factId));
  ai.agents.model = model;
  return { id, ai, model, plan: stored.plan };
}

/** One task per department, cited on the confirmed fact; the review sees all of them clash on the budget */
function departmentAnswer(role: string, plan: Plan, factId: string): unknown {
  if (role === "plan_review") {
    return {
      findings: [{ kind: "clash", taskIds: plan.departments.map((department) => `${department.id}-scope`), text: "Both departments plan the same budget" }],
      adjustments: [],
      facts: [],
      requests: [],
      questions: [],
    };
  }
  const department = plan.departments.find((candidate) => `department_${candidate.id}` === role)!;
  return {
    tasks: [{ id: `${department.id}-scope`, phaseId: plan.phases[0].id, title: `Scope of ${department.name}`, derivedFrom: [factId] }],
    relations: [],
    facts: [],
    requests: department.id === plan.departments[0].id ? [{ to: "plan", text: "Confirm the opening date" }] : [],
    questions: [],
  };
}

async function scenarioDepartments(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const { id, ai, model, plan } = await planForDepartments(repo, departmentAnswer);
  const { context, page } = await openPlan(browser, repo, id, "#/decisions", undefined, ai);

  // Asked by the button only, never when the page opens
  assert.equal(model.roles.length, 0, "nothing is asked when the page opens");
  await page.getByRole("button", { name: "Suggest tasks for all departments" }).click();
  const cards = page.locator("article[data-department-id]");
  await cards.first().waitFor();
  assert.equal(await cards.count(), plan.departments.length, "one card per department");
  const first = plan.departments[0];
  const card = page.locator(`article[data-department-id="${first.id}"]`);
  const text = (await card.textContent()) ?? "";
  assert.ok(text.includes(`Scope of ${first.name}`), "the card has the task");
  assert.ok(text.includes("clash: Both departments plan the same budget"), "the review's finding is a note of the card");
  await card.screenshot({ path: join(SHOTS, "departments-card.png") });

  // Accepting one card: its task shows on its department page, and the task has no steps yet
  await card.getByRole("button", { name: "Accept" }).click();
  await card.waitFor({ state: "detached" });
  await page.goto(`${BASE}/plan.html?id=${id}#/dept/${first.id}`);
  await page.getByText(`Scope of ${first.name}`).first().waitFor();
  await page.screenshot({ path: join(SHOTS, "department-after-accept.png") });
  await page.goto(`${BASE}/plan.html?id=${id}#/task/${encodeURIComponent(`${first.id}-scope`)}`);
  await page.getByText("This task has no steps.").waitFor();
  await page.screenshot({ path: join(SHOTS, "task-after-accept.png") });
  const stored = (await repo.get(id, "local"))!;
  assert.ok(stored.plan.tasks.some((task) => task.id === `${first.id}-scope`), "the accepted task is in the plan");
  await context.close();
  return "departments: asked by the button, one card per department, accepted, the task shows with no steps";
}

/** As departmentAnswer, but the first department's new task comes before a task it already has */
function departmentRelationAnswer(role: string, plan: Plan, factId: string): unknown {
  const answer = departmentAnswer(role, plan, factId) as { relations: unknown[] };
  const first = plan.departments[0];
  if (role !== `department_${first.id}`) return answer;
  const own = plan.tasks.find((task) => task.primaryDepartmentId === first.id);
  assert.ok(own, "the first department has a task of its own");
  return { ...answer, relations: [{ from: `${first.id}-scope`, to: own.id, type: "blocks" }] };
}

async function scenarioDepartmentRelation(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const { id, ai, plan } = await planForDepartments(repo, departmentRelationAnswer);
  const { context, page } = await openPlan(browser, repo, id, "#/decisions", undefined, ai);
  await page.getByRole("button", { name: "Suggest tasks for all departments" }).click();

  // The order names the new task and the task the department already has: both titles, never an id
  const first = plan.departments[0];
  const own = plan.tasks.find((task) => task.primaryDepartmentId === first.id)!;
  const card = page.locator(`article[data-department-id="${first.id}"]`);
  await card.waitFor();
  const text = (await card.textContent()) ?? "";
  assert.ok(text.includes(`Scope of ${first.name} must be done before ${own.title}`), "the order shows both titles");
  assert.ok(!text.includes("undefined") && !text.includes(own.id), "no raw id and no undefined in the card");
  await card.screenshot({ path: join(SHOTS, "departments-relation-to-existing-card.png") });

  // Accepting keeps the relation in the plan
  await card.getByRole("button", { name: "Accept" }).click();
  await card.waitFor({ state: "detached" });
  const stored = (await repo.get(id, "local"))!;
  assert.ok(
    stored.plan.relations.some((relation) => relation.level === "task" && relation.from === `${first.id}-scope` && relation.to === own.id),
    "the accepted relation is in the plan",
  );
  await context.close();
  return "departments: a new task before a task the department already has shows both titles, and is kept on accept";
}

async function scenarioDepartmentsFailure(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  // The second department fails on every try: the screen says so, and nothing of the others is kept
  const { id, ai } = await planForDepartments(repo, (role, plan, factId) =>
    role === `department_${plan.departments[1].id}` ? new Error("provider down") : departmentAnswer(role, plan, factId),
  );
  const version = (await repo.get(id, "local"))!.version;
  const { context, page } = await openPlan(browser, repo, id, "#/decisions", undefined, ai);
  await page.getByRole("button", { name: "Suggest tasks for all departments" }).click();
  await notice(page).waitFor();
  assert.match((await notice(page).textContent()) ?? "", /The assistant is not available right now/);
  assert.equal(await page.locator("article[data-department-id]").count(), 0, "no card is shown");
  assert.equal((await repo.get(id, "local"))!.version, version, "nothing is saved");
  await context.close();
  return "departments failure: one department fails after its tries, the screen says so, nothing is saved";
}

/** Waits until the notice of the page matches: the answer of the last request, not the notice before it */
const noticeSays = (page: any, text: RegExp) =>
  page.waitForFunction((source: string) => new RegExp(source).test(document.querySelector("#view > .notice")?.textContent ?? ""), text.source);

/** A stored plan with the report that holds its idea (so the assistant can work on it), and an assistant to set by the scenario */
async function storedWithReport(repo: InMemoryPlanRepository, plan: Plan): Promise<{ id: string; ai: Ai }> {
  const stored = await repo.create("local", "Restaurante japonés", plan);
  const reports = new InMemoryReportRepository();
  const reportId = await reports.create("local", reportWith());
  await reports.attachPlan(reportId, "local", stored.id);
  return { id: stored.id, ai: { reports, agents: { model: new RoleModel(() => new Error("not set")), judge: new FakeJudge([true]) } } };
}

/** The restaurant plan with one confirmed decision and no steps: every task is free for the assistant to plan */
const withoutSteps = (): Plan => {
  const { plan } = planWithFact();
  return { ...plan, steps: [], relations: plan.relations.filter((relation) => relation.level !== "step") };
};

/** The steps the assistant proposes for the task "Opening": one AI step, one step of the person, and the order between them */
const openingSteps = (factId: string) => ({
  steps: [
    { id: "t-opening-rent", text: "Compare the rent of three streets", executor: "ai", evidence: "accepted_output", effortHours: 2, waitDays: 0, derivedFrom: [factId] },
    { id: "t-opening-lease", text: "Sign the lease", executor: "user", mode: "in_person", evidence: "written_confirmation", effortHours: 1, waitDays: 7, derivedFrom: [factId] },
  ],
  relations: [{ from: "t-opening-rent", to: "t-opening-lease", type: "blocks" }],
  facts: [],
  requests: [],
  questions: [],
});

/** One round of the step "Viability": a summary and a document (with markup, which must show as text), a question, a request */
const viabilityRound = (round: number) => ({
  summary: `Summary of round ${round}`,
  document: round === 1 ? "<script>window.__hacked = true</script> <b>bold?</b>\nSecond line of the document" : `Document of round ${round}`,
  questions: ["Which city?"],
  facts: [{ key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Local families" } }],
  requests: [{ to: "plan", text: "Confirm the opening date" }],
});

async function scenarioTaskSteps(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const { id, ai } = await storedWithReport(repo, withoutSteps());
  const assistant = new RoleModel((role) => (role === "task_steps" ? openingSteps("fact-product_type") : new Error(`not asked: ${role}`)));
  ai.agents.model = assistant;
  const { context, page } = await openPlan(browser, repo, id, "#/task/t-opening", { width: 1280, height: 720 }, ai);
  assert.equal(assistant.roles.length, 0, "nothing is asked when the task opens");
  await page.screenshot({ path: join(SHOTS, "task-without-steps-1280x720.png") });

  // 1. Suggest the steps: one call, then the suggestion waits in Decisions and the task points to it
  await page.getByRole("button", { name: "Suggest steps" }).click();
  await noticeSays(page, /Saved\. The plan is at version 2\./);
  assert.match((await notice(page).textContent()) ?? "", /Saved\. The plan is at version 2\./);
  assert.deepEqual(assistant.roles, ["task_steps"]);
  assert.equal(await page.getByRole("button", { name: "Suggest steps" }).count(), 0, "no second suggestion while one waits");
  await page.getByRole("link", { name: "Go to decisions" }).click();

  // 2. The card of the decisions page: who does each step, and the order in plain words
  const card = page.locator('article[data-proposal-id]', { hasText: "Steps for Opening" });
  await card.waitFor();
  await card.screenshot({ path: join(SHOTS, "decisions-steps-card-1280x720.png") });
  const text = (await card.textContent()) ?? "";
  assert.match(text, /Compare the rent of three streets/);
  assert.match(text, /AI assistant/);
  assert.match(text, /You, In person/);
  assert.match(text, /Compare the rent of three streets must be done before Sign the lease/);

  // 3. Accept: the steps are in the task now
  await card.getByRole("button", { name: "Accept" }).click();
  await noticeSays(page, /Saved\. The plan is at version 3\./);
  assert.match((await notice(page).textContent()) ?? "", /Saved\. The plan is at version 3\./);
  await page.evaluate(() => (location.hash = "#/task/t-opening"));
  await page.locator('article[data-step-id="t-opening-rent"]').waitFor();
  assert.equal(await page.getByText("This task has no steps.").count(), 0);
  await page.screenshot({ path: join(SHOTS, "task-with-steps-1280x720.png") });
  await context.close();
  return "task steps: suggested on demand, decided in Decisions, then shown in the task";
}

async function scenarioAiStep(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const { id, ai } = await storedWithReport(repo, planWithFact().plan);
  let rounds = 0;
  const assistant = new RoleModel((role) => (role === "step_run" ? viabilityRound(++rounds) : new Error(`not asked: ${role}`)));
  ai.agents.model = assistant;
  const { context, page } = await openPlan(browser, repo, id, "#/task/t-viability", { width: 1280, height: 720 }, ai);
  const step = page.locator('article[data-step-id="s-viability"]');
  assert.equal(assistant.roles.length, 0, "nothing is asked when the task opens");

  // 1. Start: the server applies the start and runs the assistant in one request; the output shows, document as text
  await step.getByRole("button", { name: "Start" }).click();
  await step.locator("pre.document").waitFor();
  assert.equal(assistant.roles.length, 1);
  assert.equal((await step.locator("pre.document").textContent()) ?? "", viabilityRound(1).document);
  assert.equal(await page.locator("#view script").count(), 0, "a document is never run as a script");
  assert.equal(await page.locator("#view b").count(), 0, "a document is never read as markup");
  assert.match((await notice(page).textContent()) ?? "", /Saved\. The plan is at version 2\./);
  await step.screenshot({ path: join(SHOTS, "ai-step-round-1-card-1280x720.png") });

  // 2. Answer the question: round 2 (the first output keeps its summary, but not its document)
  await page.fill("#s-viability-answer-0", "Milan");
  await step.getByRole("button", { name: "Send answers" }).click();
  await step.getByText("Summary of round 2").waitFor();
  assert.equal(await step.locator("pre.document").count(), 1, "only the latest version keeps its document");
  assert.match((await notice(page).textContent()) ?? "", /Saved\. The plan is at version 3\./);
  assert.equal(assistant.roles.length, 2);

  // 3. Round 3: the last one. Its answers are asked, and after it no more answers are offered (the rules have no round left)
  await page.fill("#s-viability-answer-0", "Porto");
  await step.getByRole("button", { name: "Send answers" }).click();
  await step.getByText("Summary of round 3").waitFor();
  assert.equal(await step.locator("#s-viability-answer-0").count(), 0, "no answer form once the rounds are used");
  assert.equal(assistant.roles.length, 3);
  assert.match((await notice(page).textContent()) ?? "", /Saved\. The plan is at version 4\./);
  await step.screenshot({ path: join(SHOTS, "ai-step-rounds-used-card-1280x720.png") });

  // 4. Confirm the latest output: the person decides, and the step is done
  await step.getByRole("button", { name: "Confirm output" }).click();
  await noticeSays(page, /Saved\. The plan is at version 5\./);
  assert.match((await notice(page).textContent()) ?? "", /Saved\. The plan is at version 5\./);

  // 5. The fact the assistant proposed is waiting in Decisions, with the step as its origin
  await page.evaluate(() => (location.hash = "#/decisions"));
  await page.locator("li[data-fact-id]", { hasText: "Local families" }).waitFor();
  assert.equal(await page.locator("li[data-fact-id]", { hasText: "Local families" }).count(), 1, "the same fact is not proposed twice");
  await context.close();
  return "ai step: start, output with its document as text, two answers, no answer form after the third round, confirm, its fact in Decisions";
}

async function scenarioAiStepFailure(browser: any): Promise<string> {
  const repo = new InMemoryPlanRepository();
  const { id, ai } = await storedWithReport(repo, planWithFact().plan);
  let calls = 0;
  // The first start works; from the second round on the assistant is down
  ai.agents.model = new RoleModel((role) => (role !== "step_run" ? new Error("not asked") : ++calls === 1 ? viabilityRound(1) : new Error("provider down")));
  const { context, page } = await openPlan(browser, repo, id, "#/task/t-viability", { width: 1280, height: 720 }, ai);
  const step = page.locator('article[data-step-id="s-viability"]');

  await step.getByRole("button", { name: "Start" }).click();
  await step.locator("pre.document").waitFor();
  await page.fill("#s-viability-answer-0", "Milan, with a long answer that must survive the failure");
  await step.getByRole("button", { name: "Send answers" }).click();
  await noticeSays(page, /The assistant is not available right now/);
  assert.equal(((await notice(page).textContent()) ?? "").trim(), "The assistant is not available right now. Try again later.");
  assert.equal(await page.locator('#view > .notice--error').count(), 1, "the error is shown as an error");
  assert.equal(await page.inputValue("#s-viability-answer-0"), "Milan, with a long answer that must survive the failure", "the typed answer is kept");
  // The step is as it was before the send: waiting for the person, one output, nothing running
  assert.match((await step.textContent()) ?? "", /Waiting for you/);
  assert.equal(await step.getByText("The assistant is working...").count(), 0);
  assert.equal(await step.locator("pre.document").count(), 1);
  await page.screenshot({ path: join(SHOTS, "ai-step-failure-1280x720.png") });
  await context.close();

  // A start that fails leaves the step not started, with nothing added
  const other = new InMemoryPlanRepository();
  const second = await storedWithReport(other, planWithFact().plan);
  second.ai.agents.model = new RoleModel(() => new Error("provider down"));
  const failed = await openPlan(browser, other, second.id, "#/task/t-viability", { width: 1280, height: 720 }, second.ai);
  await failed.page.locator('article[data-step-id="s-viability"]').getByRole("button", { name: "Start" }).click();
  await noticeSays(failed.page, /The assistant is not available right now/);
  assert.equal(((await notice(failed.page).textContent()) ?? "").trim(), "The assistant is not available right now. Try again later.");
  assert.equal(await failed.page.locator('article[data-step-id="s-viability"]').getByText("Not started").count(), 1);
  assert.equal(await failed.page.locator('article[data-step-id="s-viability"] pre.document').count(), 0);
  await failed.context.close();
  return "ai step failure: the step stays as it was, the typed answer stays, the error shows";
}

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let failed = 0;
try {
  for (const scenario of [scenarioDecisions, scenarioNeedsAi, scenarioStale, scenarioError, scenarioScreens, scenarioObsolete, scenarioCycle, scenarioStructure, scenarioStructureFailure, scenarioDepartments, scenarioDepartmentRelation, scenarioDepartmentsFailure, scenarioTaskSteps, scenarioAiStep, scenarioAiStepFailure]) {
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
try {
  assertNoProblems();
} catch (error) {
  failed += 1;
  console.error("not ok - security watch:", (error as Error).message);
}
if (failed > 0) process.exitCode = 1;
