# MANDO

MANDO helps you plan a business. Describe your idea, set four sliders (budget, years of experience, team size, weekly hours), answer a few follow-up questions, and get a report with a business profile and the departments the business is likely to need.

The user flow is: idea and sliders -> follow-up questions (one at a time) -> report.

## Requirements

- Node.js 22 or later
- A Typesafe API key (Jev analysis) and an OpenAI API key

## Quick start

Windows PowerShell:

```powershell
cd server
npm install
Copy-Item .env.example .env
# edit server\.env and fill in TYPESAFE_API_KEY and OPENAI_API_KEY
npm run dev
```

bash:

```bash
cd server
npm install
cp .env.example .env
# edit server/.env and fill in TYPESAFE_API_KEY and OPENAI_API_KEY
npm run dev
```

Then open `http://localhost:3000/`.

## Configuration

Read from the environment in `server/.env` (loaded by `--env-file=.env`).

| Variable | Required | Used in | Purpose |
| --- | --- | --- | --- |
| `TYPESAFE_API_KEY` | Yes | `server/planner/planner-handler.ts` | Bearer key for the Typesafe Jev API (`https://api.typesafe.ai/v1/systemone`). |
| `JEV_MODEL` | Yes | `server/planner/planner-handler.ts` | Jev model name sent with every Jev request. The example uses `jev-1.13.0`. |
| `OPENAI_API_KEY` | Yes | `server/planner/planner-phase2-handler.ts` | Bearer key for the OpenAI Chat Completions API. |
| `OPENAI_MODEL` | Yes | `server/planner/planner-phase2-handler.ts` | OpenAI model name. The example uses `gpt-4o`. |
| `PORT` | No | `server/server.ts` | HTTP port. Defaults to `3000` when unset or not a number. |
| `DATABASE_URL` | No | `server/server.ts`, `server/db/migrate-cli.ts` | PostgreSQL connection string (`postgres://user:password@host:port/database`) where the reports and the plans are stored. Without it the planner works, but no report is kept (the result has no `reportId`), and the plan routes answer `503`. |
| `TEST_DATABASE_URL` | No | `server/test/db/` | A PostgreSQL database for the integration tests. Each run uses its own schema, dropped at the end. Without it those tests are skipped. |
| `NODE_ENV` | No | `server/security.ts` | Set it to `production` in production. With it, `ENABLE_DEV_ROUTES=1` is refused at start, and the `/api/dev/` routes answer `404`. |
| `ENABLE_DEV_ROUTES` | No | `server/plan-routes.ts`, `server/security.ts` | `1` turns on the development routes (fake AI outputs, a demo plan). Never set it in production: the server refuses to start with it and `NODE_ENV=production`. |
| `DB_POOL_MAX` | No | `server/db/pool.ts` | Most connections to PostgreSQL open at once. Default `10`. |
| `DB_CONNECT_TIMEOUT_MS` | No | `server/db/pool.ts` | Milliseconds to wait for a free connection before the request fails. Default `5000`. |
| `DB_IDLE_TIMEOUT_MS` | No | `server/db/pool.ts` | Milliseconds a connection may stay idle before it is closed. Default `30000`. |
| `DB_STATEMENT_TIMEOUT_MS` | No | `server/db/pool.ts` | Milliseconds a single statement may run; PostgreSQL cancels it after this (error `57014`). Default `10000`. |

The four `DB_` limits must be positive whole numbers. Any other value stops the server at start, and the message names the variable.

**SSL to PostgreSQL** is set by `DATABASE_URL` itself, with the usual `sslmode` parameter (for example `?sslmode=require`). The server does not add or change it.

If a required variable is missing, the server starts, but the planner request fails with `500`.

## Scripts

Run from `server/`:

| Script | Command | What it does |
| --- | --- | --- |
| `npm run dev` | `tsx watch --env-file=.env server.ts` | Starts the server and restarts on changes. |
| `npm start` | `tsx --env-file=.env server.ts` | Starts the server without watching. |

`npm run dev`, `npm start` and `npm run migrate` read `server/.env` with `--env-file`, and that flag stops the command when the file is missing, even if `DATABASE_URL` is already set in the environment. Create `server/.env` (copy `.env.example`) before running them. The `--env-file-if-exists` flag would skip the check, but it was added in Node 22.9 and this project declares Node 22 or later, so the scripts keep `--env-file`.
| `npm run typecheck` | `tsc` | Type-checks the TypeScript sources. |
| `npm run migrate` | `tsx --env-file=.env db/migrate-cli.ts` | Applies the pending migrations in `server/db/migrations` to `DATABASE_URL`. Safe to run again: applied migrations are skipped. |
| `npm test` | `tsx --test "test/**/*.test.ts"` | Runs all the tests. The PostgreSQL tests run only when `TEST_DATABASE_URL` is set, in their own temporary schema. |
| `npm run agents:real-plan` | `tsx --env-file=.env scripts/real-plan-agent.ts` | Manual check of the plan level with the real model. Does nothing unless `AGENTS_REAL=1`; then it makes ONE OpenAI call (and one Jev call only with `AGENTS_JEV=1`) and prints the outcome, never the prompt or a key. Not part of `npm test`. |
| `npm run perf` | `tsx test/perf/perf.ts` | Times the plan rules on synthetic plans of four sizes (parsing, checks, derived values, one step action). It is not part of `npm test`. |
| `npm run test:e2e` | `node test/e2e/build-my-plan.mjs && tsx test/e2e/plan-decisions.e2e.ts && node test/e2e/loader.e2e.mjs` | Runs the browser checks in Chromium: "Build my plan" (with the planner answered by `page.route`) and the Decisions page (with the real plan routes answering the API). Needs Playwright: set `PLAYWRIGHT_MODULE` to its path if it is not installed here, and `CHROMIUM_PATH` to a Chromium binary if the default one is missing. `SCREENSHOTS` sets where the Decisions screenshots go. |

## Security

Every response carries the same headers, computed once in `server/security.ts`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a `Content-Security-Policy` that allows only the site's own scripts, styles, fonts, images and requests (`default-src 'self'`, no `unsafe-inline`, no `eval`, `frame-ancestors 'none'`). The pages have no inline script or style: `giant.js` holds the wordmark loop, and the bar widths on the timeline are set through the DOM, not as style attributes. The `test:e2e` checks fail on any policy violation or console error.

HSTS and TLS are not in the server: they belong to the proxy in front of it (see `PRODUCTION.md`).

**Logs carry no content.** Each failure is written as its context, the name of the error and a short code when there is one (`planner job: Error (provider_down)`). Messages, stacks and causes are never written, and neither is the body of a provider's answer: for a provider the line is the HTTP status, plus a code only when the JSON body has a safe `type` or `code`. This makes debugging harder on purpose; a failing request can be reproduced from its inputs instead.

## How it works

1. **Jev, phase 1** (`server/planner/planner-handler.ts`): classifies the sector, geographic scope and timeline from the idea and the form data.
2. **OpenAI, phase 2** (`server/planner/planner-phase2-handler.ts`): rates the maturity of the idea (`vague`, `developing`, `advanced`), fills the analysis sections (subsector, location, target customer, value proposition, revenue model, stage, competition, constraints) and proposes follow-up questions with a strict JSON schema.
3. **Question policy** (`server/planner/question-policy.ts`): the model proposes, the server decides. It sets the question limit from maturity (vague 2, developing 3, advanced 4, adjusted by commitment signals and clamped to 1-5), removes topics already answered, and keeps the most valuable questions first.
4. **Final request** (`server/planner/planner-profile-handler.ts`, `server/planner/planner-validation-handler.ts`): once all questions are answered, the server asks Jev for a 15-dimension business profile and validates the analysis. Claims are checked against the description, seven coherence checks are run, and 10 departments are scored. Departments are shown as groups or as individual departments depending on team size and the profile's team requirement (`departmentLevel`).

Each request runs as a background job, kept in memory by `server/jobs.ts`: `POST /api/planner` returns a job id at once and the front end polls `GET /api/planner/:id` until the result is ready. The front end (`script.js`) sends the phase 2 claims back in the final request (`analysis`), so the validation can check them.

### From the report to a plan

When a run ends with a report (the final request, or the first round with no questions left), the server builds the report from its own values (`server/planner/planner-run.ts`: the input and answers it received, the Jev result, the phase 2 analysis when there is one, the profile and the validation) and keeps it in the `reports` table. The job result then carries a `reportId`. The browser never sends the report back: it keeps only that id.

"Build my plan" sends the id to `POST /api/plan`, and the server builds the plan from the stored report with the fixed rules (`server/plan/plan-skeleton.ts`). A report has at most one plan: a second request returns the same plan, and two requests at the same time leave one plan in the database. When the report cannot be kept (no database, or a report that does not pass `parseReport`), the planner still answers, the result has no `reportId`, and "Build my plan" shows a notice instead.

## API

An analysis takes 20 to 90 seconds, so the API works in two steps: `POST` starts the job and `GET` reads its state.

### `POST /api/planner`

Request body (JSON):

| Field | Type | Rules |
| --- | --- | --- |
| `idea` | string | Required. Trimmed, 1 to 2000 characters. |
| `budget` | number | 0 to 1,000,000 (USD). |
| `experience` | number | 0 to 20 (years in the industry). |
| `team` | number | 0 to 3 (Solo, Small, Medium, Large). |
| `hours` | number | 0 to 3 (Under 10 h, 10-20 h, 30+ h, Full time). |
| `answers` | array | Optional. Up to 12 items. Each item has `topic`, `question` and `answer`, all non-empty strings of at most 1000 characters. |
| `final` | boolean | Optional. `true` returns the profile and validation. |
| `analysis` | object | Optional. Phase 2 claims (`subsector`, `location`, `target_customer`, `value_proposition`, `revenue_model`, `stage`, `competition`). Text is trimmed and cut to 300 characters; `unknown` and empty values are dropped. |

The request body is limited to about 100,000 characters.

Response `202` (the job has started; the analysis is not ready yet):

```json
{ "jobId": "3f9c1e2a-5b7d-4c8e-9a1f-0d2b6e7c8a90" }
```

### `GET /api/planner/:id`

Returns the state of a job. These responses are never cached (`Cache-Control: no-store`). Poll until `status` is `done` or `error`.

- **Pending** (`200`): `{ "status": "pending" }`. Check again later.
- **Done** (`200`): `{ "status": "done", "result": { ... } }`. The result is described below.
- **Error** (`200`): `{ "status": "error", "message": "..." }`. Internal failures (Jev or OpenAI down, a missing key, an unusable model response) give the message `Internal server error`; the details go to the server log only.
- **Not found** (`404`): `{ "error": "Job not found" }`. The id is unknown, the job expired (10 minutes after it finished) or the server restarted.

The `result` of a done job has one of these shapes:

- **With questions** (not final, questions left): the Jev result, the phase 2 analysis with the questions to ask, and the total number of questions.

  ```json
  {
    "jev": { "model": "...", "answers": { }, "usage": { } },
    "phase2": { "maturity": "developing", "subsector": { }, "questions": [ { "topic": "validation", "question": "...", "options": [] } ] },
    "questionTotal": 3
  }
  ```

- **Final** (`final: true`), or not final with no questions left: the Jev result and the report. The non-final variant also includes `phase2` with `questions: []`.

  ```json
  {
    "jev": { },
    "profile": { "values": { }, "unknown": [ ], "known": 12, "total": 15 },
    "validation": { "unsupported": [], "warnings": [], "departments": [ { "name": "Finance", "confidence": 80, "tier": "core" } ], "groups": [ ], "level": 2 }
  }
  ```

### Jobs

Jobs live in the memory of one server process (`server/jobs.ts`), with these limits (`server/server.ts`): 500 jobs at once (a new `POST` gets `503` when the store is full), finished jobs kept for 10 minutes, and pending jobs never expire. Jobs are lost when the server restarts, and a job started on one instance cannot be read from another.

### Errors

Errors return JSON `{ "error": "..." }`:

| Status | When |
| --- | --- |
| `400` | Body is not valid JSON, `idea` is missing or too long, a slider is missing or out of range, `answers` or `final` is invalid. No job is started. |
| `413` | Body is too large. No job is started. |
| `503` | The job store is full. Try again shortly. No job is started. |
| `404` | Any other path or method, or a job that does not exist (see `GET` above). |

### `POST /api/plan`

Creates the plan of a stored report. It needs a database; without one it answers `503`.

Request body (JSON), with no other keys:

```json
{ "reportId": "7b1e0c4a-2f3d-4e5a-8b6c-9d0e1f2a3b4c" }
```

| Status | Body | When |
| --- | --- | --- |
| `201` | `{ "id": "<plan id>" }` | The plan was made now and linked to the report. |
| `200` | `{ "id": "<plan id>" }` | The report already had its plan. |
| `400` | `{ "error": "Invalid request body", "code": "invalid_body" }` | Not JSON, a `reportId` that is not a UUID, or any other key. |
| `404` | `{ "error": "Report not found", "code": "report_not_found" }` | The report does not exist, or it belongs to another user (the same answer for both). |
| `500` | `{ "error": "Could not build the plan", "code": "skeleton_failed" }` | The rules could not build a valid plan from this report. |
| `500` | `{ "error": "Internal server error", "code": "internal_error" }` | Any other failure. The details go to the server log, as a code only. |
| `503` | `{ "error": "Plan storage is not configured", "code": "storage_unavailable" }` | No `DATABASE_URL`. |

The plan's title is the idea, cut to 80 characters. The body is checked before the storage: an invalid body is `400` even without a database.

The `GET /api/planner/:id` result of a finished job has a `reportId` field when its report was kept.

### Decisions: facts, gaps and suggestions

The plan asks the person a few things it needs to know (`product_type` for a game, for example). They are answered on the Decisions page (`#/decisions`), and every answer is a write that checks the version of the plan (`expectedVersion`), like the step actions. The actor is always the person: the server sets it, and no request body takes one (an `actor` key gives `400`).

A fact is one answer: a key and a value, each either a catalogue entry (`{ "kind": "catalog", "id": "product_type" }`) or free text (`{ "kind": "other", "text": "..." }`). The keys and the catalogue values are in `GET /api/plan/:id`, under `catalog`. A fact is `proposed` until confirmed; confirming a key replaces the one confirmed before (`superseded`), and what was generated from that one is listed as `derived.stale`, read only.

A gap is a task that waits for facts (`placeholder`). When its facts are confirmed, the plan can suggest the tasks it expands into (a proposal), and the person accepts or rejects them. A value without a ready-made suggestion gives `409 needs_ai`.

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /api/plan/:id/facts` | `{ key, value, confirm?, expectedVersion }` | `201`. With `confirm: true`, the fact is proposed and confirmed in the same write. |
| `POST /api/plan/:id/facts/:factId/confirm` | `{ expectedVersion }` | `200` |
| `POST /api/plan/:id/facts/:factId/reject` | `{ expectedVersion }` | `200` |
| `POST /api/plan/:id/gaps/:taskId/proposal` | `{ expectedVersion }` | `201`. The proposal is in `plan.proposals`, and `derived.proposals` lists its tasks and titles. |
| `POST /api/plan/:id/proposals/:proposalId/accept` | `{ expectedVersion }` | `200`. The tasks are added and the gap no longer waits. |
| `POST /api/plan/:id/proposals/:proposalId/reject` | `{ expectedVersion }` | `200` |

The success body is the one of a step action: `{ id, version, plan, derived }`. Errors use the same shape as the step actions, `{ error, code }`, with one fixed text per code. A stale `expectedVersion` gives `409 version_conflict`; the page then reloads the plan. A step whose history has reached its limit (200 events) answers `409 events_full` to every action, and a change that would take the plan's document over 5 MiB of JSON (`MAX_DOCUMENT_BYTES`, not calibrated yet) answers `409 plan_too_large`. Both leave the plan as it was.

Every write adds its entries to `plan_log` in the same write as the plan: `fact_proposed`, `fact_confirmed`, `fact_rejected`, `proposal_created`, `proposal_accepted` and `proposal_rejected`, with the actor and the id of the fact or proposal. The log only grows: the database refuses any change to it.

With `ENABLE_DEV_ROUTES=1`, `POST /api/dev/plan/:id/facts/fake-proposal` proposes a fact from the first AI step, so the screen can be tried without the AI. The development routes are off whenever `NODE_ENV=production`, even with the flag set.

### Order of checks on `POST /api/plan`

The body is checked first: a request that is not valid is `400` whether or not the database is configured. Only a valid request reaches the storage, which answers `503` without `DATABASE_URL`.

## Project layout

```
index.html              Single page: hero, idea form, sliders, question popup, result view
script.js               Front-end logic: form, question flow, API calls, dialogs
styles.css              Styles
tech-text.js            Animated text loader used while the request runs
fonts/                  Inter and Open Sans (woff2) with their licenses
server/
  server.ts             HTTP server: static files, POST and GET /api/planner routing
  jobs.ts               In-memory job store: runs the planner in the background
  request.ts            Body reading, validation and limits for the planner request
  plan-routes.ts        Plan API as a pure function: routes, status codes, development routes, facts and proposals
  plan/                 Plan model, rules, checks, derived values, and the plan and report repositories
  plan/agents/          Agent contracts by level (plan, department, task, step), the shared pipeline and the real model adapters (OpenAI, Jev)
  scripts/              Manual scripts that use the real model (not run by the tests)
  db/                   PostgreSQL: migrations (SQL files and their runner), plan and report repositories
  planner/
    planner-handler.ts          Jev phase 1 (sector, scope, timeline) and the shared Jev call
    planner-phase2-handler.ts   OpenAI analysis: maturity, sections, questions
    question-policy.ts          How many questions to ask and which ones
    planner-profile-handler.ts  15-dimension business profile (Jev)
    planner-validation-handler.ts  Claim checks, coherence checks and department scores (Jev)
    planner-run.ts              One planner run (Jev, phase 2 or the report), and keeping its report
  test/planner/         Tests for the handlers, policy, request parsing and the planner runs
  test/plan/            Tests for the plan rules, repositories, reports and routes
  test/db/              Tests for the migrations and the PostgreSQL repositories
  test/e2e/             Browser checks of "Build my plan" and of the Decisions page (npm run test:e2e)
  test/jobs.test.ts     Tests for the job store (expiry, limits, errors)
  package.json          Scripts and dev dependencies
  tsconfig.json         TypeScript settings (type-check only)
  .env.example          Environment variables to copy to .env
```

## Known limitations

- **No authentication.** The login and register dialogs do not send anything (`// TODO: send data` in `script.js`). The login gate is off (`REQUIRE_LOGIN = false` in `script.js`) for testing.
- **No rate limiting and no cost protection.** Every planner request calls paid APIs: a request that asks for questions makes one Jev and one OpenAI call; a final request (or one with no questions left) makes three Jev calls. Add rate limits and spending controls before deploying.
- **Placeholders in the UI.** "View my projects" only shows a notice.
- **Agents are not connected to the API yet.** The contracts in `server/plan/agents/` are tested with fake models only. Their answers are checked and turned into proposals, but no route calls them, and no error code of the agents has a text for the user yet. The first screen that uses them is the next slice.
- **Suggestions only from templates.** A gap is expanded only for the `mobile_game` and `web_app` product types. Other values answer `needs_ai` until the AI is built. A rejected suggestion can be asked again: the new one takes the next free id (`-2`, `-3`...), up to 20 tries, and then `id_taken`. A pending suggestion whose decision has changed is marked obsolete (`derived.proposals[id].obsolete`). It stays listed, with the label Obsolete, until it is retired: the screen's Retire button calls `reject` (logged as `proposal_rejected`). Accepting it gives `409 not_confirmed`, and nothing removes a suggestion by itself.
- **Uncalibrated thresholds.** The question-policy numbers (`POLICY` in `question-policy.ts`) and the validation thresholds (`SUPPORT_MIN`, `CHECK_MIN`, `CORE_MIN`, `IMPORTANT_MIN` in `planner-validation-handler.ts`) are estimates and have not been tuned on real data.
- **Elapsed time ignores waits on other tasks.** A task's status counts the steps of other tasks (a task whose steps all wait on other tasks is blocked), but its elapsed time only counts the relations between its own steps.
- **Little stored state.** Reports and plans are saved only when `DATABASE_URL` is set. Jobs are kept only in memory: a server restart interrupts the analyses in progress, and the front end shows an interrupted message with Retry. The front end must send back the answers and the analysis claims for the final request.
- **The analysis claims come from the browser.** The final request takes the analysis claims (`analysis`) from the browser, as sent back, and the "Verify X" tasks of the saved report come from them. A person can change their own plan that way; no other user is affected. The claims are checked for shape, not for truth. See `PRODUCTION.md`.
- **Reports are not tied to users yet.** Every report and plan belongs to the one local user (`LOCAL_USER` in `server/plan-routes.ts`). See `PRODUCTION.md`.
- **A final request keeps a report without `phase2`.** The final request does not run phase 2 again, so its stored report has no `phase2` field; the report from the first round without questions has it.
