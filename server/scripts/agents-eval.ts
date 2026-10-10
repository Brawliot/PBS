/**
 * The manual evaluation of the agents (FUTURE.md, "Evaluación de modelos"). It runs the real agents on fixed test
 * ideas and writes the reports to server/eval-output/. It makes REAL calls to OpenAI and Jev, and they cost money:
 *
 *   AGENTS_EVAL=1 npm run agents:eval -- --case restaurant
 *   AGENTS_EVAL=1 npm run agents:eval -- --all
 *
 * Without AGENTS_EVAL=1 it sends nothing. The logic lives in eval/run.ts; this file only wires the real adapters.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jevJudge } from "../plan/agents/jev-judge.js";
import { openAIModel } from "../plan/agents/openai-model.js";
import { runEvaluation } from "../eval/run.js";

const here = dirname(fileURLToPath(import.meta.url));

runEvaluation({
  env: process.env,
  argv: process.argv.slice(2),
  now: () => new Date().toISOString(),
  clock: () => performance.now(),
  makeAgents: (record, failed) => ({
    model: openAIModel({ onCall: (call) => record({ kind: "model", ...call }) }),
    judge: jevJudge({ onCall: (call) => record({ kind: "judge", ...call }) }),
    onFailure: failed,
  }),
  outputDir: join(here, "..", "eval-output"),
  print: (line) => console.log(line),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Only the error's name: a message may hold a value from a provider
    console.log(`Failed: ${error instanceof Error ? error.name : "unknown error"}`);
    process.exitCode = 1;
  },
);
