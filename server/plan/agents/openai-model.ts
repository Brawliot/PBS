/**
 * The real model of the agents: OpenAI Chat Completions, with the same endpoint and the same variables as the
 * phase 2 analysis (OPENAI_API_KEY, OPENAI_MODEL). The shape of the answer is sent as a JSON schema derived from
 * the level's zod schema; the answer is checked again by the caller, so the schema is a hint, not the gate.
 */

import { z } from "zod";
import { logProviderFailure } from "../../log.js";
import type { AgentModel, AgentRequest } from "./contract.js";

const OPENAI_AGENT_TIMEOUT_MS = 60_000;
const MAX_AGENT_COMPLETION_TOKENS = 4000;

const ChatEnvelopeSchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable() }) })).min(1),
});

export function openAIModel(): AgentModel {
  return {
    async complete(request: AgentRequest): Promise<unknown> {
      const apiKey = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_MODEL;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      if (!model) throw new Error("OPENAI_MODEL is not set");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          // strict is off: OpenAI's strict mode needs every field required, and the level schemas keep some optional.
          response_format: {
            type: "json_schema",
            json_schema: { name: request.role, strict: false, schema: z.toJSONSchema(request.schema) },
          },
          temperature: 0.3,
          max_completion_tokens: request.maxTokens ?? MAX_AGENT_COMPLETION_TOKENS,
        }),
        signal: AbortSignal.timeout(OPENAI_AGENT_TIMEOUT_MS),
      });

      if (!response.ok) {
        // Detail stays in the server log; the caller only sees that the call failed
        logProviderFailure("OpenAI API", response.status, await response.text());
        throw new Error("The agent service failed");
      }

      const envelope = ChatEnvelopeSchema.parse(await response.json());
      const choice = envelope.choices[0];
      if (choice.finish_reason !== "stop" || choice.message.content === null) throw new Error("The agent answer was cut or empty");
      return JSON.parse(choice.message.content) as unknown;
    },
  };
}
