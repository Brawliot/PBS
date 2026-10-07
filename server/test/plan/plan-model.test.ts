import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  MAX_CONFIDENCE,
  MAX_ID,
  MAX_NAME,
  MAX_EVENTS,
  MAX_NOTE,
  MAX_OUTPUT_QUESTIONS,
  MAX_OUTPUTS,
  MAX_STEP_TEXT,
  MAX_TITLE,
  PlanSchema,
  parsePlan,
  type Plan,
} from "../../plan/plan-model.js";

const T1 = "2026-10-07T10:00:00Z";
const T2 = "2026-10-07T11:00:00Z";

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  phaseId: "f1",
  primaryDepartmentId: "legal",
  title: "Register the company",
  origin: { kind: "rule" },
  confidence: 100,
  ...overrides,
});
const step = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  taskId: "t1",
  departmentId: "legal",
  text: "Choose a legal form",
  executor: "user",
  mode: "online",
  evidence: { kind: "none" },
  effortHours: 2,
  waitDays: 0,
  status: "not_started",
  events: [],
  origin: { kind: "ai" },
  confidence: 60,
  ...overrides,
});
const plan = (overrides: Record<string, unknown> = {}) => ({
  departments: [
    { id: "legal", name: "Legal & Compliance", tier: "core" },
    { id: "finance", name: "Finance", tier: "important" },
  ],
  phases: [{ id: "f1", name: "Set up", order: 0 }],
  tasks: [task()],
  steps: [step()],
  relations: [{ level: "task", from: "t1", to: "t2", type: "blocks" }],
  ...overrides,
});

/** "path code" for every issue, so a test can say exactly where and why it failed */
const issues = (value: unknown) => {
  const result = PlanSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")} ${i.code}`);
};
const rejectedAt = (value: unknown, path: string) =>
  assert.ok(
    issues(value).some((issue) => issue.startsWith(`${path} `)),
    `expected an issue at ${path}, got: ${issues(value).join(" | ")}`,
  );

describe("PlanSchema: a valid plan", () => {
  test("parses and keeps every record as given", () => {
    const parsed: Plan = parsePlan(plan());
    assert.deepEqual(parsed, plan());
  });

  test("an empty plan is valid", () => {
    const empty = { departments: [], phases: [], tasks: [], steps: [], relations: [] };
    assert.deepEqual(parsePlan(empty), empty);
  });

  test("names, titles and texts are trimmed", () => {
    const parsed = parsePlan(
      plan({
        phases: [{ id: "f1", name: "  Set up  ", order: 0 }],
        tasks: [task({ title: "\n Register \t" })],
        steps: [step({ text: "  Choose  " })],
      }),
    );
    assert.equal(parsed.phases[0].name, "Set up");
    assert.equal(parsed.tasks[0].title, "Register");
    assert.equal(parsed.steps[0].text, "Choose");
  });
});

describe("ids", () => {
  const withDepartmentId = (id: string) =>
    plan({ departments: [{ id, name: "X", tier: "core" }] });

  test("accept lowercase slugs", () => {
    for (const id of ["legal", "t12", "a_b", "f-2", "0a"]) {
      assert.deepEqual(issues(withDepartmentId(id)), [], id);
    }
  });

  test("reject what would break a URL or hide a typo", () => {
    for (const id of ["", "Legal", "-a", "_a", "a b", "a/b", "a#b", "é"]) {
      rejectedAt(withDepartmentId(id), "departments.0.id");
    }
  });

  test("have a maximum length", () => {
    assert.deepEqual(issues(withDepartmentId("a".repeat(MAX_ID))), []);
    rejectedAt(withDepartmentId("a".repeat(MAX_ID + 1)), "departments.0.id");
  });

  test("must be unique inside each collection, but may repeat across collections", () => {
    rejectedAt(
      plan({ tasks: [task(), task({ title: "Other" })] }),
      "tasks.1.id",
    );
    rejectedAt(
      plan({ steps: [step(), step({ text: "Other" })] }),
      "steps.1.id",
    );
    rejectedAt(plan({ phases: [{ id: "f1", name: "A", order: 0 }, { id: "f1", name: "B", order: 1 }] }), "phases.1.id");
    rejectedAt(plan({ departments: [{ id: "legal", name: "A", tier: "core" }, { id: "legal", name: "B", tier: "core" }] }), "departments.1.id");
    // The same id in different collections is fine: URLs carry the kind (#/dept/x, #/task/x)
    assert.deepEqual(
      issues(plan({ tasks: [task({ id: "legal" })], steps: [step({ taskId: "legal", id: "legal" })] })),
      [],
    );
  });
});

describe("text fields", () => {
  test("cannot be empty once trimmed", () => {
    rejectedAt(plan({ tasks: [task({ title: "   " })] }), "tasks.0.title");
    rejectedAt(plan({ steps: [step({ text: "" })] }), "steps.0.text");
    rejectedAt(plan({ phases: [{ id: "f1", name: " ", order: 0 }] }), "phases.0.name");
  });

  test("stop at their maximum length", () => {
    assert.deepEqual(issues(plan({ tasks: [task({ title: "a".repeat(MAX_TITLE) })] })), []);
    rejectedAt(plan({ tasks: [task({ title: "a".repeat(MAX_TITLE + 1) })] }), "tasks.0.title");
    assert.deepEqual(issues(plan({ steps: [step({ text: "a".repeat(MAX_STEP_TEXT) })] })), []);
    rejectedAt(plan({ steps: [step({ text: "a".repeat(MAX_STEP_TEXT + 1) })] }), "steps.0.text");
    assert.deepEqual(issues(plan({ phases: [{ id: "f1", name: "a".repeat(MAX_NAME), order: 0 }] })), []);
    rejectedAt(plan({ phases: [{ id: "f1", name: "a".repeat(MAX_NAME + 1), order: 0 }] }), "phases.0.name");
  });

  test("the length limit applies to the trimmed text", () => {
    assert.deepEqual(issues(plan({ tasks: [task({ title: `  ${"a".repeat(MAX_TITLE)}  ` })] })), []);
  });
});

describe("enums and numbers", () => {
  test("tier, status and relation type accept only their values", () => {
    rejectedAt(plan({ departments: [{ id: "legal", name: "A", tier: "critical" }] }), "departments.0.tier");
    rejectedAt(plan({ relations: [{ level: "task", from: "a", to: "b", type: "depends" }] }), "relations.0.type");
  });

  test("confidence is an integer from 0 to MAX_CONFIDENCE", () => {
    for (const value of [0, 1, MAX_CONFIDENCE - 1, MAX_CONFIDENCE]) {
      assert.deepEqual(issues(plan({ steps: [step({ confidence: value })] })), [], String(value));
    }
    for (const value of [-1, MAX_CONFIDENCE + 1, 50.5, Number.NaN, "80"]) {
      rejectedAt(plan({ steps: [step({ confidence: value })] }), "steps.0.confidence");
    }
  });

  test("phase order is a non-negative integer", () => {
    assert.deepEqual(issues(plan({ phases: [{ id: "f1", name: "A", order: 0 }] })), []);
    rejectedAt(plan({ phases: [{ id: "f1", name: "A", order: -1 }] }), "phases.0.order");
    rejectedAt(plan({ phases: [{ id: "f1", name: "A", order: 1.5 }] }), "phases.0.order");
  });
});

describe("origin", () => {
  test("rule, template and ai carry nothing else", () => {
    for (const kind of ["rule", "template", "ai"]) {
      assert.deepEqual(issues(plan({ steps: [step({ origin: { kind } })] })), [], kind);
      rejectedAt(plan({ steps: [step({ origin: { kind, ref: "doc1" } })] }), "steps.0.origin");
    }
  });

  test("reference needs a ref that is a valid id", () => {
    assert.deepEqual(issues(plan({ steps: [step({ origin: { kind: "reference", ref: "sector-cafes" } })] })), []);
    rejectedAt(plan({ steps: [step({ origin: { kind: "reference" } })] }), "steps.0.origin.ref");
    rejectedAt(plan({ steps: [step({ origin: { kind: "reference", ref: "Not An Id" } })] }), "steps.0.origin.ref");
  });

  test("an unknown kind is rejected, on tasks too", () => {
    rejectedAt(plan({ tasks: [task({ origin: { kind: "magic" } })] }), "tasks.0.origin.kind");
  });
});

describe("feedback", () => {
  test("is optional and accepts what the user can do with an item", () => {
    assert.deepEqual(issues(plan()), []);
    for (const feedback of ["accepted", "edited", "deleted"]) {
      assert.deepEqual(issues(plan({ tasks: [task({ feedback })] })), [], `task ${feedback}`);
      assert.deepEqual(issues(plan({ steps: [step({ feedback })] })), [], `step ${feedback}`);
    }
    assert.equal(parsePlan(plan({ steps: [step({ feedback: "edited" })] })).steps[0].feedback, "edited");
  });

  test("rejects any other value", () => {
    rejectedAt(plan({ tasks: [task({ feedback: "liked" })] }), "tasks.0.feedback");
    rejectedAt(plan({ steps: [step({ feedback: "" })] }), "steps.0.feedback");
  });
});

describe("what a task stores", () => {
  test("only id, phase, primary department, title, origin, confidence and feedback", () => {
    assert.deepEqual(Object.keys(task()).sort(), ["confidence", "id", "origin", "phaseId", "primaryDepartmentId", "title"]);
    assert.deepEqual(issues(plan({ tasks: [task({ feedback: "accepted" })] })), []);
  });

  test("what is computed from the steps is not accepted as stored data", () => {
    for (const extra of [{ status: "todo" }, { status: "done" }, { secondaryDepartmentIds: [] }, { secondaryDepartmentIds: ["finance"] }, { mode: "online" }, { effortHours: 1 }]) {
      rejectedAt(plan({ tasks: [task(extra)] }), "tasks.0");
    }
  });
});

describe("relations", () => {
  const relation = (overrides: Record<string, unknown>) => ({ level: "task", from: "a", to: "b", type: "blocks", ...overrides });
  const departmentRelation = (aspect: unknown) =>
    relation({ level: "department", from: "legal", to: "product", aspect });

  test("every level and both types are accepted", () => {
    for (const level of ["step", "task", "phase"]) {
      for (const type of ["blocks", "follows"]) {
        assert.deepEqual(issues(plan({ relations: [relation({ level, type })] })), [], `${level} ${type}`);
      }
    }
  });

  test("feeds exists only at step level", () => {
    assert.deepEqual(issues(plan({ relations: [relation({ level: "step", type: "feeds" })] })), []);
    for (const level of ["task", "phase"]) {
      rejectedAt(plan({ relations: [relation({ level, type: "feeds" })] }), "relations.0.type");
    }
    rejectedAt(plan({ relations: [departmentRelation({ kind: "catalog", id: "data" })].map((r) => ({ ...r, type: "feeds" })) }), "relations.0.type");
  });

  test("an element cannot relate to itself", () => {
    rejectedAt(plan({ relations: [relation({ from: "a", to: "a" })] }), "relations.0.to");
  });

  test("an unknown level is rejected", () => {
    rejectedAt(plan({ relations: [relation({ level: "project" })] }), "relations.0.level");
  });

  test("only department relations carry an aspect, and they must", () => {
    rejectedAt(plan({ relations: [relation({ aspect: { kind: "catalog", id: "data" } })] }), "relations.0");
    rejectedAt(plan({ relations: [departmentRelation(undefined)] }), "relations.0.aspect");
  });

  test("a catalog aspect needs an id, and its note is optional", () => {
    assert.deepEqual(issues(plan({ relations: [departmentRelation({ kind: "catalog", id: "data-protection" })] })), []);
    assert.deepEqual(
      issues(plan({ relations: [departmentRelation({ kind: "catalog", id: "data-protection", note: "Only for user data" })] })),
      [],
    );
    rejectedAt(plan({ relations: [departmentRelation({ kind: "catalog" })] }), "relations.0.aspect.id");
  });

  test("an 'other' aspect needs a note, bounded by MAX_NOTE", () => {
    assert.deepEqual(issues(plan({ relations: [departmentRelation({ kind: "other", note: "a".repeat(MAX_NOTE) })] })), []);
    rejectedAt(plan({ relations: [departmentRelation({ kind: "other" })] }), "relations.0.aspect.note");
    rejectedAt(plan({ relations: [departmentRelation({ kind: "other", note: "  " })] }), "relations.0.aspect.note");
    rejectedAt(plan({ relations: [departmentRelation({ kind: "other", note: "a".repeat(MAX_NOTE + 1) })] }), "relations.0.aspect.note");
  });

  test("two departments may depend on each other for different aspects", () => {
    const relations = [
      { level: "department", from: "product", to: "legal", type: "blocks", aspect: { kind: "catalog", id: "data-protection" } },
      { level: "department", from: "legal", to: "product", type: "blocks", aspect: { kind: "catalog", id: "product-spec" } },
    ];
    assert.deepEqual(issues(plan({ relations })), []);
  });
});

describe("step executor, mode and evidence", () => {
  const ai = (overrides: Record<string, unknown> = {}) =>
    step({ executor: "ai", mode: undefined, ...overrides });
  const third = (overrides: Record<string, unknown> = {}) =>
    step({ executor: "third_party", mode: undefined, ...overrides });
  const withStep = (value: Record<string, unknown>) => plan({ steps: [value] });

  test("each executor is accepted and any other is rejected", () => {
    assert.deepEqual(issues(withStep(step())), []);
    assert.deepEqual(issues(withStep(ai())), []);
    assert.deepEqual(issues(withStep(third())), []);
    rejectedAt(withStep(step({ executor: "robot" })), "steps.0.executor");
  });

  test("a user step needs a mode, online or in_person", () => {
    assert.deepEqual(issues(withStep(step({ mode: "online" }))), []);
    assert.deepEqual(issues(withStep(step({ mode: "in_person" }))), []);
    rejectedAt(withStep(step({ mode: undefined })), "steps.0.mode");
    rejectedAt(withStep(step({ mode: "phone" })), "steps.0.mode");
  });

  test("an AI or third-party step cannot have a mode", () => {
    rejectedAt(withStep(ai({ mode: "online" })), "steps.0.mode");
    rejectedAt(withStep(third({ mode: "in_person" })), "steps.0.mode");
  });

  test("evidence accepts its four kinds", () => {
    for (const kind of ["none", "written_confirmation", "receipt"]) {
      assert.deepEqual(issues(withStep(step({ evidence: { kind } }))), [], kind);
    }
    assert.deepEqual(issues(withStep(ai({ evidence: { kind: "accepted_output" } }))), []);
    rejectedAt(withStep(step({ evidence: { kind: "photo" } })), "steps.0.evidence.kind");
    rejectedAt(withStep(step({ evidence: { kind: "none", url: "x" } })), "steps.0.evidence");
  });

  test("accepted_output is evidence only for AI steps", () => {
    rejectedAt(withStep(step({ evidence: { kind: "accepted_output" } })), "steps.0.evidence.kind");
    rejectedAt(withStep(third({ evidence: { kind: "accepted_output" } })), "steps.0.evidence.kind");
  });
});

describe("step effort, wait and status", () => {
  const withStep = (overrides: Record<string, unknown>) => plan({ steps: [step(overrides)] });

  test("effortHours and waitDays are finite numbers from 0, with no upper bound", () => {
    for (const value of [0, 0.5, 1_000_000]) {
      assert.deepEqual(issues(withStep({ effortHours: value, waitDays: value })), [], String(value));
    }
    for (const value of [-0.1, -1, Number.NaN, Number.POSITIVE_INFINITY, "2", null]) {
      rejectedAt(withStep({ effortHours: value }), "steps.0.effortHours");
      rejectedAt(withStep({ waitDays: value }), "steps.0.waitDays");
    }
  });

  test("effort and wait are both required and independent", () => {
    const { effortHours: _e, ...noEffort } = step();
    const { waitDays: _w, ...noWait } = step();
    rejectedAt(plan({ steps: [noEffort] }), "steps.0.effortHours");
    rejectedAt(plan({ steps: [noWait] }), "steps.0.waitDays");
    const parsed = parsePlan(withStep({ effortHours: 3, waitDays: 7 })).steps[0];
    assert.deepEqual([parsed.effortHours, parsed.waitDays], [3, 7]);
  });

  test("status accepts exactly the six stored values: ready and blocked are deduced, not stored", () => {
    // Only the empty history matches "not_started", so the other statuses are checked on their own
    for (const status of ["running", "waiting_user", "waiting_third_party", "done", "rejected"]) {
      const events = [{ at: T1, actor: "user", action: "launch", from: "not_started", to: status }];
      assert.deepEqual(issues(withStep({ status, events })), [], status);
    }
    assert.deepEqual(issues(withStep({ status: "not_started" })), []);
    for (const status of ["pending", "ready", "blocked", "todo"]) {
      rejectedAt(withStep({ status }), "steps.0.status");
    }
    rejectedAt(withStep({ done: false }), "steps.0");
  });
});

describe("step proof", () => {
  const proof = (overrides: Record<string, unknown> = {}) => ({ text: "Receipt no. 42", at: T1, by: "user", ...overrides });
  const withProof = (value: unknown) => plan({ steps: [step({ proof: value })] });

  test("is optional and carries text, a date and who handed it in", () => {
    assert.deepEqual(issues(withProof(undefined)), []);
    assert.deepEqual(issues(withProof(proof())), []);
    assert.deepEqual(parsePlan(withProof(proof())).steps[0].proof, proof());
  });

  test("text is trimmed, non-empty and bounded by MAX_STEP_TEXT", () => {
    assert.deepEqual(issues(withProof(proof({ text: "a".repeat(MAX_STEP_TEXT) }))), []);
    rejectedAt(withProof(proof({ text: "a".repeat(MAX_STEP_TEXT + 1) })), "steps.0.proof.text");
    rejectedAt(withProof(proof({ text: "  " })), "steps.0.proof.text");
  });

  test("only the user hands it in, it needs a valid date, and unknown keys are rejected", () => {
    for (const by of ["ai", "system", "third_party"]) rejectedAt(withProof(proof({ by })), "steps.0.proof.by");
    rejectedAt(withProof(proof({ at: "yesterday" })), "steps.0.proof.at");
    rejectedAt(withProof(proof({ file: "a.pdf" })), "steps.0.proof");
  });
});

describe("dates", () => {
  const withProofAt = (at: unknown) => plan({ steps: [step({ proof: { text: "x", at, by: "user" } })] });

  test("accept ISO 8601 in UTC, with or without fractions of a second", () => {
    for (const at of ["2026-10-07T10:00:00Z", "2026-10-07T10:00:00.123Z", "2024-02-29T23:59:59Z"]) {
      assert.deepEqual(issues(withProofAt(at)), [], at);
    }
  });

  test("reject what is not a real UTC instant", () => {
    const invalid = [
      "2026-10-07", // no time
      "2026-10-07T10:00:00", // no zone
      "2026-10-07T10:00:00+02:00", // offsets are not stored: one instant, one text
      "2026-02-30T10:00:00Z", // day that does not exist
      "2025-02-29T10:00:00Z", // not a leap year
      "2026-10-07T25:00:00Z",
      "2026-13-07T10:00:00Z",
      "",
      "now",
      20261007,
    ];
    for (const at of invalid) rejectedAt(withProofAt(at), "steps.0.proof.at");
  });
});

describe("step outputs", () => {
  const out = (version: number, overrides: Record<string, unknown> = {}) => ({
    version,
    state: "draft",
    summary: "A draft",
    questions: [],
    createdAt: T1,
    ...overrides,
  });
  const aiStep = (outputs: unknown) =>
    plan({ steps: [step({ executor: "ai", mode: undefined, outputs })] });

  test("are optional, and an AI step may carry them", () => {
    assert.deepEqual(issues(aiStep(undefined)), []);
    assert.deepEqual(issues(aiStep([])), []);
    assert.deepEqual(issues(aiStep([out(1)])), []);
    const full = out(1, {
      state: "confirmed",
      documentRef: "doc1",
      confirmedAt: T2,
      questions: [{ question: "Which city?", answer: "Madrid", answeredAt: T2 }, { question: "Open?" }],
    });
    assert.deepEqual(parsePlan(aiStep([full])).steps[0].outputs, [full]);
  });

  test("a step that is not AI may keep old outputs, as long as none is a draft or confirmed", () => {
    const notAi = (outputs: unknown) => plan({ steps: [step({ outputs })] });
    assert.deepEqual(issues(notAi([out(1, { state: "rejected" })])), []);
    assert.deepEqual(issues(notAi([out(1, { state: "superseded" }), out(2, { state: "rejected" })])), []);
    assert.deepEqual(issues(notAi([])), []);
    rejectedAt(notAi([out(1, { state: "draft" })]), "steps.0.outputs.0.state");
    rejectedAt(notAi([out(1, { state: "confirmed" })]), "steps.0.outputs.0.state");
    rejectedAt(notAi([out(1, { state: "superseded" }), out(2, { state: "draft" })]), "steps.0.outputs.1.state");
    rejectedAt(plan({ steps: [step({ executor: "third_party", mode: undefined, outputs: [out(1, { state: "confirmed" })] })] }), "steps.0.outputs.0.state");
  });

  test("the old single output is gone", () => {
    rejectedAt(plan({ steps: [step({ executor: "ai", mode: undefined, output: out(1) })] }), "steps.0");
  });

  test("state is one of draft, confirmed, rejected and superseded", () => {
    for (const state of ["draft", "confirmed", "rejected", "superseded"]) {
      assert.deepEqual(issues(aiStep([out(1, { state })])), [], state);
    }
    rejectedAt(aiStep([out(1, { state: "final" })]), "steps.0.outputs.0.state");
  });

  test("versions are consecutive integers from 1", () => {
    const old = { state: "superseded" };
    assert.deepEqual(issues(aiStep([out(1, old), out(2, old), out(3)])), []);
    rejectedAt(aiStep([out(0)]), "steps.0.outputs.0.version");
    rejectedAt(aiStep([out(2)]), "steps.0.outputs.0.version");
    rejectedAt(aiStep([out(1.5)]), "steps.0.outputs.0.version");
    rejectedAt(aiStep([out(1, old), out(3)]), "steps.0.outputs.1.version");
    rejectedAt(aiStep([out(1, old), out(1)]), "steps.0.outputs.1.version");
  });

  test("there are at most MAX_OUTPUTS versions in the whole life of the step", () => {
    const versions = (count: number) => Array.from({ length: count }, (_, i) => out(i + 1, { state: i === count - 1 ? "draft" : "superseded" }));
    assert.deepEqual(issues(aiStep(versions(MAX_OUTPUTS))), []);
    rejectedAt(aiStep(versions(MAX_OUTPUTS + 1)), "steps.0.outputs");
  });

  test("only the latest version can be a draft or confirmed", () => {
    for (const state of ["draft", "confirmed"]) {
      rejectedAt(aiStep([out(1, { state }), out(2)]), "steps.0.outputs.0.state");
    }
    for (const state of ["rejected", "superseded"]) {
      assert.deepEqual(issues(aiStep([out(1, { state }), out(2)])), [], state);
    }
    // The latest may also be closed
    assert.deepEqual(issues(aiStep([out(1, { state: "rejected" })])), []);
  });

  test("summary is required, trimmed text bounded by MAX_STEP_TEXT", () => {
    assert.deepEqual(issues(aiStep([out(1, { summary: "a".repeat(MAX_STEP_TEXT) })])), []);
    rejectedAt(aiStep([out(1, { summary: "a".repeat(MAX_STEP_TEXT + 1) })]), "steps.0.outputs.0.summary");
    rejectedAt(aiStep([out(1, { summary: "  " })]), "steps.0.outputs.0.summary");
  });

  test("questions are bounded in count; question text is required, the answer is not", () => {
    const many = (count: number) => Array.from({ length: count }, () => ({ question: "Q" }));
    assert.deepEqual(issues(aiStep([out(1, { questions: many(MAX_OUTPUT_QUESTIONS) })])), []);
    rejectedAt(aiStep([out(1, { questions: many(MAX_OUTPUT_QUESTIONS + 1) })]), "steps.0.outputs.0.questions");
    rejectedAt(aiStep([out(1, { questions: [{ question: " " }] })]), "steps.0.outputs.0.questions.0.question");
    rejectedAt(aiStep([out(1, { questions: [{}] })]), "steps.0.outputs.0.questions.0.question");
    rejectedAt(aiStep([out(1, { questions: undefined })]), "steps.0.outputs.0.questions");
    rejectedAt(aiStep([out(1, { questions: ["plain text"] })]), "steps.0.outputs.0.questions.0");
    rejectedAt(aiStep([out(1, { questions: [{ question: "Q", answer: " " }] })]), "steps.0.outputs.0.questions.0.answer");
  });

  test("createdAt is required; confirmedAt and answeredAt are dates", () => {
    rejectedAt(aiStep([out(1, { createdAt: undefined })]), "steps.0.outputs.0.createdAt");
    rejectedAt(aiStep([out(1, { createdAt: "2026-10-07" })]), "steps.0.outputs.0.createdAt");
    rejectedAt(aiStep([out(1, { confirmedAt: "soon" })]), "steps.0.outputs.0.confirmedAt");
    rejectedAt(aiStep([out(1, { questions: [{ question: "Q", answeredAt: "soon" }] })]), "steps.0.outputs.0.questions.0.answeredAt");
  });

  test("documentRef must be a valid id, and unknown keys are rejected", () => {
    rejectedAt(aiStep([out(1, { documentRef: "Not An Id" })]), "steps.0.outputs.0.documentRef");
    rejectedAt(aiStep([out(1, { extra: 1 })]), "steps.0.outputs.0");
    rejectedAt(aiStep([out(1, { questions: [{ question: "Q", extra: 1 }] })]), "steps.0.outputs.0.questions.0");
  });
});

describe("step events", () => {
  const ev = (at: string, from: string, to: string, overrides: Record<string, unknown> = {}) => ({
    at,
    actor: "user",
    action: "launch",
    from,
    to,
    ...overrides,
  });
  const withHistory = (events: unknown[], status: string) => plan({ steps: [step({ events, status })] });
  const T3 = "2026-10-07T12:00:00Z";

  test("an empty history leaves the step not started", () => {
    assert.deepEqual(issues(withHistory([], "not_started")), []);
    rejectedAt(withHistory([], "running"), "steps.0.status");
  });

  test("a valid chain is accepted and kept as given", () => {
    const events = [ev(T1, "not_started", "running"), ev(T2, "running", "done", { actor: "system", action: "submit_proof" })];
    assert.deepEqual(issues(withHistory(events, "done")), []);
    assert.deepEqual(parsePlan(withHistory(events, "done")).steps[0].events, events);
  });

  test("the first event must start from not_started", () => {
    rejectedAt(withHistory([ev(T1, "running", "done")], "done"), "steps.0.events.0.from");
  });

  test("each event starts where the previous one ended", () => {
    const broken = [ev(T1, "not_started", "running"), ev(T2, "waiting_user", "done")];
    rejectedAt(withHistory(broken, "done"), "steps.0.events.1.from");
    const third = [ev(T1, "not_started", "running"), ev(T2, "running", "rejected"), ev(T3, "running", "done")];
    rejectedAt(withHistory(third, "done"), "steps.0.events.2.from");
    assert.deepEqual(issues(withHistory([...third.slice(0, 2), ev(T3, "rejected", "not_started")], "not_started")), []);
  });

  test("the status must be the 'to' of the last event", () => {
    const events = [ev(T1, "not_started", "running"), ev(T2, "running", "done")];
    rejectedAt(withHistory(events, "running"), "steps.0.status");
    rejectedAt(withHistory(events, "not_started"), "steps.0.status");
    // A reopened step is back at the start even though its history is not empty
    const reopened = [...events.slice(0, 1), ev(T2, "running", "rejected"), ev(T2, "rejected", "not_started")];
    assert.deepEqual(issues(withHistory(reopened, "not_started")), []);
  });

  test("events never go back in time, but may share an instant", () => {
    const back = [ev(T2, "not_started", "running"), ev(T1, "running", "done")];
    rejectedAt(withHistory(back, "done"), "steps.0.events.1.at");
    const same = [ev(T1, "not_started", "running"), ev(T1, "running", "done")];
    assert.deepEqual(issues(withHistory(same, "done")), []);
    // Compared as instants, not as text: 9:59:59.9 is before 10:00:00
    const fraction = [ev("2026-10-07T10:00:00Z", "not_started", "running"), ev("2026-10-07T09:59:59.900Z", "running", "done")];
    rejectedAt(withHistory(fraction, "done"), "steps.0.events.1.at");
  });

  test("actor and action accept only their values", () => {
    const actions = ["launch", "attach_output", "answer", "confirm_output", "reject_output", "submit_proof", "wait_third_party", "third_party_responded", "reopen"];
    for (const action of actions) {
      assert.deepEqual(issues(withHistory([ev(T1, "not_started", "running", { action })], "running")), [], action);
    }
    // change_executor has its own shape: it keeps the status and names the executors
    const change = ev(T1, "not_started", "not_started", { action: "change_executor", executorFrom: "ai", executorTo: "user" });
    assert.deepEqual(issues(plan({ steps: [step({ events: [change] })] })), []);
    for (const actor of ["user", "ai", "system"]) {
      assert.deepEqual(issues(withHistory([ev(T1, "not_started", "running", { actor })], "running")), [], actor);
    }
    rejectedAt(withHistory([ev(T1, "not_started", "running", { action: "launch_it" })], "running"), "steps.0.events.0.action");
    rejectedAt(withHistory([ev(T1, "not_started", "running", { actor: "third_party" })], "running"), "steps.0.events.0.actor");
  });

  test("the executor fields are only for change_executor, and are required there", () => {
    const change = (overrides: Record<string, unknown> = {}) =>
      ev(T1, "not_started", "not_started", { action: "change_executor", executorFrom: "ai", executorTo: "user", ...overrides });
    const history = (event: unknown, executor = "user") => plan({ steps: [step({ events: [event], executor, status: "not_started" })] });
    assert.deepEqual(issues(history(change())), []);
    rejectedAt(history(change({ executorFrom: undefined })), "steps.0.events.0.executorFrom");
    rejectedAt(history(change({ executorTo: undefined })), "steps.0.events.0.executorTo");
    rejectedAt(history(change({ executorFrom: "user" })), "steps.0.events.0.executorTo");
    rejectedAt(history(change({ executorTo: "robot" })), "steps.0.events.0.executorTo");
    // Other actions carry none
    const launch = ev(T1, "not_started", "running");
    rejectedAt(plan({ steps: [step({ events: [{ ...launch, executorFrom: "ai" }], status: "running" })] }), "steps.0.events.0.executorFrom");
    rejectedAt(plan({ steps: [step({ events: [{ ...launch, executorTo: "ai" }], status: "running" })] }), "steps.0.events.0.executorTo");
  });

  test("a change of executor happens before the step starts and leaves the status where it was", () => {
    const change = (from: string, to: string) =>
      ev(T1, from, to, { action: "change_executor", executorFrom: "ai", executorTo: "user" });
    assert.deepEqual(issues(plan({ steps: [step({ events: [change("not_started", "not_started")], status: "not_started" })] })), []);
    rejectedAt(plan({ steps: [step({ events: [change("not_started", "running")], status: "running" })] }), "steps.0.events.0.to");
    // Ending at the start is not enough: it must also begin there
    const back = [ev(T1, "not_started", "rejected"), change("rejected", "not_started")].map((e, i) => ({ ...e, at: i === 0 ? T1 : T2 }));
    rejectedAt(plan({ steps: [step({ events: back, status: "not_started" })] }), "steps.0.events.1.to");
    rejectedAt(plan({ steps: [step({ events: [ev(T1, "not_started", "running"), change("running", "running")], status: "running" })] }), "steps.0.events.1.to");
  });

  test("the executors of the changes chain, and the step has the last one", () => {
    const change = (at: string, from: string, to: string) => ev(at, "not_started", "not_started", { action: "change_executor", executorFrom: from, executorTo: to });
    const two = [change(T1, "ai", "user"), change(T2, "user", "third_party")];
    assert.deepEqual(issues(plan({ steps: [step({ events: two, executor: "third_party", mode: undefined })] })), []);
    rejectedAt(plan({ steps: [step({ events: [change(T1, "ai", "user"), change(T2, "third_party", "ai")], executor: "ai", mode: undefined })] }), "steps.0.events.1.executorFrom");
    // The current executor must be where the last change ended
    rejectedAt(plan({ steps: [step({ events: two, executor: "user" })] }), "steps.0.executor");
    rejectedAt(plan({ steps: [step({ events: [change(T1, "ai", "user")], executor: "third_party", mode: undefined })] }), "steps.0.executor");
    // A step that never changed has no constraint on it
    assert.deepEqual(issues(plan({ steps: [step({ executor: "ai", mode: undefined })] })), []);
  });

  test("from and to must be stored statuses, and the date a valid one", () => {
    rejectedAt(withHistory([ev(T1, "not_started", "ready")], "ready"), "steps.0.events.0.to");
    rejectedAt(withHistory([ev(T1, "blocked", "running")], "running"), "steps.0.events.0.from");
    rejectedAt(withHistory([ev("today", "not_started", "running")], "running"), "steps.0.events.0.at");
  });

  test("the history has a maximum size", () => {
    // not_started -> running -> rejected -> not_started -> ... keeps every link valid
    const chain = (count: number) => {
      const cycle = ["not_started", "running", "rejected"];
      return Array.from({ length: count }, (_, i) => ev(T1, cycle[i % 3], cycle[(i + 1) % 3]));
    };
    const statusAfter = (count: number) => ["not_started", "running", "rejected"][count % 3];
    assert.deepEqual(issues(withHistory(chain(MAX_EVENTS), statusAfter(MAX_EVENTS))), []);
    rejectedAt(withHistory(chain(MAX_EVENTS + 1), statusAfter(MAX_EVENTS + 1)), "steps.0.events");
  });
});

describe("the document", () => {
  test("rejects unknown keys at the top level and inside records", () => {
    rejectedAt({ ...plan(), extra: 1 }, "");
    rejectedAt(plan({ tasks: [task({ owner: "me" })] }), "tasks.0");
    rejectedAt(plan({ departments: [{ id: "legal", name: "A", tier: "core", color: "red" }] }), "departments.0");
  });

  test("rejects a missing collection and anything that is not an object", () => {
    const { steps: _steps, ...withoutSteps } = plan();
    rejectedAt(withoutSteps, "steps");
    for (const value of [null, undefined, "plan", 42, []]) {
      assert.ok(issues(value).length > 0, String(value));
    }
  });

  test("each collection has a maximum size", () => {
    const manyTasks = (count: number) =>
      Array.from({ length: count }, (_, i) => task({ id: `t${i}` }));
    assert.deepEqual(issues(plan({ tasks: manyTasks(LIMITS.tasks) })), []);
    rejectedAt(plan({ tasks: manyTasks(LIMITS.tasks + 1) }), "tasks");

    const manyDepartments = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `d${i}`, name: "X", tier: "core" }));
    assert.deepEqual(issues(plan({ departments: manyDepartments(LIMITS.departments) })), []);
    rejectedAt(plan({ departments: manyDepartments(LIMITS.departments + 1) }), "departments");
  });
});

describe("parsePlan", () => {
  test("throws an error that names the paths and codes, never the values", () => {
    const secret = "SECRET-TEXT-FROM-THE-USER";
    assert.throws(
      () => parsePlan(plan({ tasks: [task({ title: "", feedback: secret })] })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.startsWith("Invalid plan: "));
        assert.ok(error.message.includes("tasks.0.feedback"));
        assert.ok(!error.message.includes(secret));
        return true;
      },
    );
  });
});
