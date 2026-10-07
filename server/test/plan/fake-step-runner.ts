import type { RunnerInput, RunnerOutput, StepRunner } from "../../plan/step-runner.js";

/**
 * A runner for tests: the same input always gives the same output, and every call is kept.
 * `questionsByRound[0]` are the questions asked on round 1, and so on. `script` replaces the
 * answer completely, to test what happens with an output that is not valid.
 */
export class FakeStepRunner implements StepRunner {
  readonly calls: RunnerInput[] = [];

  constructor(
    private readonly options: { questionsByRound?: string[][]; script?: (input: RunnerInput) => unknown } = {},
  ) {}

  async run(input: RunnerInput): Promise<RunnerOutput> {
    this.calls.push(structuredClone(input));
    if (this.options.script) return this.options.script(input) as RunnerOutput;
    return {
      summary: `Round ${input.round}: ${input.step.text}`,
      document: [
        input.step.text,
        ...input.answers.map((a) => `${a.question} -> ${a.answer}`),
        ...input.feeds.map((f) => `${f.stepText}: ${f.summary}`),
      ].join("\n"),
      questions: this.options.questionsByRound?.[input.round - 1] ?? [],
    };
  }
}
