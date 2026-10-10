/**
 * The contract with whatever runs an AI step. The runner only receives what it may see
 * (buildRunnerInput) and only returns what passes RunnerOutputSchema (runStep); it never
 * touches the plan. Nothing here calls a model: the real runner is ModelStepRunner (agents/step-agent.ts).
 */

import { z } from "zod";
import { MAX_DOCUMENT_TEXT, MAX_STEP_TEXT, type Plan, type Step } from "./plan-model.js";
import { feedersOf } from "./step-graph.js";
import { readableOutput, roundsUsed } from "./step-rules.js";
import { type AgentContext, FactProposalSchema, MAX_FACT_PROPOSALS, MAX_REQUESTS, RequestSchema, type FactProposal, type Request } from "./agents/contract.js";

// Unmeasured limits, tune with real runs. The first two must fit what an output can store.
/** the limit of questions a runner may return in one round. */
export const MAX_QUESTIONS_PER_ROUND = 5;
/** the limit of characters of one question a runner may return. */
export const MAX_QUESTION_LENGTH = 300;
// The limit of the document is the one an output can store (plan-model.ts)
export { MAX_DOCUMENT_TEXT };

/** What the runner is allowed to see: nothing but this, and only text */
/** what a runner receives for one step, and nothing else. */
export interface RunnerInput {
  step: { id: string; text: string; taskId: string; departmentId: string };
  /** The round within the current attempt: 1 for the first run, 2 after the first answers, and so on */
  round: number;
  /** Every question the person has answered so far, oldest first, across attempts (assumption: earlier attempts' answers still count) */
  answers: { version: number; question: string; answer: string }[];
  /** The confirmed output of each step that feeds this one */
  feeds: { stepId: string; stepText: string; version: number; summary: string; documentRef?: string }[];
  /** Optional: the idea and the confirmed facts of the plan, the same context the other levels read */
  context?: AgentContext;
  /** Optional: the task the step belongs to */
  task?: { title: string };
  /** Optional: the department the step belongs to */
  department?: { name: string };
}

/** The optional parts of the input that the plan does not hold by itself: the idea (from the report) and the names */
export interface RunnerContext {
  context?: AgentContext;
  task?: { title: string };
  department?: { name: string };
}

/** The NUL character cannot be stored (see plan-model.ts): an answer with it is refused here, before it reaches the plan */
const noNul = <T extends z.ZodString>(schema: T) => schema.refine((value) => !value.includes("\u0000"), "NUL is not allowed");

/** the shape a runner's answer must have before it is used. */
export const RunnerOutputSchema = z.strictObject({
  summary: noNul(z.string().trim().min(1).max(MAX_STEP_TEXT)),
  document: noNul(z.string().trim().min(1).max(MAX_DOCUMENT_TEXT)),
  questions: z.array(noNul(z.string().trim().min(1).max(MAX_QUESTION_LENGTH))).max(MAX_QUESTIONS_PER_ROUND),
  /** Optional: facts the step proposes (kept as proposed until the person confirms them) */
  facts: z.array(FactProposalSchema).max(MAX_FACT_PROPOSALS).optional(),
  /** Optional: requests to the plan level or to a department */
  requests: z.array(RequestSchema).max(MAX_REQUESTS).optional(),
});

/** the type of an answer that passed RunnerOutputSchema. */
export type RunnerOutput = z.infer<typeof RunnerOutputSchema>;
export type { FactProposal, Request };

/** the interface that a real runner implements. */
export interface StepRunner {
  run(input: RunnerInput): Promise<RunnerOutput>;
}

/** the result of running one step: an accepted answer or a refusal. */
export type RunStepResult =
  | { ok: true; output: RunnerOutput }
  | { ok: false; code: "runner_failed" | "invalid_output" };

/**
 * Gathers what the AI may see for an AI step, or undefined for any other step. Only the
 * confirmed current output of a feeding step is included: never a draft, a rejected
 * version or a replaced one. The step's own earlier outputs are not included either;
 * the person's answers carry what the next round needs.
 * the input of a step, without the rest of the plan.
 */
export function buildRunnerInput(step: Step, steps: readonly Step[], relations: Plan["relations"], extra: RunnerContext = {}): RunnerInput | undefined {
  if (step.executor !== "ai") return undefined;
  const outputs = step.outputs ?? [];
  return {
    ...extra,
    step: { id: step.id, text: step.text, taskId: step.taskId, departmentId: step.departmentId },
    round: roundsUsed(step) + 1,
    answers: outputs.flatMap((output) =>
      output.questions.flatMap((question) =>
        question.answer === undefined ? [] : [{ version: output.version, question: question.question, answer: question.answer }],
      ),
    ),
    feeds: feedersOf(step, steps, relations).flatMap((feeder) => {
      const confirmed = readableOutput(feeder);
      if (!confirmed) return [];
      return [
        {
          stepId: feeder.id,
          stepText: feeder.text,
          version: confirmed.version,
          summary: confirmed.summary,
          ...(confirmed.documentRef !== undefined && { documentRef: confirmed.documentRef }),
        },
      ];
    }),
  };
}

/** Runs the step and accepts only an output that fits the schema. The error never carries content. */
/** runs a runner on a step and checks its answer. */
export async function runStep(runner: StepRunner, input: RunnerInput): Promise<RunStepResult> {
  let raw: unknown;
  try {
    raw = await runner.run(input);
  } catch {
    return { ok: false, code: "runner_failed" };
  }
  const parsed = RunnerOutputSchema.safeParse(raw);
  return parsed.success ? { ok: true, output: parsed.data } : { ok: false, code: "invalid_output" };
}
