import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devRoutesAllowed, environmentProblem } from "../security.js";
import { handlePlanRequest } from "../plan-routes.js";
import { InMemoryPlanRepository } from "../plan/plan-repository-memory.js";

describe("the development routes never run in production", () => {
  test("ENABLE_DEV_ROUTES=1 with NODE_ENV=production is refused, with a clear message", () => {
    assert.equal(environmentProblem({ ENABLE_DEV_ROUTES: "1", NODE_ENV: "production" }), "The server does not start: ENABLE_DEV_ROUTES=1 is not allowed when NODE_ENV=production.");
  });

  test("the other combinations are allowed", () => {
    for (const env of [{}, { ENABLE_DEV_ROUTES: "1" }, { ENABLE_DEV_ROUTES: "1", NODE_ENV: "development" }, { NODE_ENV: "production" }, { ENABLE_DEV_ROUTES: "true", NODE_ENV: "production" }]) {
      assert.equal(environmentProblem(env), undefined, JSON.stringify(env));
    }
  });

  test("the dev routes answer only with the flag, and never with NODE_ENV=production", () => {
    assert.equal(devRoutesAllowed({ ENABLE_DEV_ROUTES: "1" }), true);
    assert.equal(devRoutesAllowed({}), false);
    assert.equal(devRoutesAllowed({ ENABLE_DEV_ROUTES: "1", NODE_ENV: "production" }), false);
  });

  test("a dev route with the flag and NODE_ENV=production is 404, even though the flag is set", async () => {
    const repo = new InMemoryPlanRepository();
    const response = await handlePlanRequest({
      method: "POST",
      path: "/api/dev/demo-plan",
      body: "",
      repo,
      reports: undefined,
      now: () => "2026-10-08T10:00:00Z",
      env: { ENABLE_DEV_ROUTES: "1", NODE_ENV: "production" },
    });
    assert.deepEqual(response, { status: 404, body: { error: "Not found" } });
  });

  test("the server does not start with both set: exit code 1 and the message, nothing listens", async () => {
    const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
      cwd: serverDir,
      env: { ...process.env, NODE_TEST_CONTEXT: "", ENABLE_DEV_ROUTES: "1", NODE_ENV: "production", PORT: "3991" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => (stdout += chunk));
    const code = await new Promise<number | null>((resolve) => child.on("exit", (exit) => resolve(exit)));
    assert.equal(code, 1);
    assert.ok(stderr.includes("ENABLE_DEV_ROUTES=1 is not allowed when NODE_ENV=production."), stderr);
    assert.equal(stdout.includes("http://localhost"), false, "it did not start listening");
  });
});
