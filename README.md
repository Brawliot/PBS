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

The plan assistant (`POST /api/plan/:id/agents/structure`) reads the same four keys as the planner: `OPENAI_API_KEY` and `OPENAI_MODEL` for the model, `TYPESAFE_API_KEY` and `JEV_MODEL` for the relevance judge. If one is missing, the route answers `503` and makes no call (`server/plan/agents/configured-agents.ts`).

The evaluation of the agents (`npm run agents:eval`, below) reads the same four keys, and these optional ones. None is needed by the server:

| Variable | Required | Read by | What it does |
| --- | --- | --- | --- |
| `AGENTS_EVAL` | For the evaluation | `server/scripts/agents-eval.ts` | Must be `1` for the evaluation to call the models. Without it the script prints `Nothing sent` and stops. |
| `EVAL_TASKS` | No | `server/eval/run.ts` | Tasks per case that get steps, from different departments, from 1 to 5. Default `2`. |
| `EVAL_MAX_CALLS` | No | `server/eval/run.ts` | Hard cap of calls to the model and to Jev for the whole run, retries included. Default: 100 per case chosen (400 for `--all`). |
| `EVAL_PRICE_OPENAI_IN`, `EVAL_PRICE_OPENAI_OUT`, `EVAL_PRICE_JEV_IN`, `EVAL_PRICE_JEV_OUT` | No | `server/eval/report.ts` | Dollars per million tokens (input and output, OpenAI and Jev). The cost is written only when all four are set. |

**Cost.** The evaluation makes real calls and they are billed by OpenAI and Jev. Each case makes between 30 and 90 calls (model and Jev together, with the default two tasks), and the run prints the estimate and the cap before it starts. The prices are not in the code: set them yourself in `server/.env`, from your provider's price list, and the reports show an estimate, not an invoice.

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
| `npm run agents:eval` | `tsx --env-file=.env scripts/agents-eval.ts` | Runs the real agents on four fixed test ideas and writes a report with numbers (calls, verdicts of Jev, time, tokens, cost if the prices are set, and heuristic checks) to `server/eval-output/`. Makes REAL calls and costs money: it sends nothing unless `AGENTS_EVAL=1`. `--case <id>` runs one case (`restaurant` by default: `restaurant`, `saas`, `physio`, `marketplace`), `--all` runs the four, `--repeat <n>` (1 to 3) repeats. See "Evaluación de modelos" in `FUTURE.md`. Not part of `npm test`. |
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
| `POST /api/plan/:id/agents/structure` | `{ expectedVersion }` | `201`. Asks the plan-level assistant for the structure of the plan (phases, tiers, relations between departments), from the idea of its report. See below. |
| `POST /api/plan/:id/agents/departments` | `{ expectedVersion }` | `201`. Asks the assistant for the tasks of every department that has none pending, then a review of the plan level over them. See below. |
| `POST /api/plan/:id/agents/tasks/:taskId/steps` | `{ expectedVersion }` | `201`. Asks the assistant for the steps of one task that has none. Only when the person presses "Suggest steps". See below. |
| `POST /api/plan/:id/agents/steps/:stepId/run` | `{ action: "launch" \| "answer", payload?, expectedVersion }` | `200`. Starts an AI step (`launch`), or answers its questions (`answer`), and the assistant runs the step, in one write. See below. |

#### The plan structure from the assistant

`POST /api/plan/:id/agents/structure` asks the assistant once. Its answer is only proposed: one pending proposal with `reason: { "scope": "plan" }` and its `structure` (in `plan.proposals`, and summarised in `derived.proposals[id].structure` with names instead of ids), and the facts it found, as proposed facts with `from: { "kind": "agent", "level": "plan" }`. The person accepts or rejects the structure as a whole (`/accept`, `/reject`); the facts are confirmed one by one, as any other fact. Accepting applies the phases, the tiers and the relations, and checks the plan again first. The requests and questions of the assistant are text for the person and are never applied.

The call is synchronous: it waits for the assistant, with up to three tries of the model and of the judge. Its failures:

| Code | Status | When |
| --- | --- | --- |
| `assistant_unavailable` | `503` | The model or the judge is not configured, or it did not answer on every try. |
| `suggestion_invalid` | `502` | The answer did not fit the plan on every try, or one of its facts does not fit the catalogue. |
| `no_report` | `409` | The plan was not made from a report (the demo plan), so there is no idea to work from. |
| `duplicate_pending` | `409` | A structure is already waiting for a decision. Refused before the assistant is called. |
| `version_conflict` | `409` | The plan changed while the assistant was thinking. Nothing from the suggestion is saved. |

A failure saves nothing. The server log gets one line with the code of the failure, never the prompts or the answer.

#### The steps of one task from the assistant

`POST /api/plan/:id/agents/tasks/:taskId/steps` runs the task level, once, for one task, when the person presses "Suggest steps" on a task that has no steps. Nothing runs when the task opens. The answer is one pending proposal with the steps (`add.steps`, each with its executor, mode, evidence, effort and wait) and their order relations (`blocks`, `follows`, `feeds`), plus the facts the assistant found as proposed facts with `from: { "kind": "agent", "level": "department" }` (the task belongs to a department). Nothing is in the plan until the person accepts the proposal in Decisions, and then the steps are in the task.

The checks that cost nothing come before the call, in this order:

1. The body, the id and the storage, then the assistant (`invalid_body`, `not_found`, `storage_unavailable`, `assistant_unavailable`).
2. The version (`version_conflict`), then an unknown task (`unknown_task`), then a gap or a task that already has steps (`not_available`), then a pending suggestion of steps for this task (`duplicate_pending`), then no confirmed fact (`no_confirmed_facts`).
3. The idea of the report (`no_report` without one).

The call is one attempt of the model (up to three tries, each with one Jev call), within the same 240 seconds as the department level. The whole answer is saved in one write under the version that was read, with the log entries `proposal_created` and `fact_proposed` (actor `ai`). A failure, or a wait longer than the limit, saves nothing. An answer with no step saves nothing and answers `200`.

The task's assistant receives the idea, the confirmed facts, the task, the confirmed outputs of AI steps of other tasks that feed its steps (never a draft), and the related tasks as title and direction only (`before` or `after`). Direction: `A blocks B` means A is done before B, and `B follows A` means B comes after A.

| Code | Status | When |
| --- | --- | --- |
| `unknown_task` | `404` | The task is not in the plan. Refused before any call. |
| `not_available` | `409` | The task is a gap (it waits for facts), or it already has steps. Refused before any call. |
| `duplicate_pending` | `409` | Steps for this task are already waiting for a decision. Refused before any call. |
| `no_confirmed_facts` | `409` | No decision is confirmed yet. Refused before any call. |
| `no_report` | `409` | The plan was not made from a report, so there is no idea to work from. |
| `assistant_unavailable` | `503` | The model or the judge is not configured, the model or Jev did not answer on every try, or the time ran out. |
| `suggestion_invalid` | `502` | The answer did not fit the plan on every try (a step that does not fit the rules, a relation to an unknown step, a fact the catalogue does not allow). |
| `version_conflict` | `409` | The plan changed while the assistant was thinking. Nothing is saved. |

#### The run of an AI step

`POST /api/plan/:id/agents/steps/:stepId/run` is the one request that starts an AI step (`action: "launch"`) or answers its questions (`action: "answer"`, with `payload: { answers: [...] }`, one answer per question of the latest output). The person's action, the output of the assistant and the facts it proposes are saved in ONE write, as two history entries: the person's event (`launch` or `answer`, actor `user`) and the output (`attach_output`, actor `ai`). The output has a summary, a document, the questions and the requests, and it stays a draft until the person confirms or rejects it with the buttons of the step (those two are plain step actions).

The order of the checks, so that a refusal never calls the assistant:

1. The body (strict: only `action`, `payload` and `expectedVersion`), the ids, the storage and the assistant (`invalid_body`, `not_found`, `unknown_step`, `storage_unavailable`, `assistant_unavailable`).
2. The version (`version_conflict`), then the step: a step that is not AI is `not_allowed`, and a plan without a report is `no_report`.
3. The person's action on a copy of the plan, with the same rules as every step action: `not_ready` (a step waiting for another), `rounds_exceeded` (the step has used its three rounds), `invalid_payload` (the answers do not match the questions). Nothing is called on these.
4. The assistant, with the step's input: the step, the idea, the confirmed facts, the task and department names, the answers so far, and the confirmed outputs of the steps that feed this one.
5. Its output, applied to the copy as `attach_output`, and its facts. A fact that is already proposed or confirmed is not proposed again.

If any part fails, nothing is saved and the step stays exactly as it was: never `running` by a failed call. An output that does not fit the plan is `suggestion_invalid` (502).

| Code | Status | When |
| --- | --- | --- |
| `not_allowed` | `409` | The step is not an AI step, or the action does not fit its state. |
| `not_ready` | `409` | The step waits for another step. Refused before any call. |
| `rounds_exceeded` | `409` | The step has used its three rounds. Refused before any call. |
| `invalid_payload` | `400` | The answers do not match the questions of the latest output. Refused before any call. |
| `assistant_unavailable` | `503` | The model or the judge is not configured, the model or Jev did not answer on every try, or the time ran out. |
| `suggestion_invalid` | `502` | The output did not fit (too long, an extra field, a document with NUL, a fact the catalogue does not allow...) on every try. |
| `version_conflict` | `409` | The plan changed while the assistant was working. Nothing is saved. |

**Limits of a step.** The document of a step is at most 20,000 characters (`MAX_DOCUMENT_TEXT`), the summary 1,000, and a step has at most five requests (300 characters each) and five questions per round. Only the latest output of a step keeps its document: when a new round is attached, the earlier outputs keep their summary, questions and requests, but not the document, so the plan does not grow with every round. The answer of one call may use up to 8,000 tokens (`STEP_MAX_TOKENS`); an answer cut by that limit is a failure, not a partial document.

**Cost.** One press of Start or Send answers is one round: up to three tries, and each try is one OpenAI call and one Jev call. A step has at most three rounds per attempt, so one attempt costs at most nine OpenAI calls and nine Jev calls. A press of "Suggest steps" is one call with up to three tries (at most three and three).

#### The tasks of each department from the assistant

`POST /api/plan/:id/agents/departments` runs the department level, pressed by hand on the Decisions page ("Suggest tasks for all departments"). It runs in this order, and the checks that cost nothing come before any call:

1. The body, the id, the storage and the assistant (`invalid_body`, `not_found`, `storage_unavailable`, `assistant_unavailable`).
2. The version (`version_conflict`), then a structure waiting for a decision (`not_available`: decide the structure first, the tasks sit in its phases), then no confirmed fact (`no_confirmed_facts`), then every department already having a pending task proposal (`duplicate_pending`). Nothing is called on these.
3. The idea of the report (`no_report` without one).
4. One call per department that has no pending proposal, in parallel and at most `MAX_PARALLEL_DEPARTMENTS` (5) at once. A department sees only: the idea, the confirmed facts, the phases, its own tasks, the confirmed outputs of AI steps of other departments that feed its steps, and the order relations that touch it. It never sees another department's proposal.
5. One review of the plan level over all the tasks proposed: clashes, duplicates, gaps and missing orders.

The answer is only proposed. One pending proposal per department that proposed a task (`origin: ai`, `reason: { factId }`, tasks grouped by phase, and its order relations between tasks), and the facts the departments proposed as proposed facts with `from: { "kind": "agent", "level": "department" }`. A fact with the same key and value as one the plan has (proposed or confirmed) is not proposed again. Each proposal has read-only `notes` (at most 20, each at most 400 characters): the requests and questions of its department, the review's findings that name one of its tasks, and the suggested orders, as text (`Suggested order: <A> before <B>`). A finding or order that names no proposed task goes to the first proposal. An order is never applied by itself: the person accepts or rejects each department's proposal.

The whole call is one write under the version that was read, with its log entries (`proposal_created` and `fact_proposed`, actor `ai`). Either everything is saved or nothing is. The call waits for the assistant with a limit of 240 seconds for the whole of it; longer than that, the answer is `assistant_unavailable`, and the work still running is thrown away without a write. This is under the 300 seconds Node allows a request by default, so the answer is always ours to send. It is synchronous, not a job like the planner's: the screen waits with the loader, and a job would add a poll for no gain while there is one call of this kind at a time.

| Code | Status | When |
| --- | --- | --- |
| `no_confirmed_facts` | `409` | No decision is confirmed yet, so there is nothing to build on. Refused before any call. |
| `not_available` | `409` | A structure is waiting for a decision. Refused before any call. |
| `duplicate_pending` | `409` | Every department already has a pending task proposal. Refused before any call. |
| `no_report` | `409` | The plan was not made from a report, so there is no idea to work from. |
| `assistant_unavailable` | `503` | The model or the judge is not configured, a department or the review did not answer on every try, or the 240 seconds ran out. |
| `suggestion_invalid` | `502` | An answer did not fit the plan, or one of the facts does not fit the catalogue. |
| `version_conflict` | `409` | The plan changed while the assistant was thinking. Nothing from the suggestion is saved. |

A press with nothing to add answers `200` with the plan unchanged (the screen says so), and saves nothing.

**Cost:** one press makes one call per department that has no pending proposal (up to `LIMITS.departments`, 20) plus one review call. Each call has up to three tries, and each try is one OpenAI call and one Jev call. The worst case is therefore about 3 × (20 + 1) model calls and as many judge calls.

**Known limits of this level:** a department that proposes no task makes no proposal, so its requests and questions are not kept. The review sees only the tasks of this press, not those of pending proposals of an earlier press, so a clash with one of those is not seen. The orders of the review are text: they are never added as relations.

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
  plan/plan-structure.ts  The plan structure: applied to a copy, proposed, and applied when accepted
  plan/agents/department-input.ts  The input of one department call, built from confirmed things and its own parts only
  plan/agents/department-suggestion.ts  The tasks of all departments: the calls, the review, the notes and the deadline
  plan/agents/          Agent contracts by level (plan, department, task, step), the shared pipeline and the real model adapters (OpenAI, Jev), and the agents built from the environment
  scripts/              Manual scripts that use the real model (not run by the tests)
  eval/                 Evaluation of the agents: fixed cases, the chain of levels, the call budget and the reports (npm run agents:eval)
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
  test/eval/            Tests of the evaluation (fakes only: no network, no keys)
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
- **The levels of the agents are connected one by one, by hand.** The plan level (`agents/structure`), the department level (`agents/departments`), the steps of one task (`agents/tasks/:taskId/steps`) and the run of an AI step (`agents/steps/:stepId/run`) call a model, each only when the person presses its button. The views "Today", a side panel and a dependency diagram are not built: their design is not decided. The document of a step is kept only in its latest output (see above); the document goes to its own table later (see `FUTURE.md`).
- **Each suggestion costs money and waits.** A structure suggestion calls OpenAI and Jev up to three times each, and it is only made when the person presses "Suggest plan structure" (never when the page opens). Its worst wait is about three times (60 s for OpenAI plus 30 s for Jev), that is about 270 s, close to the 300 s request timeout Node uses by default. It is synchronous for now; a background job would be the fix if the waits grow. Only one structure can wait at a time.
- **A structure is not re-checked against the facts it was made from.** If a fact changes after the suggestion, the structure stays pending and is still accepted if it fits the plan, unlike the tasks of a gap (they are marked obsolete).
- **Suggestions only from templates.** A gap is expanded only for the `mobile_game` and `web_app` product types. Other values answer `needs_ai` until the AI is built. A rejected suggestion can be asked again: the new one takes the next free id (`-2`, `-3`...), up to 20 tries, and then `id_taken`. A pending suggestion whose decision has changed is marked obsolete (`derived.proposals[id].obsolete`). It stays listed, with the label Obsolete, until it is retired: the screen's Retire button calls `reject` (logged as `proposal_rejected`). Accepting it gives `409 not_confirmed`, and nothing removes a suggestion by itself.
- **Uncalibrated thresholds.** The question-policy numbers (`POLICY` in `question-policy.ts`) and the validation thresholds (`SUPPORT_MIN`, `CHECK_MIN`, `CORE_MIN`, `IMPORTANT_MIN` in `planner-validation-handler.ts`) are estimates and have not been tuned on real data.
- **Elapsed time ignores waits on other tasks.** A task's status counts the steps of other tasks (a task whose steps all wait on other tasks is blocked), but its elapsed time only counts the relations between its own steps.
- **Little stored state.** Reports and plans are saved only when `DATABASE_URL` is set. Jobs are kept only in memory: a server restart interrupts the analyses in progress, and the front end shows an interrupted message with Retry. The front end must send back the answers and the analysis claims for the final request.
- **The analysis claims come from the browser.** The final request takes the analysis claims (`analysis`) from the browser, as sent back, and the "Verify X" tasks of the saved report come from them. A person can change their own plan that way; no other user is affected. The claims are checked for shape, not for truth. See `PRODUCTION.md`.
- **Reports are not tied to users yet.** Every report and plan belongs to the one local user (`LOCAL_USER` in `server/plan-routes.ts`). See `PRODUCTION.md`.
- **A final request keeps a report without `phase2`.** The final request does not run phase 2 again, so its stored report has no `phase2` field; the report from the first round without questions has it.
