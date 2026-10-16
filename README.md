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
| `OPENAI_API_KEY` | Yes | `server/planner/planner-phase2-handler.ts`, `server/planner/planner-explain-handler.ts` | Bearer key for the OpenAI Chat Completions API. |
| `OPENAI_MODEL` | Yes | `server/planner/planner-phase2-handler.ts`, `server/planner/planner-explain-handler.ts` | OpenAI model name. The example uses `gpt-4o`. |
| `PORT` | No | `server/server.ts` | HTTP port. Defaults to `3000` when unset or not a number. |
| `DATABASE_URL` | No | `server/server.ts`, `server/db/migrate-cli.ts` | PostgreSQL connection string (`postgres://user:password@host:port/database`) where the users, their sessions, the reports and the plans are stored. Without it there are no accounts: sign-up and sign-in answer `503`, and so do the planner and the plan routes. The start page still loads. |
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
| `AGENTS_REAL` | For the manual script | `server/scripts/real-plan-agent.ts` | Must be `1` for `npm run agents:real-plan` to make its one OpenAI call. Without it the script prints `Nothing sent`. |
| `AGENTS_JEV` | No | `server/scripts/real-plan-agent.ts` | `1` makes the manual script ask Jev too, about relevance. Only read by `agents:real-plan`. |
| `EVAL_TASKS` | No | `server/eval/run.ts` | Tasks per case that get steps, from different departments, from 1 to 5. Default `2`. |
| `EVAL_RECORD` | No | `server/eval/record.ts` | Set to `1` to keep, in `server/eval-output/recordings/<run>/`, the role and the answer of each model call and each Jev verdict. Never the prompts or the keys. Off by default. |
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
| `npm run create-test-user` | `tsx --env-file=.env scripts/create-test-user.ts` | Asks for an email, a name and a password in the terminal, creates the user, moves every plan and report of the provisional user to it and removes the provisional user, in one transaction. Run it once, by hand, after `npm run migrate`. It is not a migration and runs nothing by itself. |
| `npm run agents:real-plan` | `tsx --env-file=.env scripts/real-plan-agent.ts` | Manual check of the plan level with the real model. Does nothing unless `AGENTS_REAL=1`; then it makes ONE OpenAI call (and one Jev call only with `AGENTS_JEV=1`) and prints the outcome, never the prompt or a key. Not part of `npm test`. |
| `npm run agents:eval` | `tsx --env-file=.env scripts/agents-eval.ts` | Runs the real agents on four fixed test ideas and writes a report with numbers (calls, verdicts of Jev, time, tokens, cost if the prices are set, and heuristic checks) to `server/eval-output/`. Makes REAL calls and costs money: it sends nothing unless `AGENTS_EVAL=1`. `--case <id>` runs one case (`restaurant` by default: `restaurant`, `saas`, `physio`, `marketplace`), `--all` runs the four, `--repeat <n>` (1 to 3) repeats. `--mode levels` (the default) runs each level on its own, from the same skeleton, so one run shows the failures of every level; `--mode chain` runs end to end and stops at the first failure. `--replay <folder>` runs again from a recording (see below): no network, no key, no client. In the levels mode the review reads the tasks the departments of the same run proposed (its report says "departamentos reales"); when no department proposed a task, the review runs over the fixed synthetic tasks and the report says so ("sintética"). The report counts its findings by kind and names the task titles each one names. See "Fase 3: estado final" in `FUTURE.md`. When an attempt fails, the report lists it with its reason (one label, such as `id_prefix` or `schema`), and the departments level says how many departments passed at once, how many were retried, and which ones failed (only their ids). Not part of `npm test`. |
| `npm run perf` | `tsx test/perf/perf.ts` | Times the plan rules on synthetic plans of four sizes (parsing, checks, derived values, one step action). It is not part of `npm test`. |
| `npm run test:e2e` | `node test/e2e/build-my-plan.mjs && tsx test/e2e/plan-decisions.e2e.ts && node test/e2e/loader.e2e.mjs` | Runs the browser checks in Chromium: "Build my plan" (with the planner answered by `page.route`) and the Decisions page (with the real plan routes answering the API). Needs Playwright: set `PLAYWRIGHT_MODULE` to its path if it is not installed here, and `CHROMIUM_PATH` to a Chromium binary if the default one is missing. `SCREENSHOTS` sets where the Decisions screenshots go. |

## Security

Every response carries the same headers, computed once in `server/security.ts`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a `Content-Security-Policy` that allows only the site's own scripts, styles, fonts, images and requests (`default-src 'self'`, no `unsafe-inline`, no `eval`, `frame-ancestors 'none'`). The pages have no inline script or style: `giant.js` holds the wordmark loop, and the bar widths on the timeline are set through the DOM, not as style attributes. The `test:e2e` checks fail on any policy violation or console error.

HSTS and TLS are not in the server: they belong to the proxy in front of it (see `PRODUCTION.md`).

**Accounts and sessions.** Passwords are kept with scrypt (Node's built-in function, a random salt for each one), never as text. A session is a random token in a cookie named `pbs_session`, with `HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days, and `Secure` when `NODE_ENV=production`. The database keeps only the SHA-256 hash of the token, so a copy of the table cannot be used to sign in. Every `POST` must come from this site: an `Origin` header that does not match the `Host` gets `403`. Failed sign-ins are counted per email in memory (see the API below).

**Logs carry no content.** Each failure is written as its context, the name of the error and a short code when there is one (`planner job: Error (provider_down)`). Messages, stacks and causes are never written, and neither is the body of a provider's answer: for a provider the line is the HTTP status, plus a code only when the JSON body has a safe `type` or `code`. This makes debugging harder on purpose; a failing request can be reproduced from its inputs instead.

## How it works

1. **Jev, phase 1** (`server/planner/planner-handler.ts`): classifies the sector, geographic scope and timeline from the idea and the form data.
2. **OpenAI, phase 2** (`server/planner/planner-phase2-handler.ts`): rates the maturity of the idea (`vague`, `developing`, `advanced`, kept for the report's top and not for the number of questions), fills the analysis sections (subsector, location, target customer, value proposition, revenue model, stage, competition, constraints) and proposes up to two follow-up questions from a closed catalog of topics for physical businesses (`credentials`, `trade_experience`, `who_operates`, `opening_deadline`, `partners`, `existing_customers`, `tech_builder`), with a strict JSON schema.
3. **Question policy** (`server/planner/question-policy.ts`): the model proposes, the server decides. At most two questions are asked for the whole session, answered ones included, and none is fine. It removes topics already answered and keeps the most valuable first.
4. **Final request** (`server/planner/planner-profile-handler.ts`, `server/planner/planner-validation-handler.ts`): once all questions are answered, the server asks Jev for a 15-dimension business profile and validates the analysis. Claims are checked against the description, seven coherence checks are run, and 10 departments are scored. Departments are shown as groups or as individual departments depending on team size and the profile's team requirement (`departmentLevel`).
5. **Diagnosis** (`server/plan/checks.ts`, `server/plan/diagnosis-text.ts`): five checks decided by rules and by Jev's answers, with the words written by one more model call that cannot change a status. See "The diagnosis: five checks, risks and who does what" below.
6. **Explanations** (`server/planner/planner-explain-handler.ts`): when a report is built, one more OpenAI call writes a short reason for each warning and each key area the report shows (the first three warnings, the first four areas that are not light), and also returns the time to open, the split of the upfront cost and three starter templates (see below). The reply is checked, never corrected, and each part on its own: a part that is not asked for, repeated, out of its limits or not plain text is left out, and the other parts are kept. A failed call leaves the report without explanations and logs only its code. The call is not made while questions are still open.

Each request runs as a background job, kept in memory by `server/jobs.ts`: `POST /api/planner` returns a job id at once and the front end polls `GET /api/planner/:id` until the result is ready. The front end (`script.js`) sends the phase 2 claims back in the final request (`analysis`), so the validation can check them.

### Time to open, upfront cost and starter templates

Three more pieces sit under the budget and in the action row of the report. Each one is shown only when the report has its data; a report without them looks as before. They are stored in the report as optional parts of `explanations` (`server/plan/report.ts`), so the live result and a saved report show the same thing.

- **Time to open** ("3–5 months", with its confidence): the model's estimate of how long until the business is set up and open to customers. It is in whole weeks or months, within the caps of `report-limits.ts` (104 weeks, 60 months). It must not contradict the profile's band for the time to first revenue, but the server does not check that; it is a claim of the model.
- **Upfront cost**: the model splits the upfront cost into 2 to 5 items, as percentages that add up to exactly 100. The money range is the one from the budget block; the report never shows another amount of money. The bar is decorative, and the text under it is the same split in words.
- **Starter templates (3)**: the model picks three ids from a fixed catalog of eight (`server/planner/report-templates.ts`, copied from the approved draft). It never writes their text. The page shows the three picks in a dialog, with the one automatic placeholder `{{location}}` filled from the report's location (or `[your city]`). Each one has a Copy button. The catalog is served by `GET /api/report-templates`, to a signed-in person only.

Known limits:

1. The time to open and the cost split are estimates of the model, not checked against any source.
2. The time to open of the report can differ from the calendar total of the plan, which comes from a fixed table (`TIMELINE_TOTAL` in `server/plan/plan-skeleton.ts`).
3. The money range is the one of the first round: a final request takes it from the browser, as it takes the rest of the glance.

### From the report to a plan

When a run ends with a report (the final request, which the browser sends after the person has confirmed what was understood), the server builds the report from its own values (`server/planner/planner-run.ts`: the input and answers it received, the Jev result, the phase 2 analysis when there is one, the profile and the validation) and keeps it in the `reports` table. The job result then carries a `reportId`. The browser never sends the report back: it keeps only that id.

"Build my plan" sends the id to `POST /api/plan`, and the server builds the plan from the stored report with the fixed rules (`server/plan/plan-skeleton.ts`). A report has at most one plan: a second request returns the same plan, and two requests at the same time leave one plan in the database. Each report belongs to the user who asked for it. When the report cannot be kept (a report that does not pass `parseReport`), the planner still answers, the result has no `reportId`, and "Build my plan" shows a notice instead.

### The top of the report (the glance)

The report opens with a short "glance": the idea's maturity, the stage, the location and the budget range with its fit, the four things the business asks of the person, and a line saying what the result is based on. The glance is stored in the report as the optional `glance` field (`server/plan/glance.ts`); reports kept before it have none, and then the top shows what the rest of the report has.

Where each piece comes from:

- **Idea (maturity), location, budget range and fit, and the source marks** ("you said" or "inferred"): phase 2 of the first round. On a first round with no questions the server builds the glance from its own phase 2 (`glanceOf` in `server/planner/planner-run.ts`). On a final request the server has no phase 2, so the browser sends the glance back with the request (`glance`, built from the analysis of the first round), and the server keeps it only if it passes the schema. A glance that does not pass is left out whole; the request still works.
- **Stage** and **what the business asks** (time to first revenue, capital, team, regulation): the profile, which is built after the answers.
- **Team, under what the business asks**: the team the person chose in the form, from the report's input.
- **Budget mark**: the person's budget from the form, placed on the bar only for dollars (the form is in dollars).
- **The line at the bottom**: the number of answers the report is based on.

Known limit: a final request takes the glance fields from the browser, so they are the ones of the first round, not checked against the answers. The server only checks their shape and limits. Because the final report keeps no phase 2, a report made through questions shows no Business row after a reload (the row is shown on the live result only).

### Clarity of the report

Under the glance chips the report shows two levels, **Business concept** and **About you**, each Low, Medium or High, with up to three things that are missing. Clarity is not viability: it only measures how well the business and the person are understood. The page says so.

The levels are computed by code (`server/plan/clarity.ts`), never by a model, from what the run already has: where each phase 2 field came from (`stated`, `inferred`, `unknown`), the 15 profile dimensions, the four fixed questions and the topics of the answers. No extra AI call.

- **Weights**: Essential 3, Important 2, Secondary 1. **Source value**: stated 1, inferred 0.5, unknown 0. A pair (a phase 2 field and its profile dimension) takes the best source. A profile dimension has no source: when known it counts as inferred. An answer on the matching topic counts as stated.
- **Business concept**: what it offers (subsector + `offering_type`), value proposition, target customer (+ `customer_segment`), how it makes money (+ `revenue_model`), where it operates (location) are Essential; how it reaches customers (`acquisition_channel`), what sets it apart (`differentiator`, topic `differentiator`), stage (+ `validation_stage`, topics `validation`/`progress`) are Important; competition is Secondary. `capital_intensity`, `time_to_revenue`, `regulatory_load` and `third_party_dependency` are not counted: they are the model's judgement, not something the person can tell.
- **About you**: budget, weekly hours, team (fixed questions) and what they can do themselves (`founder_profile`, topic `own_skills`) are Essential; experience and handling other people's money (`money_handling`, topic `money_handling`) are Important; fixed deadline (`deadline_rigidity`, topic `deadline`) and existing assets (topic `existing_assets`) are Secondary. A fixed question answered counts as stated; "I don't know" as unknown.
- **Thresholds** (initial, to calibrate with real reports): concept Low < 40 %, Medium 40–69 %, High ≥ 70 %; person Low < 60 %, Medium 60–84 %, High ≥ 85 % (the four fixed answers alone give about 61 %). An unknown Essential keeps the level below High.

Weights, source values and thresholds are the constants of `CLARITY` in `server/plan/clarity.ts`; change `CLARITY_VERSION` with them. The report keeps the result as the optional `clarity` field (version, and per metric level, score and missing). A final request has no phase 2 on the server, so the browser sends the sources back inside the glance (`glance.sources`); a glance without them (or one that fails its schema) gives a report without clarity, and the page shows no block. Reports kept before this have none.

### The diagnosis: five checks, risks and who does what

The report opens with five checks. Each one has a status (Strong, Watch or Risk, always with a symbol and a word), a reason of up to 240 characters, a mark "estimated" when the figure behind it is an estimate, and who decided it (`rule` or `jev`). The statuses are decided by code and by Jev's answers, never by the text model. The data is in the optional `diagnosis` field of the report (`server/plan/report.ts`, limits in `report-limits.ts`); a report kept before it shows the previous view.

Who decides each check:

| Check | Decided by | Rule |
| --- | --- | --- |
| Concept | Jev | Question `concept`: Strong, Watch or Risk |
| Location (Reach for an online business) | Jev | Question `location`. Reach when the scope is `Online` or `Global` |
| Money | Rule | Budget against the minimum the idea needs (`CHECK_RULES.money`): at or above it is Strong; at 75 % of it or more, Watch; below, Risk. No range or no minimum is Watch |
| Experience | Rule, then Jev | A regulated profession (`HEAVY_REGULATION`) is Risk, since its credentials are not captured. Otherwise the founder profile decides: "Sector expert" is Strong; "Technical", "Commercial", "Management" and "Several areas" are Watch; "No relevant background" is Risk. "Not specified" goes to Jev (question `experience`) |
| Competition | Jev | Question `competition`: Strong, Watch or Risk |

Jev's four questions are in `CHECK_QUESTIONS` (`server/planner/planner-handler.ts`), asked only by the planner's own call, not by the detection of the idea. A missing answer, or one that is not Strong, Watch or Risk, is Watch with the default reason of that check. The money range comes from phase 2 on the first round, and from the glance on the final request, the only place a final request has it.

The words are written by one more model call, the diagnosis text (`server/planner/planner-explain-handler.ts`, `explainDiagnosis`): the idea in one plain sentence, one reason for each check, and three risks, under a closed schema whose check keys are this business's. The text never changes a status. Each part is checked on its own (`server/plan/diagnosis-text.ts`):

- A reason that uses a word that contradicts its status is replaced by the default reason of that check and status. A Risk is never described as good, a Strong never as a problem, a Watch never as settled. The word lists are in `CONTRADICTS`, and they are a plain list, not a judgement.
- A reason over its limit is replaced, not cut. The risks are cut to the first three. An idea over its limit is replaced by the person's own idea, cut to its limit.
- A failed call, or a reply that is not usable, keeps the defaults: the report is never kept without its words.

"Improve my report" answers move the states (`applyImprove` in `server/plan/checks.ts`), after the rules and Jev have given theirs. The effect of each option comes from the closed bank (`server/plan/improve-questions.ts`):

- **good**: one level up. A cushion or financing on money is decided again by the money rule, with the cushion counted as `CHECK_RULES.money.cushionShare` of the minimum.
- **partial**: a risk becomes a watch; a watch stays.
- **gap** ("I don't know yet", "Not decided yet", "No", "Not yet"): a risk becomes a watch and the check is **identified** (its reason says the plan will work on it, and the page notes it). A gap never makes a check strong.

Several answers in one category count as the best one, once. A check is never lowered. Each identified check keeps its plan task (`planTask`, from `PLAN_TASK`), which the plan does not read yet.

The "who does what" lines come from the execution the phase 2 analysis proposes, checked by the server (`server/plan/execution.ts`), never from the model. A part called Mando's is one of `MANDO_BUILDS` (`server/planner/mando-capabilities.ts`) or it is the person's, or hired out when it costs money. The lines are "Mando builds" (the catalog labels only), "You handle" and "Hire out", at most four each. An empty line is not shown.

Known limits:

1. Credentials and professional registration are not captured, so every regulated business is Risk on experience until a credentials question exists. The experience check reads the founder profile, not years of practice.
2. The diagnosis is kept with the final request only. A first round with no questions shows no diagnosis, and a report made through questions has it after the final request.
3. The thresholds (75 % for Watch on money) and the default texts are not calibrated with real reports.
4. The words are in English, like the rest of the report.
5. An item the person sells can land under "Hire out" when its cost is known and Mando does not build it. That is what the rule says; it is not a judgement about the product.

The end-to-end tests run the report in Chromium with the planner's answers simulated. `test/e2e/diagnosis-cases.e2e.mjs` uses the answers of four cases (a tapas bar, a physio clinic, a hair salon and a booking software), written by `test/e2e/diagnosis-cases.gen.ts` from the server's own `runPlanner`: the rules are the real ones, and only the model's answers are fixed in that file. Regenerate the fixture after changing a rule (`npx tsx test/e2e/diagnosis-cases.gen.ts`, from `server/`).

### "I don't know" in the four fixed questions

Each fixed question offers "I don't know" (clicked or typed); it counts as answered and Back can change it. The request then carries `unknown` (a list of `budget`, `experience`, `team`, `hours`) and needs no number for those keys; a number sent for a flagged key is ignored and the lowest of its range is kept as a placeholder. Every reader checks the flag (`isUnknown` in `server/planner/planner-handler.ts`): the models see `unknown`, the question limit takes no signal from it, the coherence checks that need it are not asked (`budget_fit`, `team_fit` with team or hours, `experience_fit`), so no warning or plan task comes from them, `departmentLevel` falls back to the groups, the "fits" sentence of the budget is emptied, and the page shows no budget mark and no "You offer" line. With nothing flagged everything works as before.

## Accounts and sessions

Sign-up, sign-in and sign-out are real. There is no email verification and no password recovery yet, and the "Forgot password?" link and the Google buttons do nothing (see the limitations). Each route takes a JSON body with exactly the fields listed, and every error is `{ "error": "...", "code": "..." }` with a fixed text.

| Route | Body | Answer |
| --- | --- | --- |
| `POST /api/auth/register` | `{ name, email, password }` | `201 { "user": { "name": "..." } }`, and the session cookie. The person is signed in at once. `409 email_taken` if the email is used. `400` with `invalid_name`, `invalid_email` or `invalid_password`. |
| `POST /api/auth/login` | `{ email, password }` | `200 { "user": { "name": "..." } }`, and the cookie. A wrong password and an unknown email get the same `401 invalid_credentials`. After 10 failed sign-ins for one email in 15 minutes, that email gets `429 too_many_attempts` for the rest of the window, even with the right password. |
| `POST /api/auth/logout` | none | `204`, and the cookie is cleared. |
| `GET /api/auth/session` | none | `200 { "user": { "name": "..." } }`, or `{ "user": null }`. It never answers `401`. |

Rules:

- Name: 2 to 100 characters. Password: 8 to 64 characters, with no control characters. Email: at most 254 characters, stored in lower case.
- Without a session, `/api/planner`, `/api/plan` and `/api/dev/` answer `401 unauthenticated`. The pages stay public.
- Each person sees only their own plans, reports and analysis jobs. Someone else's is `404`, the same as one that does not exist.
- The failed-sign-in count lives in memory: it starts again when the server restarts, and it is not shared between servers.
- Migration 005 adds the `sessions` table. Expired sessions are removed when they are found, and at each sign-in.
- Before accounts existed, every plan and report belonged to a provisional user (migration 004). `npm run create-test-user` moves them to a new user and removes the provisional one (see Scripts).

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
| `unknown` | array | Optional. Distinct keys among `budget`, `experience`, `team`, `hours` answered "I don't know". Those numbers are then not required, and ignored if sent. |
| `analysis` | object | Optional. Phase 2 claims (`subsector`, `location`, `target_customer`, `value_proposition`, `revenue_model`, `stage`, `competition`). Text is trimmed and cut to 300 characters; `unknown` and empty values are dropped. |

The request body is limited to about 100,000 characters.

Response `202` (the job has started; the analysis is not ready yet):

```json
{ "jobId": "3f9c1e2a-5b7d-4c8e-9a1f-0d2b6e7c8a90" }
```

### `GET /api/report-templates`

Returns the catalog of starter templates the report offers: `{ "templates": [{ "id", "title", "purpose", "body" }] }`. It needs a signed-in session (`401` without one) and reads no table. The response is never cached (`Cache-Control: no-store`). The catalog is the same for everyone; the planner picks from its ids and never writes their text.

### `POST /api/planner/detect`

Detects the fixed answers from the business description: `{ "idea": "..." }` in, `{ "detected": { "location", "budget", "start_mode", "premises" }, "jevToken" }` out. One call to Jev (`server/planner/detect.ts`) answers the planner's three questions and the fixed ones it can read from the text. Each value is checked: `budget` must fall in a band the text has an amount for, `start_mode` and `premises` must be one of their closed values, and `location` is only ever `"online"`, for an online or global scope: a city is not detected, so the location question is asked. The Jev result is kept in memory for 15 minutes, bound to the user and to the idea (`server/planner/detect-cache.ts`), and `jevToken` names it. The first `POST /api/planner` sends that token in `jevToken` and reuses the result instead of asking Jev again. A failure, or more than 10 s, gives no token and keeps only what the text gives without Jev: `budget` when the description writes exactly one amount in euros ("30.000 €", "€30,000", "40k euros"), as written; the rest is null. It needs a signed-in session (`401` without one), and it is checked like `POST /api/planner` for the origin and the body size.

**Timing.** The detection's time with the real Jev and the previous prefill's time have not been measured here: the environment has no Jev key.

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
    "phase2": { "maturity": "developing", "subsector": { }, "questions": [ { "topic": "partners", "question": "...", "options": [] } ] },
    "questionTotal": 3
  }
  ```

- **Final** (`final: true`): the Jev result and the report. **Not final** (the first request): the Jev result, `phase2` with the questions (possibly `questions: []`), `questionTotal` and the glance, and no report: the browser then shows what was understood, and the final request builds the report. When the model gave usable parts, the result also has `explanations`, with only the parts that passed: `warningReasons` (`[{ "key", "reason" }]`), `areaReasons` (`[{ "name", "reason" }]`), `timeToOpen` (`{ "min", "max", "unit": "weeks" | "months", "confidence": "low" | "medium" | "high" }`), `costBreakdown` (`[{ "label", "percent" }]`) and `templates` (three catalog ids). Without any of them the key is absent.

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
| `401` | `{ "error": "Log in to continue", "code": "unauthenticated" }`: there is no session. No job is started. |
| `403` | `{ "error": "Forbidden origin", "code": "forbidden_origin" }`: a `POST` from another site. |
| `429` | `too_many_attempts` on sign-in (see Accounts and sessions). |
| `503` | The job store is full. Try again shortly. No job is started. Without `DATABASE_URL`, `storage_unavailable`. |
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

The order relations of a department join a NEW task of its own with another new task, or with one of the tasks it already has (`<own_tasks>`, by its id). Two tasks it already has are never joined by an answer (`relation_existing_only`), and a task of another department is refused (`relation_ref`). The rules of the whole plan still apply (no loop, the phases in order), and the relation is checked again when the person accepts. A relation to a gap of the department (a placeholder task) is accepted by the same rule; that case is not covered by a test yet.

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

The order is the same on the planner and the plan routes: the body is read (`413` if too large); then the session (`401` without one, when there is a database); then the body is checked (`400`, with or without a database); then the storage (`503` without `DATABASE_URL`).

## Project layout

```
index.html              Single page: hero, idea form, sliders, question popup, result view
script.js               Front-end logic: form, question flow, API calls, dialogs
styles.css              Styles
tech-text.js            Animated text loader used while the request runs
fonts/                  Inter and Open Sans (woff2) with their licenses
server/
  server.ts             HTTP server: static files, the cookie, the origin check, and the routing of the API
  auth/                 Accounts and sessions: sign-up, sign-in, sign-out (auth-routes.ts, a pure function), scrypt passwords, the session cookie and its hash, the failed-sign-in limit, and the session and session storage (memory and PostgreSQL)
  jobs.ts               In-memory job store: runs the planner in the background
  request.ts            Body reading, validation and limits for the planner request
  plan-routes.ts        Plan API as a pure function: routes, status codes, development routes, facts and proposals
  plan/                 Plan model, rules, checks, derived values, and the plan and report repositories; the report's glance (glance.ts) and the sizes of the report (report-limits.ts)
  plan/plan-structure.ts  The plan structure: applied to a copy, proposed, and applied when accepted
  plan/agents/department-input.ts  The input of one department call, built from confirmed things and its own parts only
  plan/agents/department-suggestion.ts  The tasks of all departments: the calls, the review, the notes and the deadline
  plan/agents/          Agent contracts by level (plan, department, task, step), the shared pipeline and the real model adapters (OpenAI, Jev), and the agents built from the environment
  scripts/              Manual scripts that use the real model (not run by the tests)
  eval/                 Evaluation of the agents: fixed cases, the levels mode (levels.ts) and the chain mode (chain.ts), the fixed synthetic inputs of the review and of the tasks level (synthetic.ts), the call budget, the recording and replay (record.ts) and the reports (npm run agents:eval)
  db/                   PostgreSQL: migrations (SQL files and their runner), plan, report and user repositories, and maintenance/ (SQL and one script that moves the provisional user's data, run by hand)
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
  test/auth/            Tests for the passwords, the cookie, the limit, the routes, the session store and the server's sign-in
  test/e2e/             Browser checks of "Build my plan", of the top of the report (result-glance.e2e.mjs), of the Decisions page and of the sign-in dialogs (npm run test:e2e; the last one needs TEST_DATABASE_URL)
  test/jobs.test.ts     Tests for the job store (expiry, limits, errors)
  package.json          Scripts and dev dependencies
  tsconfig.json         TypeScript settings (type-check only)
  .env.example          Environment variables to copy to .env
```

## Known limitations

- **Sign-in is partial.** Sign-up, sign-in, sign-out and the session work (see Accounts and sessions). Still missing: password recovery, email verification, sign-in with Google (the buttons and the "Forgot password?" link are shown but do nothing), and a failed-sign-in limit shared between servers (today it is in memory). See `PRODUCTION.md`.
- **No rate limiting and no cost protection.** Every planner request calls paid APIs: a first request makes one Jev call (none when the detection's result is reused) and one OpenAI call; the final request makes three Jev calls. Add rate limits and spending controls before deploying.
- **Placeholders in the UI.** "View my projects" only shows a notice.
- **The levels of the agents are connected one by one, by hand.** The plan level (`agents/structure`), the department level (`agents/departments`), the steps of one task (`agents/tasks/:taskId/steps`) and the run of an AI step (`agents/steps/:stepId/run`) call a model, each only when the person presses its button. The views "Today", a side panel and a dependency diagram are not built: their design is not decided. The document of a step is kept only in its latest output (see above); the document goes to its own table later (see `FUTURE.md`).
- **Each suggestion costs money and waits.** A structure suggestion calls OpenAI and Jev up to three times each, and it is only made when the person presses "Suggest plan structure" (never when the page opens). Its worst wait is about three times (60 s for OpenAI plus 30 s for Jev), that is about 270 s, close to the 300 s request timeout Node uses by default. It is synchronous for now; a background job would be the fix if the waits grow. Only one structure can wait at a time.
- **A structure is not re-checked against the facts it was made from.** If a fact changes after the suggestion, the structure stays pending and is still accepted if it fits the plan, unlike the tasks of a gap (they are marked obsolete).
- **Suggestions only from templates.** A gap is expanded only for the `mobile_game` and `web_app` product types. Other values answer `needs_ai` until the AI is built. A rejected suggestion can be asked again: the new one takes the next free id (`-2`, `-3`...), up to 20 tries, and then `id_taken`. A pending suggestion whose decision has changed is marked obsolete (`derived.proposals[id].obsolete`). It stays listed, with the label Obsolete, until it is retired: the screen's Retire button calls `reject` (logged as `proposal_rejected`). Accepting it gives `409 not_confirmed`, and nothing removes a suggestion by itself.
- **The time to open and the cost split are estimates.** The model gives them without a source; the server checks their shape and limits only, not whether they are true. The cost split is in percentages, so the report never shows a money figure for it.
- **Uncalibrated thresholds.** The question limit (`POLICY` in `question-policy.ts`: 0 to 2 questions for the whole session) and the validation thresholds (`SUPPORT_MIN`, `CHECK_MIN`, `CORE_MIN`, `IMPORTANT_MIN` in `planner-validation-handler.ts`) are estimates and have not been tuned on real data.
- **Elapsed time ignores waits on other tasks.** A task's status counts the steps of other tasks (a task whose steps all wait on other tasks is blocked), but its elapsed time only counts the relations between its own steps.
- **Little stored state.** Reports and plans are saved only when `DATABASE_URL` is set. Jobs are kept only in memory: a server restart interrupts the analyses in progress, and the front end shows an interrupted message with Retry. The front end must send back the answers and the analysis claims for the final request.
- **The analysis claims come from the browser.** The final request takes the analysis claims (`analysis`) from the browser, as sent back, and the "Verify X" tasks of the saved report come from them. A person can change their own plan that way; no other user is affected. The claims are checked for shape, not for truth. See `PRODUCTION.md`.
- **The provisional user stays until it is moved.** Until `npm run create-test-user` is run, the plans and reports made before accounts existed belong to the provisional user, which nobody can sign in as. The server decides the user of each request in one place, `userOf` in `server/server.ts`, from the session cookie. See `PRODUCTION.md`.
- **A final request keeps a report without `phase2`.** The final request does not run phase 2 again, so its stored report has no `phase2` field; the report from the first round without questions has it.
