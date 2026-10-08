import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanIndex } from "../../plan/plan-index.js";
import { syntheticPlan } from "../perf/generate.js";
import type { Plan } from "../../plan/plan-model.js";

// The index is exact by itself: each entry holds only what its name says, not only what the rules make of it
describe("the plan index holds exactly what it is named for", () => {
  const plan: Plan = syntheticPlan({ tasks: 6, steps: 24 });

  test("the relations of a task join two of its own steps, and nothing else", () => {
    const index = buildPlanIndex(plan);
    for (const task of plan.tasks) {
      const own = new Set(index.stepsOfTask.get(task.id)!.map((step) => step.id));
      for (const relation of index.insideRelations.get(task.id) ?? []) {
        assert.ok(own.has(relation.from) && own.has(relation.to), `${relation.from} -> ${relation.to} is inside ${task.id}`);
      }
    }
  });

  test("every relation that joins two steps of one task is in that task's list", () => {
    const index = buildPlanIndex(plan);
    const taskOf = new Map(plan.steps.map((step) => [step.id, step.taskId]));
    const expected = plan.relations.filter(
      (relation) => relation.level === "step" && taskOf.get(relation.from) !== undefined && taskOf.get(relation.from) === taskOf.get(relation.to),
    );
    const found = [...index.insideRelations.values()].flat();
    assert.equal(found.length, expected.length);
    assert.deepEqual(new Set(found), new Set(expected));
  });

  test("the blockers and feeders of a step are the sources of the relations that point at it", () => {
    const index = buildPlanIndex(plan);
    for (const relation of plan.relations) {
      if (relation.level !== "step") continue;
      const map = relation.type === "blocks" ? index.graph.blockers : relation.type === "feeds" ? index.graph.feeders : undefined;
      if (map) assert.ok(map.get(relation.to)?.includes(relation.from), `${relation.from} -> ${relation.to}`);
    }
  });

  test("the feeding set has exactly the sources of feeds relations", () => {
    const index = buildPlanIndex(plan);
    const sources = new Set(plan.relations.filter((relation) => relation.level === "step" && relation.type === "feeds").map((relation) => relation.from));
    assert.deepEqual(index.feeding, sources);
  });
});
