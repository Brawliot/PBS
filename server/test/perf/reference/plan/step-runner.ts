/**
 * The contract with whatever runs an AI step. The runner only receives what it may see
 * (buildRunnerInput) and only returns what passes RunnerOutputSchema (runStep); it never
 * touches the plan. Nothing here calls a model: a real runner implements StepRunner elsewhere.
 */

import { z } from "zod";
import { MAX_OUTPUT_QUESTIONS, MAX_STEP_TEXT, type Plan, type Step } from "./plan-model.js";
import { feedersOf } from "./step-graph.js";
import { readableOutput, roundsUsed } from "./step-rules.js";

// Unmeasured limits, tune with real runs. The first two must fit what an output can store.
export const MAX_QUESTIONS_PER_ROUND = 5;
export const MAX_QUESTION_LENGTH = 300;
export const MAX_DOCUMENT_TEXT = 20_000;

/** What the runner is allowed to see: nothing but this, and only text */
export interface RunnerInput {
  step: { id: string; text: string; taskId: string; departmentId: string };
  /** The round within the current attempt: 1 for the first run, 2 after the first answers, and so on */
  round: number;
  /** Every question the person has answered so far, oldest first, across attempts (assumption: earlier attempts' answers still count) */
  answers: { version: number; question: string; answer: string }[];
  /** The confirmed output of each step that feeds this one */
  feeds: { stepId: string; stepText: string; version: number; summary: string; documentRef?: string }[];
}

export const RunnerOutputSchema = z.strictObject({
  summary: z.string().trim().min(1).max(MAX_STEP_TEXT),
  document: z.string().trim().min(1).max(MAX_DOCUMENT_TEXT),
  questions: z.array(z.string().trim().min(1).max(MAX_QUESTION_LENGTH)).max(MAX_QUESTIONS_PER_ROUND),
});

export type RunnerOutput = z.infer<typeof RunnerOutputSchema>;

export interface StepRunner {
  run(input: RunnerInput): Promise<RunnerOutput>;
}

export type RunStepResult =
  | { ok: true; output: RunnerOutput }
  | { ok: false; code: "runner_failed" | "invalid_output" };

/**
 * Gathers what the AI may see for an AI step, or undefined for any other step. Only the
 * confirmed current output of a feeding step is included: never a draft, a rejected
 * version or a replaced one. The step's own earlier outputs are not included either;
 * the person's answers carry what the next round needs.
 */
export function buildRunnerInput(step: Step, steps: readonly Step[], relations: Plan["relations"]): RunnerInput | undefined {
  if (step.executor !== "ai") return undefined;
  const outputs = step.outputs ?? [];
  return {
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
