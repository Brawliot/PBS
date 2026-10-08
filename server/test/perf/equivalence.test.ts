import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan } from "../../plan/plan-check.js";
import { derivePlan } from "../../plan/plan-derived.js";
import { STEP_STATUSES, type Plan } from "../../plan/plan-model.js";
import { checkPlan as referenceCheckPlan } from "./reference/plan/plan-check.js";
import { derivePlan as referenceDerivePlan } from "./reference/plan/plan-derived.js";
import { prng } from "../plan/prng.js";
import { syntheticPlan } from "./generate.js";

// The indexed rules must give exactly what the rules of the reference copy give, on plans that are valid
// by the schema but not by the rules: cross-level relations, loops, phases out of order, ids that do not exist.

const origin = { kind: "rule" } as const;

/** A random plan from a seed: the same seed always gives the same plan */
function randomPlan(seed: number): Plan {
  const random = prng(seed);
  const departments = ["d0", "d1", "d2"].map((id) => ({ id, name: id, tier: random.pick(["core", "important", "light"] as const) }));
  const phaseCount = 1 + random.int(4);
  const phases = Array.from({ length: phaseCount }, (_, index) => ({
    id: `p${index}`,
    name: `Phase ${index}`,
    order: random.int(phaseCount + 1), // repeats and gaps: orders may be out of order
    ...(random.chance(0.5) ? { startUnit: random.int(20), lengthUnits: 1 + random.int(10) } : {}),
  }));
  const taskCount = 1 + random.int(12);
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `t${index}`,
    phaseId: random.chance(0.05) ? "ghost-phase" : random.pick(phases).id,
    primaryDepartmentId: random.pick(departments).id,
    title: `Task ${index}`,
    origin,
    confidence: 100,
  }));
  const stepCount = random.int(40);
  const steps = Array.from({ length: stepCount }, (_, index) => {
    const executor = random.pick(["ai", "user", "third_party"] as const);
    return {
      id: `s${index}`,
      taskId: random.chance(0.03) ? "ghost-task" : random.pick(tasks).id,
      departmentId: random.pick(departments).id,
      text: `Step ${index}`,
      executor,
      ...(executor === "user" ? { mode: random.pick(["online", "in_person"] as const) } : {}),
      evidence: { kind: "none" as const },
      effortHours: random.int(9),
      waitDays: random.int(3),
      status: random.pick(STEP_STATUSES),
      events: [],
      origin,
      confidence: 100,
    };
  });

  const relations: Plan["relations"] = [];
  const relationCount = random.int(stepCount * 2 + taskCount + phaseCount);
  const pickStep = () => (random.chance(0.02) ? "ghost-step" : random.pick(steps).id);
  for (let r = 0; r < relationCount; r++) {
    const level = random.pick(["step", "step", "step", "task", "phase", "department"] as const);
    if (level === "step" && stepCount > 0) {
      const from = pickStep();
      const to = pickStep();
      if (from !== to) relations.push({ level, from, to, type: random.pick(["blocks", "follows", "feeds"] as const) });
    } else if (level === "task" && taskCount > 1) {
      const from = random.pick(tasks).id;
      const to = random.pick(tasks).id;
      if (from !== to) relations.push({ level, from, to, type: random.pick(["blocks", "follows"] as const) });
    } else if (level === "phase" && phaseCount > 1) {
      const from = random.pick(phases).id;
      const to = random.pick(phases).id;
      if (from !== to) relations.push({ level, from, to, type: random.pick(["blocks", "follows"] as const) });
    } else if (level === "department") {
      const from = random.pick(departments).id;
      const to = random.pick(departments).id;
      if (from !== to) relations.push({ level, from, to, type: "blocks", aspect: { kind: "catalog", id: "budget" } });
    }
  }
  // Not parsed: a random status without its history is refused by the schema, and that is what
  // step_invalid reports. The rules must agree on such plans too, so the object is used as it is.
  return {
    ...(random.chance(0.5) ? { timeline: { unit: random.pick(["day", "week", "month"] as const) } } : {}),
    departments,
    phases,
    tasks,
    steps,
    relations,
  } as unknown as Plan;
}

/** The value of a call, or the message of the error it threw: both sides must match, errors included */
const outcome = <T>(call: () => T): { value: T } | { error: string } => {
  try {
    return { value: call() };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

describe("the indexed rules give exactly the reference answers", () => {
  test("random plans from fixed seeds: checkPlan and derivePlan are equal, deeply", () => {
    let withProblems = 0;
    const codes = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const plan = randomPlan(seed);
      const problems = outcome(() => checkPlan(plan));
      assert.deepEqual(problems, outcome(() => referenceCheckPlan(plan as never)), `checkPlan, seed ${seed}`);
      if ("value" in problems) {
        if (problems.value.length > 0) withProblems++;
        for (const problem of problems.value) codes.add(`${problem.level}:${problem.code}`);
      }
      assert.deepEqual(outcome(() => derivePlan(plan)), outcome(() => referenceDerivePlan(plan as never)), `derivePlan, seed ${seed}`);
    }
    // The paths the indexes changed must be reached: loops between levels, and the phase orders of tasks
    for (const code of ["step:task_order_contradicts_steps", "step:cycle", "task:cycle", "task:task_order_contradicts_phase", "step:step_invalid"]) {
      assert.ok(codes.has(code), `${code} is reached by the seeds`);
    }
    assert.ok(withProblems >= 300, `most plans had problems, so the rules were tested on the problems (${withProblems})`);
  });

  test("the synthetic plans used by the benchmark: equal too", () => {
    for (const size of [{ tasks: 10, steps: 40 }, { tasks: 60, steps: 300 }]) {
      const plan = syntheticPlan(size);
      assert.deepEqual(checkPlan(plan), referenceCheckPlan(plan as never));
      assert.deepEqual(derivePlan(plan), referenceDerivePlan(plan as never));
    }
  });
});
