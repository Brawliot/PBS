import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan } from "../../plan/plan-check.js";
import { LIMITS, parsePlan, type Plan } from "../../plan/plan-model.js";
import { timelineUnit } from "../../plan/phase-rules.js";
import {
  DIMENSION_OWNER,
  FUNDS_HELD,
  HEAVY_REGULATION,
  HIGH_CAPITAL,
  LICENCE_REVIEW_DAYS,
  TIMELINE_TOTAL,
  buildPlanSkeleton,
} from "../../plan/plan-skeleton.js";
import { parseReport, type Report } from "../../plan/report.js";
import { DIMENSION_KEYS, DIMENSION_OPTIONS, type DimensionKey } from "../../planner/planner-profile-handler.js";
import { CHECK_KEYS, CLAIM_KEYS } from "../../planner/planner-validation-handler.js";
import { MADRID_VALUES, reportWith } from "./report-fixtures.js";
import { prng } from "./prng.js";

/** The real option labels of a dimension (the first one is the planner's first choice) */
const labels = (dimension: DimensionKey) => Object.keys(DIMENSION_OPTIONS[dimension]);

function skeleton(report: Report): Plan {
  const result = buildPlanSkeleton(report);
  if (!result.ok) throw new Error(`no plan: ${result.code}`);
  return result.plan;
}

/** The whole plan must be a valid document and have no problems, whatever the report */
function assertValid(plan: Plan, label = "") {
  assert.doesNotThrow(() => parsePlan(JSON.parse(JSON.stringify(plan))), label);
  assert.deepEqual(checkPlan(plan), [], label);
}

describe("the Madrid restaurant report, exactly", () => {
  const plan = skeleton(reportWith());

  test("the timeline: the term gives the unit, and the phases split the total", () => {
    assert.deepEqual(plan.timeline, { unit: "week" });
    assert.deepEqual(plan.departments, [
      { id: "legal", name: "Legal & Compliance", tier: "core" },
      { id: "finance", name: "Finance", tier: "core" },
      { id: "marketing", name: "Marketing", tier: "important" },
      { id: "product", name: "Product", tier: "important" },
      { id: "operations", name: "Operations", tier: "light" },
      { id: "hr", name: "HR", tier: "light" },
      { id: "sales", name: "Sales", tier: "light" },
      { id: "technology", name: "Technology", tier: "light" },
      { id: "infrastructure", name: "Infrastructure", tier: "light" },
      { id: "health", name: "Health", tier: "light" },
    ]);
  });

  test("three phases in order: Prepare 0-8, Set up 8-18, Launch 18-26 (weeks)", () => {
    assert.deepEqual(plan.phases, [
      { id: "prepare", name: "Prepare", order: 0, startUnit: 0, lengthUnits: 8 },
      { id: "set-up", name: "Set up", order: 1, startUnit: 8, lengthUnits: 10 },
      { id: "launch", name: "Launch", order: 2, startUnit: 18, lengthUnits: 8 },
    ]);
    assert.deepEqual(plan.relations.filter((relation) => relation.level === "phase"), [
      { level: "phase", from: "set-up", to: "prepare", type: "follows" },
      { level: "phase", from: "set-up", to: "launch", type: "blocks" },
    ]);
  });

  test("the tasks, in order, with their phase and department", () => {
    assert.deepEqual(
      plan.tasks.map((task) => [task.id, task.phaseId, task.primaryDepartmentId, task.title, task.placeholder ? "gap" : ""]),
      [
        ["define-differentiator", "prepare", "product", "Define the differentiator", ""],
        ["define-founder-profile", "prepare", "hr", "Define the founder profile", ""],
        ["verify-location", "prepare", "operations", "Verify the location", ""],
        ["resolve-budget-fit", "prepare", "finance", "Resolve the budget fit", ""],
        ["obtain-licences", "set-up", "legal", "Obtain licences", ""],
        ["secure-funding", "prepare", "finance", "Secure funding", ""],
        ["plan-product-development", "set-up", "product", "Plan the product development", "gap"],
        ["go-live", "launch", "operations", "Go live", ""],
      ],
    );
  });

  test("the licence review takes 30 days, written out here so that changing the constant is noticed", () => {
    assert.equal(LICENCE_REVIEW_DAYS, 30);
  });

  test("the steps, in order: an AI step feeds a decision of the person; licences wait for a third party", () => {
    assert.deepEqual(
      plan.steps.map((step) => [step.id, step.taskId, step.executor, step.mode ?? "", step.evidence.kind, step.waitDays]),
      [
        ["define-differentiator-research", "define-differentiator", "ai", "", "accepted_output", 0],
        ["define-differentiator-decide", "define-differentiator", "user", "online", "written_confirmation", 0],
        ["define-founder-profile-research", "define-founder-profile", "ai", "", "accepted_output", 0],
        ["define-founder-profile-decide", "define-founder-profile", "user", "online", "written_confirmation", 0],
        ["verify-location-research", "verify-location", "ai", "", "accepted_output", 0],
        ["verify-location-decide", "verify-location", "user", "online", "written_confirmation", 0],
        ["resolve-budget-fit-decide", "resolve-budget-fit", "user", "online", "none", 0],
        ["obtain-licences-prepare", "obtain-licences", "user", "online", "none", 0],
        ["obtain-licences-review", "obtain-licences", "third_party", "", "receipt", 30],
        ["obtain-licences-collect", "obtain-licences", "user", "online", "none", 0],
        ["secure-funding-research", "secure-funding", "ai", "", "accepted_output", 0],
        ["secure-funding-decide", "secure-funding", "user", "online", "written_confirmation", 0],
        ["go-live-launch", "go-live", "user", "online", "none", 0],
      ],
    );
    assert.deepEqual(
      plan.relations.filter((relation) => relation.level === "step"),
      [
        { level: "step", from: "define-differentiator-research", to: "define-differentiator-decide", type: "feeds" },
        { level: "step", from: "define-founder-profile-research", to: "define-founder-profile-decide", type: "feeds" },
        { level: "step", from: "verify-location-research", to: "verify-location-decide", type: "feeds" },
        { level: "step", from: "obtain-licences-prepare", to: "obtain-licences-review", type: "blocks" },
        { level: "step", from: "obtain-licences-review", to: "obtain-licences-collect", type: "blocks" },
        { level: "step", from: "secure-funding-research", to: "secure-funding-decide", type: "feeds" },
      ],
    );
  });

  test("the launch waits for the licences; the gap waits for the product type; every item is a rule", () => {
    assert.deepEqual(plan.relations.filter((relation) => relation.level === "task"), [
      { level: "task", from: "obtain-licences", to: "go-live", type: "blocks" },
    ]);
    const gap = plan.tasks.find((task) => task.id === "plan-product-development")!;
    assert.deepEqual(gap.placeholder, { waitsFor: ["product_type"] });
    assert.equal(plan.steps.some((step) => step.taskId === "plan-product-development"), false, "a gap has no steps");
    for (const item of [...plan.tasks, ...plan.steps]) {
      assert.deepEqual(item.origin, { kind: "rule" });
      assert.equal(item.confidence, 100);
    }
    assertValid(plan, "madrid");
  });
});

describe("the mapping from each dimension to its department is fixed", () => {
  test("every dimension has its owner, all 15 of them", () => {
    assert.deepEqual(DIMENSION_OWNER, {
      customer_segment: "marketing",
      revenue_model: "finance",
      offering_type: "product",
      acquisition_channel: "marketing",
      competition: "marketing",
      differentiator: "product",
      validation_stage: "product",
      founder_profile: "hr",
      deadline_rigidity: "operations",
      capital_intensity: "finance",
      team_requirement: "hr",
      time_to_revenue: "finance",
      regulatory_load: "legal",
      third_party_dependency: "operations",
      money_handling: "legal",
    });
  });

  test("a report that leaves every dimension undefined gets one 'Define' task per dimension in its owner", () => {
    const everything = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, "Not specified"])) as Record<DimensionKey, string>;
    const plan = skeleton(reportWith({ values: everything, unsupported: [], warnings: [] }));
    const defines = plan.tasks.filter((task) => task.id.startsWith("define-"));
    assert.equal(defines.length, 15);
    for (const task of defines) {
      const key = task.id.slice("define-".length).replaceAll("-", "_") as DimensionKey;
      assert.equal(task.primaryDepartmentId, DIMENSION_OWNER[key], task.id);
      assert.equal(task.phaseId, "prepare");
    }
  });
});

describe("the timeline: each term, at its upper end", () => {
  test("the term gives the unit and the total (checked against timelineUnit)", () => {
    const expected: Record<string, [unit: string, total: number]> = {
      "Ultra-fast (0-3m)": ["day", 90],
      "Fast (3-6m)": ["week", 26],
      "Normal (6-12m)": ["week", 52],
      "Long (12-18m)": ["month", 18],
      "Very long (18+m)": ["month", 24],
      "Not specified": ["week", 26],
    };
    for (const [choice, [unit, total]] of Object.entries(expected)) {
      assert.equal(timelineUnit(choice), unit, choice);
      assert.equal(TIMELINE_TOTAL[choice], total, choice);
    }
  });

  test("the phases split the total at 30 % and 70 %, in days for the shortest term", () => {
    const plan = skeleton(reportWith({ timeline: "Ultra-fast (0-3m)" }));
    assert.deepEqual(plan.timeline, { unit: "day" });
    assert.deepEqual(plan.phases.map((phase) => [phase.id, phase.startUnit, phase.lengthUnits]), [
      ["prepare", 0, 27],
      ["set-up", 27, 36],
      ["launch", 63, 27],
    ]);
    assertValid(plan);
  });

  test("in months, the split rounds to whole months", () => {
    const plan = skeleton(reportWith({ timeline: "Long (12-18m)" }));
    assert.deepEqual(plan.phases.map((phase) => [phase.id, phase.startUnit, phase.lengthUnits]), [
      ["prepare", 0, 5],
      ["set-up", 5, 8],
      ["launch", 13, 5],
    ]);
  });

  test("a missing term uses the default: weeks, 26 in total", () => {
    const plan = skeleton(reportWith({ timeline: null }));
    assert.deepEqual(plan.timeline, { unit: "week" });
    assert.equal(plan.phases.at(-1)!.startUnit! + plan.phases.at(-1)!.lengthUnits!, 26);
  });
});

describe("boundaries of each rule", () => {
  const hasTask = (plan: Plan, id: string) => plan.tasks.some((task) => task.id === id);

  test("heavy regulation: exactly the labels in HEAVY_REGULATION give the licences", () => {
    assert.deepEqual([...HEAVY_REGULATION].sort(), ["Critical or multi-jurisdiction", "Heavy (health, finance, food)"]);
    for (const label of labels("regulatory_load")) {
      const plan = skeleton(reportWith({ values: { regulatory_load: label } }));
      assert.equal(hasTask(plan, "obtain-licences"), HEAVY_REGULATION.has(label), label);
    }
  });

  test("funds: only 'Holds or intermediates funds' gives the compliance task", () => {
    assert.equal(FUNDS_HELD, "Holds or intermediates funds");
    for (const label of labels("money_handling")) {
      const plan = skeleton(reportWith({ values: { money_handling: label } }));
      assert.equal(hasTask(plan, "comply-funds"), label === FUNDS_HELD, label);
      // The default report is heavily regulated, so the launch waits for both the licences and the compliance
      if (label === FUNDS_HELD) {
        assert.deepEqual(plan.relations.filter((relation) => relation.level === "task" && relation.to === "go-live"), [
          { level: "task", from: "obtain-licences", to: "go-live", type: "blocks" },
          { level: "task", from: "comply-funds", to: "go-live", type: "blocks" },
        ]);
      }
    }
  });

  test("capital: only the high label gives the funding task, and an undefined capital still gets its define task", () => {
    assert.equal(HIGH_CAPITAL, "High (inventory, equipment, premises or R&D)");
    for (const label of labels("capital_intensity")) {
      const plan = skeleton(reportWith({ values: { capital_intensity: label } }));
      assert.equal(hasTask(plan, "secure-funding"), label === HIGH_CAPITAL, label);
      assert.equal(hasTask(plan, "define-capital-intensity"), label === "Not specified", label);
    }
  });
});

describe("the smallest and the largest plans", () => {
  test("nothing undefined, no claim unsupported, no warning, no heavy rules: only the launch and the gap", () => {
    const values = Object.fromEntries(
      DIMENSION_KEYS.map((key) => [key, labels(key)[0] === "Not specified" ? labels(key)[1] : labels(key)[0]]),
    ) as Record<DimensionKey, string>;
    values.regulatory_load = "None";
    values.money_handling = "No third-party money";
    values.capital_intensity = "Low (digital, near-zero marginal cost)";
    const plan = skeleton(reportWith({ values, unsupported: [], warnings: [] }));
    assert.deepEqual(plan.tasks.map((task) => task.id), ["plan-product-development", "go-live"]);
    assert.deepEqual(plan.steps.map((step) => step.id), ["go-live-launch"]);
    assert.deepEqual(plan.relations.filter((relation) => relation.level === "task"), []);
    assertValid(plan, "smallest");
  });

  test("everything undefined, every claim unsupported, every warning: the largest, inside LIMITS", () => {
    const everything = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, "Not specified"])) as Record<DimensionKey, string>;
    const plan = skeleton(reportWith({ values: everything, unsupported: [...CLAIM_KEYS], warnings: [...CHECK_KEYS] }));
    // 15 defines + 7 verify + 7 resolve + the gap + go live
    assert.equal(plan.tasks.length, 31);
    // 15 x 2 defines + 7 x 2 verify + 7 resolve + go live
    assert.equal(plan.steps.length, 52);
    assert.ok(plan.tasks.length <= LIMITS.tasks && plan.steps.length <= LIMITS.steps);
    assertValid(plan, "largest");
  });

  test("the heavy rules trade a define task for their own: the same size with licences, compliance and funding", () => {
    const values = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, "Not specified"])) as Record<DimensionKey, string>;
    values.regulatory_load = "Critical or multi-jurisdiction";
    values.money_handling = FUNDS_HELD;
    values.capital_intensity = HIGH_CAPITAL;
    const plan = skeleton(reportWith({ values, unsupported: [...CLAIM_KEYS], warnings: [...CHECK_KEYS] }));
    assert.equal(plan.tasks.length, 31);
    assert.equal(plan.steps.length, 52);
    assertValid(plan, "heavy and largest");
  });
});

describe("a report that cannot make a valid plan says so with a code", () => {
  test("a department that a task needs is missing: invalid_plan, not a broken plan", () => {
    const report = reportWith();
    report.validation.departments = report.validation.departments.filter((department) => department.name !== "HR");
    assert.deepEqual(buildPlanSkeleton(report), { ok: false, code: "invalid_plan" });
  });

  test("a department name the plan does not know: unknown_department", () => {
    const report = reportWith();
    report.validation.departments[0] = { ...report.validation.departments[0], name: "Legal" };
    assert.deepEqual(buildPlanSkeleton(report), { ok: false, code: "unknown_department" });
  });
});

describe("the report is checked before anything is built", () => {
  const valid = JSON.parse(JSON.stringify(reportWith()));
  const parse = (value: unknown) => parseReport(JSON.stringify(value));

  test("the complete report is accepted", () => {
    assert.equal(parse(valid).ok, true);
  });

  test("extra keys are refused at every level", () => {
    assert.deepEqual(parse({ ...valid, extra: 1 }), { ok: false, code: "invalid_report" });
    assert.deepEqual(parse({ ...valid, input: { ...valid.input, extra: 1 } }), { ok: false, code: "invalid_report" });
    assert.deepEqual(parse({ ...valid, validation: { ...valid.validation, extra: [] } }), { ok: false, code: "invalid_report" });
    assert.deepEqual(parse({ ...valid, profile: { ...valid.profile, values: { ...valid.profile.values, extra: "x" } } }), { ok: false, code: "invalid_report" });
  });

  test("sizes and types are limited", () => {
    assert.equal(parse({ ...valid, input: { ...valid.input, idea: "x".repeat(2001) } }).ok, false);
    assert.equal(parse({ ...valid, input: { ...valid.input, budget: "80000" } }).ok, false);
    assert.equal(parse({ ...valid, input: { ...valid.input, budget: 1_000_001 } }).ok, false);
    assert.equal(parse({ ...valid, answers: Array.from({ length: 13 }, () => ({ topic: "t", question: "q", answer: "a" })) }).ok, false);
    assert.equal(parse({ ...valid, validation: { ...valid.validation, level: 3 } }).ok, false);
  });

  test("the profile takes only real options and the planner's keys", () => {
    assert.equal(parse({ ...valid, profile: { ...valid.profile, values: { ...valid.profile.values, customer_segment: "Spaceships" } } }).ok, false);
    assert.equal(parse({ ...valid, validation: { ...valid.validation, unsupported: ["profit"] } }).ok, false);
    assert.equal(parse({ ...valid, validation: { ...valid.validation, warnings: ["vibes"] } }).ok, false);
  });

  test("a report that is not JSON, or not a report, is a code: nothing throws", () => {
    assert.deepEqual(parseReport("{not json"), { ok: false, code: "invalid_json" });
    assert.deepEqual(parseReport(42), { ok: false, code: "invalid_json" });
    assert.deepEqual(parseReport(null), { ok: false, code: "invalid_json" });
    assert.deepEqual(parseReport("x".repeat(200_001)), { ok: false, code: "too_large" });
    for (const odd of ["null", "[]", '"x"', '{"__proto__":{}}', "{}", "[".repeat(5000)]) {
      assert.doesNotThrow(() => parseReport(odd), odd.slice(0, 20));
      assert.equal(parseReport(odd).ok, false, odd.slice(0, 20));
    }
  });

  test("a bad report gives no detail back: only the code", () => {
    const result = parse({ ...valid, input: { ...valid.input, idea: "SECRET-IDEA ".repeat(300) } });
    assert.deepEqual(result, { ok: false, code: "invalid_report" });
  });
});

describe("the skeleton is always a valid plan, whatever the report", () => {
  test("seeded random reports: each one parses and gives a plan with no problems", () => {
    for (const seed of [7, 2024, 31337]) {
      const random = prng(seed);
      for (let round = 0; round < 60; round++) {
        const values = Object.fromEntries(
          DIMENSION_KEYS.map((key) => [key, random.pick(Object.keys(DIMENSION_OPTIONS[key]))]),
        ) as Record<DimensionKey, string>;
        const unsupported = CLAIM_KEYS.filter(() => random.chance(0.4));
        const warnings = CHECK_KEYS.filter(() => random.chance(0.3));
        const timeline = random.pick(["Ultra-fast (0-3m)", "Fast (3-6m)", "Normal (6-12m)", "Long (12-18m)", "Very long (18+m)", "Not specified", null]);
        const report = reportWith({ values: { ...MADRID_VALUES, ...values }, unsupported: [...unsupported], warnings: [...warnings], timeline });
        const parsed = parseReport(JSON.stringify(report));
        assert.equal(parsed.ok, true, `seed ${seed} round ${round}`);
        if (!parsed.ok) continue;
        const result = buildPlanSkeleton(parsed.report);
        assert.equal(result.ok, true, `seed ${seed} round ${round}`);
        if (result.ok) assertValid(result.plan, `seed ${seed} round ${round}`);
      }
    }
  });
});
