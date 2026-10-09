/**
 * The agents of the plan level, built from the environment: the same keys as the planner (OPENAI_* for the model,
 * TYPESAFE_API_KEY and JEV_MODEL for the judge). Undefined when one of them is missing: the agent routes then answer
 * 503 (assistant_unavailable) and no call is made.
 */

import type { AgentDeps } from "./contract.js";
import { jevJudge } from "./jev-judge.js";
import { openAIModel } from "./openai-model.js";

export function agentsFromEnv(env: Record<string, string | undefined>): AgentDeps | undefined {
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL || !env.TYPESAFE_API_KEY || !env.JEV_MODEL) return undefined;
  return { model: openAIModel(), judge: jevJudge() };
}
