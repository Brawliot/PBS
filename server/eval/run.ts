/**
 * The evaluation run: reads the settings, checks them, prints what it is about to do, runs the cases through the real
 * levels, and writes the reports. Nothing here reads a key or calls a provider by itself: the agents come in through
 * `makeAgents`, and only once the run is allowed to go ahead. Without AGENTS_EVAL=1 it prints one line and stops, before
 * any client exists and before any file is written.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AgentDeps, MAX_AGENT_ATTEMPTS } from "../plan/agents/contract.js";
import { buildPlanSkeleton } from "../plan/plan-skeleton.js";
import { createBudget, withBudget } from "./budget.js";
import { type CallLogEntry, type CaseRun, type ChainDeps, runCase } from "./chain.js";
import { CASES, type EvalCase } from "./cases.js";
import { type CaseReport, type Prices, caseJson, caseMarkdown, summaryMarkdown, totalsOf } from "./report.js";

export const REQUIRED_ENV = ["OPENAI_API_KEY", "OPENAI_MODEL", "TYPESAFE_API_KEY", "JEV_MODEL"] as const;
export const PRICE_ENV = ["EVAL_PRICE_OPENAI_IN", "EVAL_PRICE_OPENAI_OUT", "EVAL_PRICE_JEV_IN", "EVAL_PRICE_JEV_OUT"] as const;

/** Tasks the steps level takes per case, when EVAL_TASKS is not set */
export const DEFAULT_TASKS = 2;
export const MAX_TASKS = 5;
/** Calls the default cap allows per case (model and Jev together). EVAL_MAX_CALLS replaces the total */
export const CALLS_PER_CASE = 100;
export const MAX_REPEAT = 3;

/** The model calls each level makes apart from the departments and the tasks (one each) */
export const FIXED_MODEL_CALLS = { plan: 1, review: 1, step: 1 } as const;

/**
 * The calls of one case, before it runs: the model calls (plan, one per department, review, one per task, step), and
 * the calls including Jev (each model call is followed by one Jev call). The maximum assumes every attempt is used.
 */
export function estimateCase(departments: number, tasks: number): { modelCalls: number; min: number; max: number } {
  const modelCalls = FIXED_MODEL_CALLS.plan + departments + FIXED_MODEL_CALLS.review + tasks + FIXED_MODEL_CALLS.step;
  return { modelCalls, min: modelCalls * 2, max: modelCalls * MAX_AGENT_ATTEMPTS * 2 };
}

export interface EvalOptions {
  env: Record<string, string | undefined>;
  argv: string[];
  now: () => string;
  /** Milliseconds, from a monotonic clock */
  clock: () => number;
  /** The real agents, with each adapter call reported to `record`. Called only when the run is allowed to go ahead */
  makeAgents: (record: (entry: CallLogEntry) => void) => AgentDeps;
  outputDir: string;
  print: (line: string) => void;
  /** The cases to choose from. The defined ones when omitted */
  cases?: EvalCase[];
}

export interface Arguments {
  cases: EvalCase[];
  repeat: number;
}

/** The command line: --case <id> (one case, the default: restaurant), --all, --repeat <n> (1 to 3) */
export function parseArguments(argv: string[], cases: EvalCase[]): Arguments | string {
  let chosen: EvalCase[] = [cases.find((item) => item.id === "restaurant") ?? cases[0]];
  let repeat = 1;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--all") chosen = cases;
    else if (arg === "--case") {
      const id = argv[++index];
      const found = cases.find((item) => item.id === id);
      if (!found) return `Unknown case "${id ?? ""}". The cases are: ${cases.map((item) => item.id).join(", ")}.`;
      chosen = [found];
    } else if (arg === "--repeat") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > MAX_REPEAT) return `--repeat takes a whole number from 1 to ${MAX_REPEAT}.`;
      repeat = value;
    } else return `Unknown option "${arg}". Use --case <id>, --all or --repeat <n>.`;
  }
  return { cases: chosen, repeat };
}

/** A whole number from the environment, or the default when it is not set. Undefined when it is set and not valid */
function wholeNumber(value: string | undefined, fallback: number | undefined, max: number): number | undefined {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= max ? number : undefined;
}

/** The prices, only when all four are numbers from zero up. Otherwise no cost is computed, and the missing names are listed */
export function pricesOf(env: Record<string, string | undefined>): { prices?: Prices; incomplete: string[] } {
  const value = (name: string): number | undefined => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return undefined;
    const number = Number(raw);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  };
  const found = PRICE_ENV.map((name) => [name, value(name)] as const);
  const incomplete = found.filter(([, number]) => number === undefined).map(([name]) => name);
  if (incomplete.length > 0) return { incomplete };
  const [openaiIn, openaiOut, jevIn, jevOut] = found.map(([, number]) => number as number);
  return { prices: { openaiIn, openaiOut, jevIn, jevOut }, incomplete: [] };
}

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

/** The file name of a run: the start time, the case, and the repetition when there are several */
const stampOf = (iso: string): string => iso.slice(0, 19).replace(/:/g, "-");

export async function runEvaluation(options: EvalOptions): Promise<number> {
  const { env, print } = options;
  if (env.AGENTS_EVAL !== "1") {
    print("Nothing sent. Set AGENTS_EVAL=1 to run the evaluation: it makes real calls to OpenAI and Jev, and they cost money.");
    return 0;
  }
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    print(`Missing in server/.env: ${missing.join(", ")}. Nothing sent.`);
    return 1;
  }

  const parsed = parseArguments(options.argv, options.cases ?? CASES);
  if (typeof parsed === "string") {
    print(parsed);
    return 1;
  }
  const tasks = wholeNumber(env.EVAL_TASKS, DEFAULT_TASKS, MAX_TASKS);
  if (tasks === undefined) {
    print(`EVAL_TASKS must be a whole number from 1 to ${MAX_TASKS}. Nothing sent.`);
    return 1;
  }
  const maxCalls = wholeNumber(env.EVAL_MAX_CALLS, undefined, Number.MAX_SAFE_INTEGER);
  if (env.EVAL_MAX_CALLS !== undefined && env.EVAL_MAX_CALLS !== "" && maxCalls === undefined) {
    print("EVAL_MAX_CALLS must be a whole number of 1 or more. Nothing sent.");
    return 1;
  }

  const { cases, repeat } = parsed;
  const estimates = cases.map((evalCase) => {
    const skeleton = buildPlanSkeleton(evalCase.report());
    const departments = skeleton.ok ? skeleton.plan.departments.length : 0;
    return { evalCase, departments, ...estimateCase(departments, tasks) };
  });
  const minimum = estimates.reduce((sum, item) => sum + item.min, 0) * repeat;
  const maximum = estimates.reduce((sum, item) => sum + item.max, 0) * repeat;
  const limit = maxCalls ?? CALLS_PER_CASE * cases.length * repeat;

  const { prices, incomplete } = pricesOf(env);
  const models = { openai: env.OPENAI_MODEL ?? "", jev: env.JEV_MODEL ?? "" };
  print(`Cases: ${cases.length} (${cases.map((item) => item.id).join(", ")}) · repetitions: ${repeat} · tasks per case: ${tasks}`);
  for (const item of estimates) {
    print(`  ${item.evalCase.id}: ${item.departments} departments, ${item.modelCalls} model calls, ${item.min}-${item.max} calls with Jev`);
  }
  print(`Estimated calls (model and Jev together): at least ${minimum}, at most ${maximum}.`);
  print(`Cap: ${limit} calls in total${maxCalls === undefined ? ` (${CALLS_PER_CASE} per case, EVAL_MAX_CALLS not set)` : " (EVAL_MAX_CALLS)"}. When it is reached, the run stops before the next call.`);
  if (minimum > limit) print("Warning: the cap is below the minimum estimate, so some cases will stop early.");
  print(`Models: OpenAI ${models.openai} · Jev ${models.jev}`);
  if (prices) print("Cost: estimated with the EVAL_PRICE_* prices.");
  else print(`Cost: not computed${incomplete.length < PRICE_ENV.length ? `. Missing or invalid: ${incomplete.join(", ")}` : " (no EVAL_PRICE_* prices set)"}.`);

  await mkdir(options.outputDir, { recursive: true });
  const calls: CallLogEntry[] = [];
  const agents = options.makeAgents((entry) => calls.push(entry));
  const startedAt = options.now();
  const stamp = stampOf(startedAt);
  const reports: CaseReport[] = [];
  const notRun: string[] = [];
  let used = 0;

  for (let repetition = 1; repetition <= repeat; repetition++) {
    for (const evalCase of cases) {
      const name = repeat > 1 ? `${evalCase.id}-r${repetition}` : evalCase.id;
      const remaining = limit - used;
      if (remaining <= 0) {
        notRun.push(name);
        continue;
      }
      const budget = createBudget(remaining);
      const deps: ChainDeps = { agents: withBudget(agents, budget), budget, calls, now: options.now, clock: options.clock, taskCount: tasks };
      const run: CaseRun = await runCase(evalCase, deps);
      used += budget.used;

      const report: CaseReport = {
        run,
        info: { startedAt, models, repetition, repetitions: repeat },
        budget: { limit: remaining, used: budget.used, exhausted: budget.exhausted },
        totals: totalsOf(run.levels),
      };
      reports.push(report);
      const base = join(options.outputDir, `${stamp}-${name}`);
      await writeFile(`${base}.json`, caseJson(report, prices));
      await writeFile(`${base}.md`, caseMarkdown(report, prices));

      const stopped = run.stoppedBy === undefined ? "reached the last level" : `stopped with ${run.stoppedBy}`;
      print(`${name}: ${stopped} · ${report.totals.modelCalls} model calls, ${report.totals.judgeCalls} Jev calls · ${seconds(report.totals.ms)} s`);
      print(`  written: ${base}.md and .json`);
    }
  }

  const summary = summaryMarkdown(reports, notRun, prices, { startedAt, models, limit, used, exhausted: used >= limit });
  await writeFile(join(options.outputDir, `${stamp}-resumen.md`), summary);
  print(`Total: ${used} of ${limit} calls. Summary: ${join(options.outputDir, `${stamp}-resumen.md`)}`);
  if (notRun.length > 0) print(`Not run, the cap was used up: ${notRun.join(", ")}`);
  return 0;
}
