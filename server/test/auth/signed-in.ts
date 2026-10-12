/**
 * For the tests of the server: the accounts and the sessions are kept in memory (useTestStores), and a user is
 * signed up through the real route, so the test gets a real session cookie. Import this before a test server
 * is started. The plans and the reports are in memory too (see `memory`).
 */

import { request } from "node:http";
import { InMemorySessionRepository } from "../../auth/session-repository-memory.js";
import { InMemoryUserRepository } from "../../user/user-repository-memory.js";
import { InMemoryPlanRepository } from "../../plan/plan-repository-memory.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { useTestStores } from "../../server.js";

/** The stores the test server uses: a test can look at them, and add plans or reports for a user */
export const memory = {
  users: new InMemoryUserRepository(),
  sessions: new InMemorySessionRepository(),
  plans: new InMemoryPlanRepository(),
  reports: new InMemoryReportRepository(),
};
useTestStores({
  auth: { users: memory.users, sessions: memory.sessions },
  plan: memory.plans,
  reports: memory.reports,
});

export const TEST_PASSWORD = "correct horse battery";

/** Signs up a new user through POST /api/auth/register and returns the cookie header to send back */
export function signUp(port: number, email = `user-${Math.random().toString(36).slice(2)}@example.test`, name = "Test User"): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ name, email, password: TEST_PASSWORD });
    const req = request(
      { host: "127.0.0.1", port, path: "/api/auth/register", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        res.resume();
        res.on("end", () => {
          const cookie = res.headers["set-cookie"]?.[0];
          if (res.statusCode !== 201 || !cookie) return reject(new Error(`sign-up failed: ${res.statusCode}`));
          resolve(cookie.split(";")[0]);
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
