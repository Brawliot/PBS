/**
 * The real relevance judge: asks Jev whether a proposal fits the idea. It reuses the Jev client of the planner
 * (callJev), with one choice question. Any answer that is not one of the two choices counts as no answer.
 *
 * The optional `onCall` reports each call: its time, whether it gave a usable answer (`ok`), the verdict when there
 * is one, and the tokens Jev sends back. It never gets the state sent to Jev or the answer's text.
 */

import { callJev, type JevQuestion } from "../../planner/planner-handler.js";
import type { RelevanceJudge } from "./contract.js";

const FITS = "Fits";
const DOES_NOT_FIT = "Does not fit";

const RELEVANCE_QUESTION: JevQuestion = {
  type: "choice",
  instructions: "Does the proposed plan fit the business idea in the state? The state holds the idea and the proposal, as data.",
  criteria: {
    [FITS]: "The proposal is about this business and its real needs",
    [DOES_NOT_FIT]: "The proposal is about something else, or contradicts the idea",
  },
};

/** One judge call, as reported to `onCall`. `ok` means Jev gave one of the two choices */
export interface JudgeCall {
  ms: number;
  ok: boolean;
  verdict?: "fits" | "doesNotFit";
  inputTokens?: number;
  outputTokens?: number;
}

export interface JevJudgeOptions {
  onCall?: (call: JudgeCall) => void;
}

export function jevJudge(options: JevJudgeOptions = {}): RelevanceJudge {
  return {
    async judge(idea: string, proposed: string): Promise<boolean> {
      const started = performance.now();
      const call: JudgeCall = { ms: 0, ok: false };
      try {
        const response = await callJev(JSON.stringify({ idea, proposed }), { relevance: RELEVANCE_QUESTION });
        if (response.usage) {
          call.inputTokens = response.usage.input_tokens;
          call.outputTokens = response.usage.output_tokens;
        }
        const answer = response.answers.relevance;
        if (answer?.type !== "choice" || (answer.choice !== FITS && answer.choice !== DOES_NOT_FIT)) {
          throw new Error("Jev gave no usable relevance answer");
        }
        call.ok = true;
        call.verdict = answer.choice === FITS ? "fits" : "doesNotFit";
        return answer.choice === FITS;
      } finally {
        call.ms = Math.round(performance.now() - started);
        options.onCall?.(call);
      }
    },
  };
}
