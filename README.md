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
| `DATABASE_URL` | No | `server/server.ts`, `server/db/migrate-cli.ts` | PostgreSQL connection string (`postgres://user:password@host:port/database`) where the plans are stored. Without it the planner works, and the plan routes answer `503`. |

If a required variable is missing, the server starts, but the planner request fails with `500`.

## Scripts

Run from `server/`:

| Script | Command | What it does |
| --- | --- | --- |
| `npm run dev` | `tsx watch --env-file=.env server.ts` | Starts the server and restarts on changes. |
| `npm start` | `tsx --env-file=.env server.ts` | Starts the server without watching. |
| `npm run typecheck` | `tsc` | Type-checks the TypeScript sources. |
| `npm run migrate` | `tsx --env-file=.env db/migrate-cli.ts` | Applies the pending migrations in `server/db/migrations` to `DATABASE_URL`. Safe to run again: applied migrations are skipped. |
| `npm test` | `tsx --test "test/**/*.test.ts"` | Runs all the tests. The PostgreSQL tests run only when `TEST_DATABASE_URL` is set, in their own temporary schema. |

## How it works

1. **Jev, phase 1** (`server/planner/planner-handler.ts`): classifies the sector, geographic scope and timeline from the idea and the form data.
2. **OpenAI, phase 2** (`server/planner/planner-phase2-handler.ts`): rates the maturity of the idea (`vague`, `developing`, `advanced`), fills the analysis sections (subsector, location, target customer, value proposition, revenue model, stage, competition, constraints) and proposes follow-up questions with a strict JSON schema.
3. **Question policy** (`server/planner/question-policy.ts`): the model proposes, the server decides. It sets the question limit from maturity (vague 2, developing 3, advanced 4, adjusted by commitment signals and clamped to 1-5), removes topics already answered, and keeps the most valuable questions first.
4. **Final request** (`server/planner/planner-profile-handler.ts`, `server/planner/planner-validation-handler.ts`): once all questions are answered, the server asks Jev for a 15-dimension business profile and validates the analysis. Claims are checked against the description, seven coherence checks are run, and 10 departments are scored. Departments are shown as groups or as individual departments depending on team size and the profile's team requirement (`departmentLevel`).

Each request runs as a background job, kept in memory by `server/jobs.ts`: `POST /api/planner` returns a job id at once and the front end polls `GET /api/planner/:id` until the result is ready. The planner stores nothing between requests. Plans are the only data the server keeps, in PostgreSQL. The front end (`script.js`) sends the phase 2 claims back in the final request (`analysis`), so the validation can check them without the server storing anything.

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
  plan-routes.ts        Plan API as a pure function: routes, status codes, development routes
  plan/                 Plan model, rules, checks, derived values and the plan repositories
  db/                   PostgreSQL: migrations (SQL files and their runner) and the plan repository
  planner/
    planner-handler.ts          Jev phase 1 (sector, scope, timeline) and the shared Jev call
    planner-phase2-handler.ts   OpenAI analysis: maturity, sections, questions
    question-policy.ts          How many questions to ask and which ones
    planner-profile-handler.ts  15-dimension business profile (Jev)
    planner-validation-handler.ts  Claim checks, coherence checks and department scores (Jev)
  test/planner/         Tests for the handlers, policy and request parsing
  test/plan/            Tests for the plan rules, repositories and routes
  test/db/              Tests for the migrations and the PostgreSQL repository
  test/jobs.test.ts     Tests for the job store (expiry, limits, errors)
  package.json          Scripts and dev dependencies
  tsconfig.json         TypeScript settings (type-check only)
  .env.example          Environment variables to copy to .env
```

## Known limitations

- **No authentication.** The login and register dialogs do not send anything (`// TODO: send data` in `script.js`). The login gate is off (`REQUIRE_LOGIN = false` in `script.js`) for testing.
- **No rate limiting and no cost protection.** Every planner request calls paid APIs: a request that asks for questions makes one Jev and one OpenAI call; a final request (or one with no questions left) makes three Jev calls. Add rate limits and spending controls before deploying.
- **Placeholders in the UI.** "View my projects" only shows a notice. "Build my plan" waits three seconds and then returns to the result; it does not call the server.
- **Uncalibrated thresholds.** The question-policy numbers (`POLICY` in `question-policy.ts`) and the validation thresholds (`SUPPORT_MIN`, `CHECK_MIN`, `CORE_MIN`, `IMPORTANT_MIN` in `planner-validation-handler.ts`) are estimates and have not been tuned on real data.
- **No stored state.** Nothing is saved between requests, and jobs are kept only in memory: a server restart interrupts the analyses in progress, and the front end shows an interrupted message with Retry. The front end must send back the answers and the analysis claims for the final request.
