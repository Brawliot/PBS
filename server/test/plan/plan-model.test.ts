import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  MAX_CONFIDENCE,
  MAX_ID,
  MAX_NAME,
  MAX_NOTE,
  MAX_STEP_TEXT,
  MAX_TITLE,
  PlanSchema,
  parsePlan,
  type Plan,
} from "../../plan/plan-model.js";

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  phaseId: "f1",
  primaryDepartmentId: "legal",
  secondaryDepartmentIds: ["finance"],
  title: "Register the company",
  status: "todo",
  origin: { kind: "rule" },
  confidence: 100,
  ...overrides,
});
const step = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  taskId: "t1",
  departmentId: "legal",
  text: "Choose a legal form",
  done: false,
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
    rejectedAt(plan({ tasks: [task({ status: "blocked" })] }), "tasks.0.status");
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

describe("task departments", () => {
  test("the secondary list may be empty", () => {
    assert.deepEqual(issues(plan({ tasks: [task({ secondaryDepartmentIds: [] })] })), []);
  });

  test("the primary department cannot also be secondary", () => {
    rejectedAt(plan({ tasks: [task({ secondaryDepartmentIds: ["legal"] })] }), "tasks.0.secondaryDepartmentIds");
  });

  test("secondary departments cannot repeat", () => {
    rejectedAt(plan({ tasks: [task({ secondaryDepartmentIds: ["finance", "finance"] })] }), "tasks.0.secondaryDepartmentIds");
    assert.deepEqual(issues(plan({ tasks: [task({ secondaryDepartmentIds: ["finance", "hr"] })] })), []);
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
      () => parsePlan(plan({ tasks: [task({ title: "", status: secret })] })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.startsWith("Invalid plan: "));
        assert.ok(error.message.includes("tasks.0.status"));
        assert.ok(!error.message.includes(secret));
        return true;
      },
    );
  });
});
