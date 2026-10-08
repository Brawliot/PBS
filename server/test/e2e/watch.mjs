/**
 * Watches every page the e2e checks open: Content-Security-Policy violations, console errors and uncaught
 * errors (except the failures of the simulated API answers). The problems are collected for the whole run and checked once at the end (assertNoProblems).
 */

import assert from "node:assert/strict";

const problems = [];

/** Starts watching a page. Call it before the page navigates, so no violation is missed. */
export async function watch(page, label) {
  await page.exposeFunction("__reportProblem", (text) => problems.push(`${label}: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__reportProblem(`CSP ${event.violatedDirective} blocked ${event.blockedURI || "an inline item"}`);
    });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The planner and plan API answers are simulated by the checks, and some of them are failures on purpose
    if (message.location().url.includes("/api/")) return;
    problems.push(`${label}: console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`${label}: page error: ${error.name}`));
}

/** Fails the run if any watched page reported a problem */
export function assertNoProblems() {
  assert.deepEqual(problems, [], "no Content-Security-Policy violation and no console error on any page");
}
