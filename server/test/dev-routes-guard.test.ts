/** devRoutesAllowed: the development routes answer only when ENABLE_DEV_ROUTES=1 and NODE_ENV is not production */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { devRoutesAllowed } from "../security.js";

describe("devRoutesAllowed in its four combinations", () => {
  const cases: [label: string, env: Record<string, string | undefined>, allowed: boolean][] = [
    ["ENABLE_DEV_ROUTES=1 and NODE_ENV unset", { ENABLE_DEV_ROUTES: "1" }, true],
    ["ENABLE_DEV_ROUTES=1 and NODE_ENV=development", { ENABLE_DEV_ROUTES: "1", NODE_ENV: "development" }, true],
    ["ENABLE_DEV_ROUTES=1 and NODE_ENV=production", { ENABLE_DEV_ROUTES: "1", NODE_ENV: "production" }, false],
    ["ENABLE_DEV_ROUTES unset and NODE_ENV=development", { NODE_ENV: "development" }, false],
    ["ENABLE_DEV_ROUTES=0", { ENABLE_DEV_ROUTES: "0" }, false],
    ["ENABLE_DEV_ROUTES=true (only the value 1 counts)", { ENABLE_DEV_ROUTES: "true" }, false],
    ["nothing set", {}, false],
  ];
  for (const [label, env, allowed] of cases) {
    test(label, () => {
      assert.equal(devRoutesAllowed(env), allowed);
    });
  }
});
