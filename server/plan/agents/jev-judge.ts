/**
 * The real relevance judge: asks Jev whether a proposal fits the idea. It reuses the Jev client of the planner
 * (callJev), with one choice question. Any answer that is not one of the two choices counts as no answer.
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

export function jevJudge(): RelevanceJudge {
  return {
    async judge(idea: string, proposed: string): Promise<boolean> {
      const response = await callJev(JSON.stringify({ idea, proposed }), { relevance: RELEVANCE_QUESTION });
      const answer = response.answers.relevance;
      if (answer?.type !== "choice" || (answer.choice !== FITS && answer.choice !== DOES_NOT_FIT)) {
        throw new Error("Jev gave no usable relevance answer");
      }
      return answer.choice === FITS;
    },
  };
}
