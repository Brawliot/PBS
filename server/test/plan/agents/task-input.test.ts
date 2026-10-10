import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskInput } from "../../../plan/agents/task-input.js";
import { restaurantPlan } from "../../../plan/demo-plan.js";
import { proposeFact, confirmFact } from "../../../plan/fact-actions.js";
import type { Plan } from "../../../plan/plan-model.js";
import { NOW, planWithFact } from "./fakes.js";

const IDEA = "A restaurant in the city centre";
const task = (id: string, title: string) => ({ id, phaseId: "f1", primaryDepartmentId: "finance", title, origin: { kind: "rule" as const }, confidence: 100 });
const link = (from: string, to: string, type: "blocks" | "follows") => ({ level: "task" as const, from, to, type });
const confirmedOutput = (summary: string) => ({ version: 1, state: "confirmed" as const, summary, questions: [], createdAt: NOW, confirmedAt: NOW });

/** The restaurant plan with a confirmed fact, and the task t-permits with its feeding step (s-viability, of another task) */
function withTasks(): Plan {
  const { plan } = planWithFact();
  return {
    ...plan,
    tasks: [...plan.tasks, task("t-a", "Sign the lease"), task("t-b", "Hire staff"), task("t-c", "Buy equipment"), task("t-d", "Open the bank account")],
    relations: [
      ...plan.relations,
      link("t-a", "t-permits", "blocks"),
      link("t-permits", "t-b", "blocks"),
      link("t-permits", "t-c", "follows"),
      link("t-d", "t-permits", "follows"),
    ],
  };
}

describe("buildTaskInput", () => {
  test("it is undefined for a task the plan does not have", () => {
    assert.equal(buildTaskInput(restaurantPlan(), "t-nope", IDEA), undefined);
  });

  test("the task, the idea and the confirmed facts only: a proposed fact is not in the context", () => {
    const base = withTasks();
    const proposed = proposeFact(base, { key: { kind: "catalog", id: "target_customer" }, value: { kind: "other", text: "Families" } }, { now: () => NOW, actor: "user" });
    if (!proposed.ok) throw new Error(proposed.code);
    const input = buildTaskInput(proposed.plan, "t-permits", IDEA)!;
    assert.equal(input.context.idea, IDEA);
    assert.deepEqual(input.task, { id: "t-permits", title: "Permits", phaseId: "f2", departmentId: "legal" });
    assert.equal(input.context.facts.length, 1);
    assert.equal(input.context.facts[0].value.kind, "catalog");
  });

  test("the relations: 'A blocks B' puts A before B, 'B follows A' puts A before B", () => {
    const input = buildTaskInput(withTasks(), "t-permits", IDEA)!;
    const related = Object.fromEntries((input.related ?? []).map((item) => [item.title, item.relation]));
    // "from blocks to": from is done first. "from follows to": to is done first
    assert.equal(related["Sign the lease"], "before", "t-a blocks t-permits");
    assert.equal(related["Hire staff"], "after", "t-permits blocks t-b");
    assert.equal(related["Buy equipment"], "before", "t-permits follows t-c");
    assert.equal(related["Open the bank account"], "after", "t-d follows t-permits");
    // The restaurant plan already has "Permits follows Menu": the menu comes before the permits
    assert.equal(related["Menu"], "before", "t-permits follows t-menu (from the restaurant plan)");
    assert.equal(input.related?.length, 5);
  });

  test("the feeding output: a confirmed output of an AI step of another task is sent, as a summary", () => {
    const base = withTasks();
    const steps = base.steps.map((step) => (step.id === "s-viability" ? { ...step, outputs: [confirmedOutput("The viability is good")] } : step));
    const input = buildTaskInput({ ...base, steps }, "t-permits", IDEA)!;
    assert.deepEqual(input.confirmedOutputs, [{ stepId: "s-viability", summary: "The viability is good" }]);
  });

  test("never a draft, a rejected output, or a pending suggestion: only the confirmed output of a feeder", () => {
    const base = withTasks();
    const draft = base.steps.map((step) =>
      step.id === "s-viability" ? { ...step, outputs: [{ ...confirmedOutput("Only a draft"), state: "draft" as const, confirmedAt: undefined }] } : step,
    );
    assert.deepEqual(buildTaskInput({ ...base, steps: draft }, "t-permits", IDEA)!.confirmedOutputs, []);

    const rejected = base.steps.map((step) =>
      step.id === "s-viability" ? { ...step, outputs: [{ ...confirmedOutput("Rejected"), state: "rejected" as const, confirmedAt: undefined }] } : step,
    );
    assert.deepEqual(buildTaskInput({ ...base, steps: rejected }, "t-permits", IDEA)!.confirmedOutputs, []);
  });

  test("a pending proposal of steps is never read: the input has no proposal in it", () => {
    const base = withTasks();
    const proposal = {
      id: "agent-t-permits",
      status: "pending" as const,
      reason: { factId: base.facts![0].id },
      add: { tasks: [], steps: [{ ...base.steps[0], id: "t-permits-x", taskId: "t-permits", status: "not_started" as const, events: [], origin: { kind: "ai" as const } }], relations: [] },
      createdAt: NOW,
    };
    const input = buildTaskInput({ ...base, proposals: [proposal] }, "t-permits", IDEA)!;
    assert.equal(JSON.stringify(input).includes("agent-t-permits"), false);
    assert.equal(JSON.stringify(input).includes("t-permits-x"), false);
  });

  test("a fact confirmed later is in the context", () => {
    const { plan } = planWithFact();
    const proposed = proposeFact(plan, { key: { kind: "catalog", id: "launch_channel" }, value: { kind: "other", text: "Instagram" } }, { now: () => NOW, actor: "user" });
    if (!proposed.ok) throw new Error(proposed.code);
    const confirmed = confirmFact(proposed.plan, proposed.fact.id, { now: () => NOW, actor: "user" });
    if (!confirmed.ok) throw new Error(confirmed.code);
    assert.equal(buildTaskInput(confirmed.plan, "t-permits", IDEA)!.context.facts.length, 2);
  });
});
