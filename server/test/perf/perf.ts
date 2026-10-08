/**
 * Benchmark of the plan rules on synthetic plans. Run with `npm run perf`; it is not part of `npm test`.
 * Each figure is the median of RUNS runs, in milliseconds, with the plan built before the timer starts.
 */

import { performance } from "node:perf_hooks";
import { checkPlan } from "../../plan/plan-check.js";
import { parsePlan, type Plan } from "../../plan/plan-model.js";
import { derivePlan } from "../../plan/plan-derived.js";
import { applyPlanAction } from "../../plan/plan-actions.js";
import { BENCH_SIZES, syntheticPlan } from "./generate.js";

const RUNS = 3;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function time(run: () => unknown): number {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

const rows: string[] = ["| size | tasks | steps | parsePlan | checkPlan | derivePlan | applyPlanAction |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"];
for (const [name, size] of Object.entries(BENCH_SIZES)) {
  const plan: Plan = syntheticPlan(size);
  const json = JSON.parse(JSON.stringify(plan));
  const first = plan.steps[0];
  const action = () => applyPlanAction(plan, first.id, "launch", { now: () => "2026-10-08T10:00:00Z", actor: "user" });
  const numbers = [
    time(() => parsePlan(json)),
    time(() => checkPlan(plan)),
    time(() => derivePlan(plan)),
    time(action),
  ].map((ms) => ms.toFixed(1));
  rows.push(`| ${name} | ${size.tasks} | ${size.steps} | ${numbers.join(" | ")} |`);
}
console.log(rows.join("\n"));
