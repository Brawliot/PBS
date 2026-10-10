import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runPlanGenerate } from "../../../plan/agents/plan-agent.js";
import { runDepartmentTasks } from "../../../plan/agents/department-agent.js";
import { buildDepartmentInput } from "../../../plan/agents/department-input.js";
import { contextOf, type AgentDeps, type AttemptFailure } from "../../../plan/agents/contract.js";
import { FakeModel, NOW, planWithFact } from "./fakes.js";

const SENTINEL = "NOTE-SENTINEL-9d2c";
const { plan, factId } = planWithFact();
const context = contextOf("A Japanese restaurant", plan);
const EXTRAS = { facts: [], requests: [], questions: [] };

/** The failures an agent reports, with their details, for one answer and no retry */
function failuresOf(deps: Omit<AgentDeps, "onFailure">, run: (deps: AgentDeps) => Promise<unknown>): Promise<AttemptFailure[]> {
  const failures: AttemptFailure[] = [];
  return run({ ...deps, onFailure: (failure) => failures.push(failure) }).then(() => failures);
}

describe("a plan rule that refuses an answer says which rule, by its code", () => {
  test("a relation the plan already has, repeated, is refused with the code of the rule, and no value of the answer", async () => {
    const relation = { level: "department", from: "legal", to: "finance", type: "blocks", aspect: { kind: "other", note: SENTINEL } };
    const answer = { phases: plan.phases, tiers: [], relations: [relation, relation], ...EXTRAS };
    const failures = await failuresOf({ model: new FakeModel([answer]), judge: null, attempts: 1 }, (deps) => runPlanGenerate(deps, context, plan));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].reason, "plan_check");
    assert.equal(failures[0].detail, "duplicate_relation");
    assert.equal(JSON.stringify(failures).includes(SENTINEL), false, "no value of the answer");
    assert.match(failures[0].detail ?? "", /^[a-z_]+(, [a-z_]+)*$/, "only codes");
  });

  test("a department task that would come before an existing one in a LATER phase is refused with the codes of the rules it breaks", async () => {
    const legal = buildDepartmentInput(plan, "legal", "A Japanese restaurant")!;
    const later = plan.phases[plan.phases.length - 1].id;
    const answer = {
      tasks: [{ id: "legal-late-task", phaseId: later, title: `Late ${SENTINEL}`, derivedFrom: [factId] }],
      relations: [{ from: "legal-late-task", to: "t-menu", type: "blocks" }],
      ...EXTRAS,
    };
    const failures = await failuresOf({ model: new FakeModel([answer]), judge: null, attempts: 1 }, (deps) => runDepartmentTasks(deps, legal, plan, { now: () => NOW }));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].reason, "invalid_result");
    assert.ok(failures[0].detail && failures[0].detail.length > 0, "the codes of the rules are given");
    assert.match(failures[0].detail ?? "", /^[a-z_]+(, [a-z_]+)*$/, "only codes, never the title or the ids");
    assert.equal(JSON.stringify(failures).includes(SENTINEL), false);
  });

  test("an answer the plan accepts has no detail to report", async () => {
    const answer = { phases: plan.phases, tiers: [], relations: [], ...EXTRAS };
    const failures = await failuresOf({ model: new FakeModel([answer]), judge: null, attempts: 1 }, (deps) => runPlanGenerate(deps, context, plan));
    assert.equal(failures.length, 0);
  });
});
