/**
 * The sign-in on the home page and the plan page, in Chromium, against a real server with a real database:
 * sign-up, a wrong sign-in, log out, log in again, a reload that keeps the session, and the send that asks for
 * a session. Needs TEST_DATABASE_URL (a migrated database; the tests make their own emails). Without it, the
 * check is skipped and says so. Screenshots go to SCREENSHOTS (or the system temp folder).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl) {
  console.log("skip - auth dialogs: TEST_DATABASE_URL is not set");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3979;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SCREENSHOTS ?? join(process.env.TMPDIR ?? "/tmp", "auth-shots");
mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "correct horse battery";
const stamp = Date.now();
const ana = { name: "Ana Test", email: `ana-${stamp}@example.test` };

function startServer() {
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: dbUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => String(chunk).includes("http://") && resolve(child));
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
}

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let passed = 0;
const check = (name, fn) => fn().then(() => { passed++; console.log(`ok - ${name}`); });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");

  await check("signed out: Log In and Register show, the profile circle does not", async () => {
    assert.equal(await page.locator("#nav-guest").isVisible(), true);
    assert.equal(await page.locator("#nav-user").isVisible(), false);
    await page.screenshot({ path: join(SHOTS, "1-home-signed-out.png") });
  });

  await check("the register dialog has no birth date, hides Google until it exists, and every field has a label", async () => {
    await page.click('#nav-guest [data-auth="register"]');
    assert.equal(await page.locator('input[name="birthdate"]').count(), 0);
    assert.equal(await page.locator("text=Sign up with Google").isVisible(), false, "Google is hidden until it exists");
    const unlabelled = await page.$$eval('#auth-modal input', (inputs) => inputs.filter((input) => input.labels.length === 0).length);
    assert.equal(unlabelled, 0);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#auth-modal", { state: "hidden" });
  });

  await check("sign-up: a new account is made, the dialog closes and the person is signed in at once", async () => {
    await page.click('#nav-guest [data-auth="register"]');
    const form = page.locator('form[data-form="register"]');
    await form.locator('input[name="name"]').fill(ana.name);
    await form.locator('input[name="email"]').fill(ana.email);
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.locator('input[name="password2"]').fill(PASSWORD);
    await form.locator('button[type="submit"]').click();
    await page.locator("#avatar").waitFor({ state: "visible" });
    assert.equal(await page.locator("#auth-modal").isVisible(), false);
  });

  await check("signed in after sign-up: the profile circle shows the first letter, the guest buttons go", async () => {
    assert.equal(await page.locator("#avatar").textContent(), "A");
    assert.equal(await page.locator("#nav-guest").isVisible(), false);
    await page.screenshot({ path: join(SHOTS, "4-home-signed-in.png") });
  });

  await check("a reload keeps the session", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator("#avatar").waitFor({ state: "visible" });
    assert.equal(await page.locator("#nav-guest").isVisible(), false);
    await page.screenshot({ path: join(SHOTS, "5-home-after-reload.png") });
  });

  await check("the profile menu: Escape closes it and gives the focus back to the circle", async () => {
    await page.click("#avatar");
    await page.locator("#logout").waitFor({ state: "visible" });
    await page.screenshot({ path: join(SHOTS, "3-logout-menu.png") });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#profile-menu").isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), "avatar");
  });

  await check("log out: the header goes back to the guest buttons, and the session is gone after a reload", async () => {
    await page.click("#avatar");
    await page.click("#logout");
    await page.locator("#nav-guest").waitFor({ state: "visible" });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator("#nav-guest").waitFor({ state: "visible" });
    assert.equal(await page.locator("#nav-user").isVisible(), false);
  });

  await check("log in: a wrong password shows the general message and clears the password, and Escape brings the focus back", async () => {
    await page.click('#nav-guest [data-auth="login"]');
    const form = page.locator('form[data-form="login"]');
    await form.locator('input[name="email"]').fill(ana.email);
    await form.locator('input[name="password"]').fill("wrong password here");
    await form.locator('button[type="submit"]').click();
    await form.locator(".auth__error").waitFor({ state: "visible" });
    assert.equal(await form.locator(".auth__error").textContent(), "The email or the password is not right.");
    assert.equal(await form.locator('input[name="password"]').inputValue(), "");
    assert.equal(await page.evaluate(() => document.activeElement.name), "password");
    await page.screenshot({ path: join(SHOTS, "2-login-wrong-password.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#auth-modal", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.auth), "login");
  });

  await check("log in with the right password: the dialog closes and the profile circle shows", async () => {
    await page.click('#nav-guest [data-auth="login"]');
    const form = page.locator('form[data-form="login"]');
    await form.locator('input[name="email"]').fill(ana.email);
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.locator('button[type="submit"]').click();
    await page.locator("#avatar").waitFor({ state: "visible" });
    assert.equal(await page.locator("#auth-modal").isVisible(), false);
  });

  await check("the plan page without a session says so, with a link to the start page", async () => {
    await page.click("#avatar");
    await page.click("#logout");
    await page.locator("#nav-guest").waitFor({ state: "visible" });
    await page.goto(`${BASE}/plan.html?id=00000000-0000-4000-8000-000000000000`);
    await page.waitForLoadState("networkidle");
    await page.locator("p.message__text", { hasText: "Log in to see your plan." }).waitFor({ state: "visible" });
    assert.equal(await page.locator('a[href="/"]').count(), 1);
    await page.screenshot({ path: join(SHOTS, "6-plan-signed-out.png") });
  });

  await check("the send without a session opens the log-in popup, and the idea stays", async () => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState("networkidle");
    await page.locator("#nav-guest").waitFor({ state: "visible" });
    await page.fill(".search__input", "A bakery that delivers bread");
    await page.click('.search button[type="submit"]');
    await page.locator("#gate-modal[open]").waitFor({ state: "visible" });
    assert.equal(await page.inputValue(".search__input"), "A bakery that delivers bread");
  });

  await check("sign-up with a used email: the message sits by the email field, the focus stays there, and Escape gives the focus back to Register", async () => {
    // The log-in popup of the last check is still open: it goes first. The page is signed out at this point.
    await page.keyboard.press("Escape");
    await page.locator("#gate-modal").waitFor({ state: "hidden" });
    await page.click('#nav-guest [data-auth="register"]');
    const form = page.locator('form[data-form="register"]');
    await form.locator('input[name="name"]').fill(ana.name);
    await form.locator('input[name="email"]').fill(ana.email);
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.locator('input[name="password2"]').fill(PASSWORD);
    await form.locator('button[type="submit"]').click();
    await form.locator('.auth__error').waitFor({ state: "visible" }).catch(() => {});
    const emailError = await page.locator('#auth-modal .field-error:not([hidden])').first().textContent();
    assert.equal(emailError, "An account with this email already exists.");
    assert.equal(await page.evaluate(() => document.activeElement.name), "email");
    await page.screenshot({ path: join(SHOTS, "7-register-email-taken.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#auth-modal", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.auth), "register");
  });

  await check("no uncaught error in the page", async () => {
    assert.deepEqual(pageErrors, []);
  });

  console.log(`\n${passed} checks passed. Screenshots in ${SHOTS}`);
} finally {
  await browser.close();
  server.kill();
}
