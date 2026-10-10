import type { AgentModel, AgentRequest, RelevanceJudge } from "../../plan/agents/contract.js";

/** A text no answer may carry into the report: the fakes put it in what they receive and what they return */
export const SENTINEL = "SENTINEL-DO-NOT-REPORT-7f3a";

/** A section of the user message: the JSON between <tag> and </tag> (the layout of the agents' prompts) */
export function section(user: string, tag: string): any {
  const open = `<${tag}>\n`;
  const start = user.indexOf(open) + open.length;
  const end = user.indexOf(`\n</${tag}>`, start);
  return JSON.parse(user.slice(start, end));
}

const TITLES: Record<string, string> = {
  legal: "Solicitar la licencia municipal de actividad",
  finance: "Revisar los cobros y los pagos a los profesionales",
  product: "Diseñar la interfaz de la aplicación",
  technology: "Desarrollar la plataforma de reservas",
  marketing: "Definir el canal de captación",
};

/**
 * Answers every level with a valid answer for the input it receives, by role. The answers only use ids the input
 * gives (facts, phases, departments, tasks), so the real checks of the levels pass. `failRole` makes the first calls of a
 * role fail, for the retry tests.
 */
export function validAnswer(request: AgentRequest): unknown {
  const user = request.user;
  const role = request.role;
  if (role === "plan_generate") {
    const departments: { id: string; tier: string }[] = section(user, "departments");
    return {
      phases: section(user, "phases"),
      tiers: departments.map((department) => ({ departmentId: department.id, tier: department.id === "marketing" ? "core" : department.tier })),
      relations: [{ level: "department", from: "legal", to: "finance", type: "blocks", aspect: { kind: "other", note: SENTINEL } }],
      facts: [{ key: { kind: "catalog", id: "launch_channel" }, value: { kind: "other", text: SENTINEL } }],
      requests: [{ to: "plan", text: SENTINEL }],
      questions: [SENTINEL],
    };
  }
  if (role.startsWith("department_")) {
    const id = role.slice("department_".length);
    const facts: { id: string }[] = section(user, "confirmed_facts");
    const phases: { id: string }[] = section(user, "phases");
    return {
      tasks: [
        { id: `${id}-task-1`, phaseId: phases[0].id, title: TITLES[id] ?? `Tarea de ${id}`, derivedFrom: [facts[0].id] },
        { id: `${id}-task-2`, phaseId: phases[0].id, title: `Revisar ${id}`, derivedFrom: [facts[0].id] },
      ],
      relations: [{ from: `${id}-task-1`, to: `${id}-task-2`, type: "blocks" }],
      facts: [],
      requests: [{ to: "plan", text: SENTINEL }],
      questions: [SENTINEL],
    };
  }
  if (role === "plan_review") {
    const proposed: { id: string }[] = section(user, "proposed_tasks");
    return {
      findings: proposed.length > 0 ? [{ kind: "gap", taskIds: [proposed[0].id], text: SENTINEL }] : [],
      adjustments: [],
      facts: [],
      requests: [],
      questions: [],
    };
  }
  if (role === "task_steps") {
    const task: { id: string } = section(user, "task");
    const facts: { id: string }[] = section(user, "confirmed_facts");
    return {
      steps: [
        { id: `${task.id}-draft`, text: SENTINEL, executor: "ai", evidence: "accepted_output", effortHours: 2, waitDays: 0, derivedFrom: [facts[0].id] },
        { id: `${task.id}-sign`, text: "Revisar y firmar el borrador", executor: "user", mode: "online", evidence: "written_confirmation", effortHours: 1, waitDays: 0, derivedFrom: [facts[0].id] },
      ],
      relations: [{ from: `${task.id}-draft`, to: `${task.id}-sign`, type: "blocks" }],
      facts: [],
      requests: [],
      questions: [],
    };
  }
  if (role === "step_run") {
    return { summary: SENTINEL, document: `Documento del paso. ${SENTINEL}`, questions: [SENTINEL], facts: [], requests: [] };
  }
  throw new Error(`no answer for role ${role}`);
}

/**
 * A model that answers with `answer`. `fail(request, count)` says whether the count-th call of a request fails: the
 * retry tests use it. Every request is kept, so a test can count the calls and read what was sent.
 */
export class EvalModel implements AgentModel {
  readonly requests: AgentRequest[] = [];
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly answer: (request: AgentRequest) => unknown = validAnswer,
    private readonly failFirst: Record<string, number> = {},
  ) {}

  async complete(request: AgentRequest): Promise<unknown> {
    this.requests.push(request);
    const left = this.failFirst[request.role] ?? 0;
    const failed = this.failures.get(request.role) ?? 0;
    if (failed < left) {
      this.failures.set(request.role, failed + 1);
      throw new Error("the fake failed on purpose");
    }
    return structuredClone(this.answer(request));
  }
}

/** A judge that always says the proposal fits, and counts its calls */
export class EvalJudge implements RelevanceJudge {
  calls = 0;

  constructor(private readonly fits: boolean = true) {}

  async judge(): Promise<boolean> {
    this.calls += 1;
    return this.fits;
  }
}
