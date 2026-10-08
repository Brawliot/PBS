import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, type PlanProblem } from "../../plan/plan-check.js";
import type { Plan } from "../../plan/plan-model.js";
import { restaurantPlan } from "../../plan/demo-plan.js";
import { step } from "./plan-fixtures.js";

/** A plan from the restaurant, changed by `change` */
const changed = (change: (plan: Plan) => void): Plan => {
  const plan = restaurantPlan();
  change(plan);
  return plan;
};
const has = (problems: PlanProblem[], expected: Partial<PlanProblem>) =>
  assert.ok(
    problems.some((problem) => Object.entries(expected).every(([key, value]) => JSON.stringify(problem[key as keyof PlanProblem]) === JSON.stringify(value))),
    `expected ${JSON.stringify(expected)} in ${JSON.stringify(problems)}`,
  );

describe("checkPlan: a valid plan", () => {
  test("the restaurant has no problems", () => {
    assert.deepEqual(checkPlan(restaurantPlan()), []);
  });

  test("an empty plan has no problems", () => {
    assert.deepEqual(checkPlan({ departments: [], phases: [], tasks: [], steps: [], relations: [] } as Plan), []);
  });

  test("tasks in the same phase may be ordered either way without a phase problem", () => {
    const plan = changed((plan) => plan.relations.push({ level: "step", from: "s-menu", to: "s-viability", type: "blocks" } as never));
    assert.deepEqual(checkPlan(plan), []);
  });

  test("implied orders that agree with the phases and the stored relations are valid", () => {
    // A user step of the menu task blocks a step of the permits task, which is in a later phase: valid
    assert.deepEqual(checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-menu", to: "s-opening", type: "blocks" } as never))), []);
  });

  test("a follows between steps of different tasks does not imply a task order", () => {
    // s-opening follows s-viability would put tasks against the phases, but follows never implies a task order
    assert.deepEqual(checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-opening", to: "s-viability", type: "follows" } as never))), []);
  });

  test("blocks between steps of the same task implies nothing about tasks", () => {
    const plan = changed((plan) => {
      plan.steps.push(step("s-menu-2", "t-menu", "finance") as never);
      plan.relations.push({ level: "step", from: "s-menu", to: "s-menu-2", type: "blocks" } as never);
    });
    assert.deepEqual(checkPlan(plan), []);
  });
});

describe("checkPlan: references that exist", () => {
  test("unknown_phase: a task in a phase that is not in the plan", () => {
    assert.deepEqual(checkPlan(changed((plan) => (plan.tasks[0].phaseId = "ghost"))), [
      { code: "unknown_phase", level: "task", index: 0, ids: ["t-menu", "ghost"] },
    ]);
  });

  test("unknown_department on a task: its primary department", () => {
    assert.deepEqual(checkPlan(changed((plan) => (plan.tasks[1].primaryDepartmentId = "ghost"))), [
      { code: "unknown_department", level: "task", index: 1, ids: ["t-viability", "ghost"] },
    ]);
  });

  test("unknown_department on a step", () => {
    assert.deepEqual(checkPlan(changed((plan) => (plan.steps[2].departmentId = "ghost"))), [
      { code: "unknown_department", level: "step", index: 2, ids: ["s-permits", "ghost"] },
    ]);
  });

  test("unknown_task: a step of a task that is not in the plan", () => {
    assert.deepEqual(checkPlan(changed((plan) => (plan.steps[0].taskId = "ghost"))), [
      { code: "unknown_task", level: "step", index: 0, ids: ["s-menu", "ghost"] },
    ]);
  });

  test("unknown_relation_from and unknown_relation_to at the step level", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "ghost", to: "phantom", type: "blocks" } as never)));
    assert.deepEqual(problems, [
      { code: "unknown_relation_from", level: "step", index: 6, ids: ["ghost"] },
      { code: "unknown_relation_to", level: "step", index: 6, ids: ["phantom"] },
    ]);
  });

  test("unknown_relation_from and unknown_relation_to at the task level", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "task", from: "t-menu", to: "ghost", type: "blocks" } as never)));
    assert.deepEqual(problems, [{ code: "unknown_relation_to", level: "task", index: 6, ids: ["ghost"] }]);
  });
});

describe("checkPlan: steps", () => {
  test("step_invalid carries the step id and the broken invariant", () => {
    // Status says running but the history is empty: the status is not where the last event ended
    const problems = checkPlan(changed((plan) => (plan.steps[1].status = "running")));
    assert.deepEqual(problems, [{ code: "step_invalid", level: "step", index: 1, ids: ["s-viability"], detail: "status_not_last_event" }]);
  });

  test("cycle at the step level, with its ids", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-permits", to: "s-menu", type: "blocks" } as never)));
    const cycles = problems.filter((problem) => problem.code === "cycle" && problem.level === "step");
    assert.equal(cycles.length, 1);
    assert.deepEqual([...cycles[0].ids!].sort(), ["s-menu", "s-permits"]);
  });

  test("feeds_from_non_ai: a feed from a step that is not an AI step", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-permits", to: "s-opening", type: "feeds" } as never)));
    assert.deepEqual(problems, [{ code: "feeds_from_non_ai", level: "step", index: 6 }]);
  });
});

describe("checkPlan: duplicate step relations", () => {
  test("a step relation repeated (same from, to and type) is a duplicate, reported at the second one", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-menu", to: "s-permits", type: "blocks" } as never)));
    assert.deepEqual(problems, [{ code: "duplicate_relation", level: "step", index: 6 }]);
  });

  test("the same step pair with another type is not a duplicate", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-menu", to: "s-permits", type: "feeds" } as never)));
    assert.equal(problems.some((problem) => problem.code === "duplicate_relation"), false);
  });

  test("the same step pair in the other direction is not a duplicate (it is a cycle)", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-permits", to: "s-menu", type: "blocks" } as never)));
    assert.equal(problems.some((problem) => problem.code === "duplicate_relation"), false);
    assert.equal(problems.some((problem) => problem.code === "cycle" && problem.level === "step"), true);
  });
});

describe("checkPlan: tasks", () => {
  test("a task relation repeated is a duplicate, reported at the second one", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "task", from: "t-permits", to: "t-menu", type: "follows" } as never)));
    assert.deepEqual(problems, [{ code: "duplicate_relation", level: "task", index: 6 }]);
  });

  test("the same task pair with another type is not a duplicate", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "task", from: "t-permits", to: "t-menu", type: "blocks" } as never)));
    assert.equal(problems.some((problem) => problem.code === "duplicate_relation"), false);
  });

  test("cycle among the stored task relations", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "task", from: "t-permits", to: "t-menu", type: "blocks" } as never)));
    const cycles = problems.filter((problem) => problem.code === "cycle" && problem.level === "task");
    assert.equal(cycles.length, 1);
    assert.deepEqual([...cycles[0].ids!].sort(), ["t-menu", "t-permits"]);
  });
});

describe("checkPlan: departments and phases (their own rules)", () => {
  test("an unknown aspect and unknown departments of a department relation", () => {
    const problems = checkPlan(
      changed((plan) => plan.relations.push({ level: "department", from: "ghost", to: "finance", type: "blocks", aspect: { kind: "catalog", id: "gossip" } } as never)),
    );
    assert.deepEqual(problems, [
      { code: "unknown_aspect", level: "department", index: 6 },
      { code: "unknown_department_from", level: "department", index: 6 },
    ]);
  });

  test("a duplicate department relation", () => {
    const problems = checkPlan(
      changed((plan) => plan.relations.push({ level: "department", from: "legal", to: "finance", type: "blocks", aspect: { kind: "catalog", id: "budget" } } as never)),
    );
    assert.deepEqual(problems, [{ code: "duplicate_relation", level: "department", index: 6 }]);
  });

  test("unknown_phase_from, unknown_phase_to and duplicate_relation of phases", () => {
    const problems = checkPlan(
      changed((plan) => {
        plan.relations.push({ level: "phase", from: "ghost", to: "f1", type: "blocks" } as never);
        plan.relations.push({ level: "phase", from: "f2", to: "f1", type: "follows" } as never);
      }),
    );
    assert.deepEqual(problems, [
      { code: "unknown_phase_from", level: "phase", index: 6 },
      { code: "duplicate_relation", level: "phase", index: 7 },
    ]);
  });

  test("cycle among phases", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "phase", from: "f3", to: "f2", type: "blocks" } as never)));
    assert.equal(problems.filter((problem) => problem.code === "cycle" && problem.level === "phase").length, 1);
  });

  test("duplicate_order of phases", () => {
    const problems = checkPlan(changed((plan) => (plan.phases[2].order = 1)));
    assert.deepEqual(problems, [{ code: "duplicate_order", level: "phase", index: 2 }]);
  });

  test("order_contradicts_relation: a blocker after the blocked phase", () => {
    const problems = checkPlan(changed((plan) => (plan.phases[2].order = 0)));
    has(problems, { code: "order_contradicts_relation", level: "phase", index: 1 });
  });

  test("blocked_phase_starts_too_early", () => {
    const problems = checkPlan(changed((plan) => (plan.phases[2].startUnit = 15)));
    assert.deepEqual(problems, [{ code: "blocked_phase_starts_too_early", level: "phase", index: 1 }]);
  });

  test("follows_before_predecessor", () => {
    const problems = checkPlan(
      changed((plan) => {
        plan.phases[0].startUnit = 2;
        plan.phases[1].startUnit = 1;
      }),
    );
    assert.deepEqual(problems, [{ code: "follows_before_predecessor", level: "phase", index: 0 }]);
  });
});

describe("checkPlan: between levels", () => {
  test("task_order_contradicts_steps: a step order implies a task order that a stored relation reverses", () => {
    // A step of the opening blocks a step of the menu: the opening task goes first, but the stored relation says the menu goes first
    const problems = checkPlan(
      changed((plan) => {
        plan.relations.push({ level: "task", from: "t-opening", to: "t-menu", type: "blocks" } as never);
        plan.relations.push({ level: "step", from: "s-menu", to: "s-opening", type: "blocks" } as never);
      }),
    );
    has(problems, { code: "task_order_contradicts_steps", level: "step", index: 7 });
  });

  test("task_order_contradicts_phase: a stored task order from a later phase to an earlier one", () => {
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "task", from: "t-menu", to: "t-opening", type: "follows" } as never)));
    has(problems, { code: "task_order_contradicts_phase", level: "task", index: 6, ids: ["t-opening", "t-menu"] });
  });

  test("task_order_contradicts_phase: an implied task order from a later phase to an earlier one", () => {
    // A step of the opening blocks a step of the permits: the opening would have to finish first
    const problems = checkPlan(changed((plan) => plan.relations.push({ level: "step", from: "s-opening", to: "s-permits", type: "blocks" } as never)));
    has(problems, { code: "task_order_contradicts_phase", level: "step", index: 6, ids: ["t-opening", "t-permits"] });
  });
});

describe("checkPlan: the problems carry no content of the user", () => {
  test("names, titles and texts never appear, only codes, levels, positions and ids", () => {
    const problems = checkPlan(
      changed((plan) => {
        plan.phases[0].name = "Secret phase name";
        plan.tasks[0].title = "Secret task title";
        plan.steps[0].text = "Secret step text";
        plan.steps[1].status = "running";
        plan.tasks[2].phaseId = "ghost";
      }),
    );
    assert.ok(problems.length >= 2);
    const serialized = JSON.stringify(problems);
    for (const secret of ["Secret phase name", "Secret task title", "Secret step text"]) {
      assert.equal(serialized.includes(secret), false, `${secret} must not appear`);
    }
  });

  test("the list keeps a fixed order: references, steps, tasks, departments, phases, then between levels", () => {
    const problems = checkPlan(
      changed((plan) => {
        plan.tasks[2].phaseId = "ghost";
        plan.steps[1].status = "running";
        plan.relations.push({ level: "phase", from: "ghost", to: "f1", type: "blocks" } as never);
        plan.relations.push({ level: "task", from: "t-opening", to: "t-menu", type: "blocks" } as never);
      }),
    );
    assert.deepEqual(problems, [
      { code: "unknown_phase", level: "task", index: 2, ids: ["t-permits", "ghost"] },
      { code: "step_invalid", level: "step", index: 1, ids: ["s-viability"], detail: "status_not_last_event" },
      { code: "unknown_phase_from", level: "phase", index: 6 },
      { code: "task_order_contradicts_phase", level: "task", index: 7, ids: ["t-opening", "t-menu"] },
    ]);
  });
});
