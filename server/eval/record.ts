/**
 * Recording and replay of an evaluation (off by default). EVAL_RECORD=1 keeps, for every call to the model and to Jev,
 * what the call answered: the role and the answer of the model, or the verdict of Jev. Never the prompt, a key, a header
 * or a status body: the line is written from the answer alone (recordDeps). The recordings live in
 * server/eval-output/recordings/<run>/, which git ignores (eval-output/ in .gitignore). Nothing is uploaded.
 *
 * `--replay <folder>` runs the evaluation again from those recordings: no network, no key, no client is built. The
 * model answers each call with the next recorded answer of its role, in the order it was recorded. Jev answers with the
 * recorded verdicts in order. A call with nothing recorded fails the way a model error does, so a recording that does
 * not match the code shows up as a failure, never as a silent pass. With no verdict recorded at all, the replay runs
 * without Jev (the checks are "no comprobado", as with AGENTS_JEV unset).
 *
 * Order caveat: the departments run in parallel, so the verdicts of Jev can come back in another order than they were
 * recorded. Verdicts are only ever read as yes or no, so this changes which call a verdict belongs to, not the count.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDeps, AgentModel, RelevanceJudge } from "../plan/agents/contract.js";

/** One line of a recording. Model lines carry the answer or an error flag; judge lines the verdict or an error flag */
export type RecordLine = { kind: "model"; role: string; answer: unknown } | { kind: "model"; role: string; error: true } | { kind: "judge"; verdict: boolean } | { kind: "judge"; error: true };

/**
 * The same dependencies, with each call written to `write` after it is answered. The line is built from the role and the
 * answer (or the error flag) only: the prompt of the request never reaches it.
 */
export function recordDeps(deps: AgentDeps, write: (line: RecordLine) => void): AgentDeps {
  const model: AgentModel = {
    async complete(request) {
      try {
        const answer = await deps.model.complete(request);
        write({ kind: "model", role: request.role, answer });
        return answer;
      } catch (error) {
        write({ kind: "model", role: request.role, error: true });
        throw error;
      }
    },
  };
  const inner = deps.judge;
  const judge: RelevanceJudge | null =
    inner === null
      ? null
      : {
          async judge(idea, proposed) {
            try {
              const verdict = await inner.judge(idea, proposed);
              write({ kind: "judge", verdict });
              return verdict;
            } catch (error) {
              write({ kind: "judge", error: true });
              throw error;
            }
          },
        };
  return { ...deps, model, judge };
}

/** The writer of one case's recording: one JSON line per call, appended to <folder>/<name>.jsonl */
export function recordingWriter(folder: string, name: string): (line: RecordLine) => void {
  const file = join(folder, `${name}.jsonl`);
  return (line) => appendFileSync(file, `${JSON.stringify(line)}\n`);
}

/** What a recording holds, read once: the answers of each role in order, and the verdicts of Jev in order */
export interface Recording {
  models: Map<string, ({ answer: unknown } | { error: true })[]>;
  verdicts: (boolean | "error")[];
}

/** The lines of one recording file. A line that does not parse is skipped: it can only be a truncated write */
export function readRecording(file: string): Recording {
  const recording: Recording = { models: new Map(), verdicts: [] };
  if (!existsSync(file)) return recording;
  for (const text of readFileSync(file, "utf8").split("\n")) {
    if (text.trim() === "") continue;
    let line: RecordLine;
    try {
      line = JSON.parse(text) as RecordLine;
    } catch {
      continue;
    }
    if (line.kind === "model") {
      const list = recording.models.get(line.role) ?? [];
      list.push("error" in line ? { error: true } : { answer: line.answer });
      recording.models.set(line.role, list);
    } else if ("error" in line) recording.verdicts.push("error");
    else recording.verdicts.push(line.verdict);
  }
  return recording;
}

/** The dependencies that answer from a recording: no client, no network. Calls past the recording fail like a model error */
export function replayDeps(recording: Recording): AgentDeps {
  const queues = new Map(recording.models);
  const model: AgentModel = {
    async complete(request) {
      const next = queues.get(request.role)?.shift();
      if (next === undefined) throw new Error("no recorded answer for this call");
      if ("error" in next) throw new Error("the recorded call failed");
      return structuredClone(next.answer);
    },
  };
  const verdicts = [...recording.verdicts];
  const judge: RelevanceJudge | null =
    verdicts.length === 0
      ? null
      : {
          async judge() {
            const verdict = verdicts.shift();
            if (verdict === undefined) throw new Error("no recorded verdict for this call");
            if (verdict === "error") throw new Error("the recorded verdict was unavailable");
            return verdict;
          },
        };
  return { model, judge };
}
