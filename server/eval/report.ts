/**
 * The files of one evaluation: a JSON with every measure (`<stamp>-<case>.json`), a Markdown to read (`.md`), and a
 * summary of the whole run (`<stamp>-resumen.md`). Pure: the data goes in, the text comes out. The text holds numbers,
 * names, titles and the codes of the levels; never a prompt, a key, or what a model wrote beyond a title.
 *
 * Dollars: only when the four price variables are set (per million tokens). Without all four, no cost is written.
 */

import type { CaseRun, LevelRecord, Tokens } from "./chain.js";

export const HEURISTIC_NOTICE =
  "Las comprobaciones son HEURÍSTICAS (una expresión regular sobre los títulos de las tareas): detectan que falta un tema, no que el plan sea bueno. La dirección de las flechas entre departamentos y tareas no se puede comprobar de forma automática: léela una persona.";

export interface RunInfo {
  startedAt: string;
  /** The model names as the environment gives them: identifiers, not secrets */
  models: { openai: string; jev: string };
  repetition: number;
  repetitions: number;
}

export interface CaseBudget {
  /** The calls this case may make (what the run had left when it started) */
  limit: number;
  used: number;
  exhausted: boolean;
}

export interface Totals {
  modelCalls: number;
  judgeCalls: number;
  ms: number;
  tokens: { model: Tokens; judge: Tokens };
}

export interface Prices {
  /** Dollars per million tokens */
  openaiIn: number;
  openaiOut: number;
  jevIn: number;
  jevOut: number;
}

export interface CaseReport {
  run: CaseRun;
  info: RunInfo;
  budget: CaseBudget;
  totals: Totals;
}

const emptyTokens = (): Tokens => ({ input: 0, output: 0, missing: 0 });

/** The totals of a case: calls, time and tokens of its levels */
export function totalsOf(levels: LevelRecord[]): Totals {
  const sum = (pick: (level: LevelRecord) => number) => levels.reduce((total, level) => total + pick(level), 0);
  const tokens = (kind: "model" | "judge"): Tokens => {
    const result = emptyTokens();
    for (const level of levels) {
      result.input += level.tokens[kind].input;
      result.output += level.tokens[kind].output;
      result.missing += level.tokens[kind].missing;
    }
    return result;
  };
  return {
    modelCalls: sum((level) => level.modelCalls),
    judgeCalls: sum((level) => level.judgeCalls),
    ms: sum((level) => level.ms),
    tokens: { model: tokens("model"), judge: tokens("judge") },
  };
}

/** The estimated cost in dollars of a set of totals. Undefined unless the prices are all there */
export function costOf(totals: Totals, prices: Prices | undefined): number | undefined {
  if (prices === undefined) return undefined;
  const dollars =
    (totals.tokens.model.input * prices.openaiIn + totals.tokens.model.output * prices.openaiOut + totals.tokens.judge.input * prices.jevIn + totals.tokens.judge.output * prices.jevOut) /
    1_000_000;
  return dollars;
}

export const formatDollars = (value: number): string => `${value.toFixed(4)} USD`;

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

const tokenPair = (tokens: Tokens): string => `${tokens.input}/${tokens.output}${tokens.missing > 0 ? ` (${tokens.missing} sin dato)` : ""}`;

/** The counts of a level as one short text: the numbers that show what the level produced */
function countsText(level: LevelRecord): string {
  const parts = Object.entries(level.counts).map(([key, value]) => `${key} ${value}`);
  parts.push(`problemas nuevos ${level.newProblems}`);
  return parts.join(", ");
}

/** The JSON of one case: every measure, and the titles and relations, never a prompt or an answer */
export function caseJson(report: CaseReport, prices: Prices | undefined): string {
  const { run, info, budget, totals } = report;
  const cost = costOf(totals, prices);
  return `${JSON.stringify(
    {
      heuristic: true,
      notice: HEURISTIC_NOTICE,
      case: { id: run.caseId, label: run.label },
      run: info,
      budget,
      stoppedBy: run.stoppedBy ?? null,
      levels: run.levels,
      totals,
      ...(cost !== undefined && { costUsd: cost }),
      expectations: run.expectations ?? null,
      relations: run.relations,
      tasksByDepartment: run.tasksByDepartment,
    },
    null,
    2,
  )}\n`;
}

/** The Markdown of one case: a table per level, the totals, the heuristic checks, and the relations to read */
export function caseMarkdown(report: CaseReport, prices: Prices | undefined): string {
  const { run, info, budget, totals } = report;
  const lines: string[] = [];
  lines.push(`# ${run.label}`, "", `\`${run.caseId}\` · ${info.startedAt} · repetición ${info.repetition} de ${info.repetitions}`);
  lines.push(`Modelo OpenAI: \`${info.models.openai}\` · Modelo Jev: \`${info.models.jev}\``, "", `> ${HEURISTIC_NOTICE}`, "");

  lines.push("## Niveles", "");
  lines.push("| Nivel | Estado | Código | Llamadas al modelo | Llamadas a Jev | Veredictos de Jev | Tiempo (s) | Tokens modelo (entrada/salida) | Tokens Jev (entrada/salida) | Recuentos |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const level of run.levels) {
    lines.push(
      `| ${level.level} | ${level.ok ? "ok" : "fallo"} | ${level.code ?? "-"} | ${level.modelCalls} | ${level.judgeCalls} | ${level.verdicts.join(", ") || "-"} | ${seconds(level.ms)} | ${tokenPair(level.tokens.model)} | ${tokenPair(level.tokens.judge)} | ${countsText(level)} |`,
    );
  }
  lines.push("");

  lines.push("## Totales del caso", "");
  lines.push(`- Llamadas al modelo: ${totals.modelCalls} · llamadas a Jev: ${totals.judgeCalls} · tiempo: ${seconds(totals.ms)} s`);
  lines.push(`- Tokens modelo: ${tokenPair(totals.tokens.model)} · tokens Jev: ${tokenPair(totals.tokens.judge)}`);
  const cost = costOf(totals, prices);
  if (cost !== undefined) lines.push(`- Coste estimado: ${formatDollars(cost)}`);
  lines.push(`- Presupuesto del caso: ${budget.used} de ${budget.limit} llamadas${budget.exhausted ? " · PRESUPUESTO AGOTADO: el caso se detuvo" : ""}`);
  lines.push(`- Parada: ${run.stoppedBy ?? "ninguna (el caso llegó al último nivel)"}`, "");

  lines.push("## Comprobaciones (heurísticas)", "");
  if (run.expectations === undefined) lines.push("No evaluadas: el nivel de departamentos no terminó.");
  else for (const item of run.expectations) lines.push(`- ${item.passed ? "[cumple]" : "[no cumple]"} ${item.description}`);
  lines.push("");

  lines.push("## Relaciones (revisar la dirección)", "");
  lines.push("Entre departamentos:");
  lines.push(...(run.relations.departments.length > 0 ? run.relations.departments.map((text) => `- ${text}`) : ["- ninguna"]));
  lines.push("", "Entre tareas propuestas por la IA:");
  lines.push(...(run.relations.tasks.length > 0 ? run.relations.tasks.map((text) => `- ${text}`) : ["- ninguna"]));
  lines.push("");

  lines.push("## Tres primeros títulos por departamento", "");
  const departments = Object.entries(run.tasksByDepartment);
  if (departments.length === 0) lines.push("- ninguno");
  for (const [name, titles] of departments) {
    lines.push(`### ${name}`, ...titles.map((title) => `- ${title}`), "");
  }
  return `${lines.join("\n")}\n`;
}

/** The summary of the whole run: one line per case, the totals, the cost if it is known, and the cases not run */
export function summaryMarkdown(reports: CaseReport[], notRun: string[], prices: Prices | undefined, info: { startedAt: string; models: RunInfo["models"]; limit: number; used: number; exhausted: boolean }): string {
  const totals: Totals = {
    modelCalls: reports.reduce((sum, report) => sum + report.totals.modelCalls, 0),
    judgeCalls: reports.reduce((sum, report) => sum + report.totals.judgeCalls, 0),
    ms: reports.reduce((sum, report) => sum + report.totals.ms, 0),
    tokens: {
      model: sumTokens(reports.map((report) => report.totals.tokens.model)),
      judge: sumTokens(reports.map((report) => report.totals.tokens.judge)),
    },
  };
  const lines: string[] = [`# Resumen de la evaluación`, "", `${info.startedAt} · Modelo OpenAI: \`${info.models.openai}\` · Modelo Jev: \`${info.models.jev}\``, "", `> ${HEURISTIC_NOTICE}`, ""];
  lines.push("| Caso | Parada | Llamadas al modelo | Llamadas a Jev | Tiempo (s) | Comprobaciones que cumplen |", "| --- | --- | --- | --- | --- | --- |");
  for (const report of reports) {
    const checks = report.run.expectations;
    const passed = checks === undefined ? "no evaluadas" : `${checks.filter((item) => item.passed).length} de ${checks.length}`;
    lines.push(`| ${report.run.label} (repetición ${report.info.repetition}) | ${report.run.stoppedBy ?? "ninguna"} | ${report.totals.modelCalls} | ${report.totals.judgeCalls} | ${seconds(report.totals.ms)} | ${passed} |`);
  }
  lines.push("");
  lines.push(`- Totales: ${totals.modelCalls} llamadas al modelo, ${totals.judgeCalls} a Jev, ${seconds(totals.ms)} s.`);
  lines.push(`- Tokens modelo: ${tokenPair(totals.tokens.model)} · tokens Jev: ${tokenPair(totals.tokens.judge)}`);
  lines.push(`- Presupuesto de la ejecución: ${info.used} de ${info.limit} llamadas${info.exhausted ? " · PRESUPUESTO AGOTADO" : ""}`);
  if (notRun.length > 0) lines.push(`- No ejecutados por el presupuesto: ${notRun.join(", ")}`);
  const cost = costOf(totals, prices);
  if (cost !== undefined) lines.push(`- Coste estimado: ${formatDollars(cost)} (según los precios de EVAL_PRICE_*; una estimación, no una factura)`);
  else lines.push("- Coste: no se calcula (define las cuatro variables EVAL_PRICE_* para verlo).");
  return `${lines.join("\n")}\n`;
}

function sumTokens(list: Tokens[]): Tokens {
  return list.reduce((total, item) => ({ input: total.input + item.input, output: total.output + item.output, missing: total.missing + item.missing }), emptyTokens());
}
