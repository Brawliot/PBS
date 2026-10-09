/**
 * Manual check of the PLAN level with the real model. NOT run by the tests, and it does nothing unless you ask:
 *
 *   AGENTS_REAL=1 npm run agents:real-plan
 *   AGENTS_REAL=1 AGENTS_JEV=1 npm run agents:real-plan     (also asks Jev about relevance)
 *
 * It makes exactly ONE OpenAI call (one attempt, no retries) on the restaurant plan, and prints the outcome.
 * It never prints the prompt, the answer's raw text or any key. Needs OPENAI_API_KEY and OPENAI_MODEL in server/.env.
 */

import { restaurantPlan } from "../plan/demo-plan.js";
import { contextOf } from "../plan/agents/contract.js";
import { runPlanGenerate } from "../plan/agents/plan-agent.js";
import { openAIModel } from "../plan/agents/openai-model.js";
import { jevJudge } from "../plan/agents/jev-judge.js";

const IDEA = "A Japanese restaurant with delivery in my neighbourhood, run by two people, with a small budget";

async function main(): Promise<void> {
  if (process.env.AGENTS_REAL !== "1") {
    console.log("Nothing sent. Set AGENTS_REAL=1 to make one real OpenAI call.");
    return;
  }
  const useJev = process.env.AGENTS_JEV === "1";
  const base = restaurantPlan();
  const context = contextOf(IDEA, base);

  console.log(`Calls: 1 OpenAI, ${useJev ? "1 Jev (relevance)" : "no Jev (set AGENTS_JEV=1 to check relevance)"}`);
  const result = await runPlanGenerate({ model: openAIModel(), judge: useJev ? jevJudge() : null, attempts: 1 }, context, base);

  if (!result.ok) {
    console.log(`Result: refused (${result.code})`);
    process.exitCode = 1;
    return;
  }
  const { output, checked } = result.value;
  console.log(`Result: accepted by the schema and by checkPlan. Jev checked: ${checked ? "yes" : "no"}`);
  console.log(`Phases: ${output.phases.map((phase) => phase.name).join(", ")}`);
  console.log(`Tiers: ${output.tiers.map((item) => `${item.departmentId}=${item.tier}`).join(", ")}`);
  console.log(`Department relations: ${output.relations.length}`);
  console.log(`Facts proposed: ${output.facts.length}, requests: ${output.requests.length}, questions: ${output.questions.length}`);
}

main().catch((error: unknown) => {
  // Only the error's name: a message may hold a value from the provider
  console.log(`Failed: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exitCode = 1;
});
