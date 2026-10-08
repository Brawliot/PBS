/**
 * Turns the planner's report into a plan with fixed rules, without AI. Pure: the same report always
 * gives the same plan. Every generated item has origin { kind: "rule" } and confidence 100.
 *
 * The tables below are PROPOSALS, not calibrated: the durations, the phase split, the departments of
 * each area and the labels that count as heavy regulation or high capital are for review.
 */

import { checkPlan } from "./plan-check.js";
import { parsePlan, type Plan, type Relation, type Step, type Task } from "./plan-model.js";
import { timelineUnit } from "./phase-rules.js";
import type { Report } from "./report.js";
import type { CheckKey } from "../planner/planner-validation-handler.js";
import type { ClaimKey } from "../planner/planner-validation-handler.js";
import type { DimensionKey } from "../planner/planner-profile-handler.js";

export type SkeletonCode = "unknown_department" | "invalid_plan";
export type SkeletonResult = { ok: true; plan: Plan } | { ok: false; code: SkeletonCode };

// ---- Timeline (PROPOSAL). The term from Jev's answer, at its upper end, in the unit timelineUnit gives it.
// Checked by a test: each total is in the unit timelineUnit gives its term.
/** Total duration of the plan, in the unit of its term. Unknown term: the "Not specified" value. */
export const TIMELINE_TOTAL: Readonly<Record<string, number>> = {
  "Ultra-fast (0-3m)": 90, // 3 months, in days
  "Fast (3-6m)": 26, // 6 months, in weeks
  "Normal (6-12m)": 12, // 12 months, in months
  "Long (12-18m)": 18, // 18 months, in months
  "Very long (18+m)": 24, // ASSUMPTION: 18+ read as 24 months
  "Not specified": 26, // ASSUMPTION: 6 months, in weeks
};
// The phases on the total (PROPOSAL), as percentages, rounded up to whole units. Prepare starts at 0 and
// lasts 35 %; Set up starts at 30 % and lasts 40 %, so it overlaps Prepare; Launch starts when Set up
// ends and runs to the total (at least 1 unit). Integer arithmetic, so no float rounding moves a unit.
export const PREPARE_PERCENT = 35;
export const SET_UP_START_PERCENT = 30;
export const SET_UP_PERCENT = 40;
/** A share of the total, in whole units, rounded up */
const share = (total: number, percent: number): number => Math.ceil((total * percent) / 100);
// Days a licence authority takes to answer (PROPOSAL)
export const LICENCE_REVIEW_DAYS = 30;

// ---- Departments (PROPOSAL): who owns each area. Ids are the plan's; names are the planner's.
const DEPARTMENT_ID: Readonly<Record<string, string>> = {
  "Legal & Compliance": "legal",
  Finance: "finance",
  HR: "hr",
  Marketing: "marketing",
  Sales: "sales",
  Product: "product",
  Technology: "technology",
  Operations: "operations",
  Infrastructure: "infrastructure",
  Health: "health",
};

/** The owner of each profile dimension that is not defined (PROPOSAL) */
export const DIMENSION_OWNER: Readonly<Record<DimensionKey, string>> = {
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
};

/** Words for the titles "Define X" (PROPOSAL) */
const DIMENSION_LABEL: Readonly<Record<DimensionKey, string>> = {
  customer_segment: "the customer segment",
  revenue_model: "the revenue model",
  offering_type: "the offer",
  acquisition_channel: "the acquisition channel",
  competition: "the competition",
  differentiator: "the differentiator",
  validation_stage: "the validation stage",
  founder_profile: "the founder profile",
  deadline_rigidity: "the deadline",
  capital_intensity: "the capital needs",
  team_requirement: "the team needs",
  time_to_revenue: "the time to revenue",
  regulatory_load: "the regulatory load",
  third_party_dependency: "the third-party dependencies",
  money_handling: "the handling of other people's money",
};

/** The owner of each unsupported claim (PROPOSAL) and its words for "Verify X" */
const CLAIM_OWNER: Readonly<Record<ClaimKey, string>> = {
  subsector: "product",
  value_proposition: "product",
  stage: "product",
  location: "operations",
  target_customer: "marketing",
  competition: "marketing",
  revenue_model: "finance",
};
const CLAIM_LABEL: Readonly<Record<ClaimKey, string>> = {
  subsector: "the subsector",
  location: "the location",
  target_customer: "the target customer",
  value_proposition: "the value proposition",
  revenue_model: "the revenue model",
  stage: "the current stage",
  competition: "the competition",
};

/** The owner of each coherence warning (PROPOSAL) and its words for "Resolve X" */
const CHECK_OWNER: Readonly<Record<CheckKey, string>> = {
  budget_fit: "finance",
  model_fit: "finance",
  timeline_realistic: "operations",
  team_fit: "hr",
  experience_fit: "hr",
  regulation_fit: "legal",
  consistency: "product",
};
const CHECK_LABEL: Readonly<Record<CheckKey, string>> = {
  budget_fit: "the budget fit",
  model_fit: "the model fit",
  timeline_realistic: "the timeline",
  team_fit: "the team fit",
  experience_fit: "the experience fit",
  regulation_fit: "the regulation fit",
  consistency: "the consistency of the answers",
};

// ---- What counts as heavy (PROPOSAL, read from the real option labels of the planner)
export const HEAVY_REGULATION: ReadonlySet<string> = new Set([
  "Heavy (health, finance, food)",
  "Critical or multi-jurisdiction",
]);
/** Holding or intermediating customer funds needs a compliance task */
export const FUNDS_HELD: string = "Holds or intermediates funds";
/** A high capital need (inventory, equipment, premises or R&D) needs a funding task */
export const HIGH_CAPITAL: string = "High (inventory, equipment, premises or R&D)";

const PHASE_ID = { prepare: "prepare", setUp: "set-up", launch: "launch" } as const;
const PHASE_NAME = { prepare: "Prepare", setUp: "Set up", launch: "Launch" } as const;

const origin = { kind: "rule" } as const;
const slug = (key: string) => key.replaceAll("_", "-");

/** The tasks that must be done before the launch */
const GATES: readonly string[] = ["obtain-licences", "comply-funds"];

/** The plan's departments, from the validation (names mapped to ids) */
export function buildDepartments(validation: Report["validation"]): { ok: true; departments: Plan["departments"] } | { ok: false; code: SkeletonCode } {
  const departments: Plan["departments"] = [];
  for (const scored of validation.departments) {
    const id = DEPARTMENT_ID[scored.name];
    if (!id) return { ok: false, code: "unknown_department" };
    departments.push({ id, name: scored.name, tier: scored.tier });
  }
  return { ok: true, departments };
}

type Part = { tasks: Task[]; steps: Step[]; relations: Relation[] };

const task = (id: string, phaseId: string, departmentId: string, title: string): Task => ({
  id,
  phaseId,
  primaryDepartmentId: departmentId,
  title,
  origin,
  confidence: 100,
});

const step = (id: string, taskId: string, departmentId: string, text: string, overrides: Partial<Step>): Step =>
  ({
    id,
    taskId,
    departmentId,
    text,
    executor: "user",
    evidence: { kind: "none" },
    effortHours: 2,
    waitDays: 0,
    status: "not_started",
    events: [],
    origin,
    confidence: 100,
    ...overrides,
  }) as Step;

/** An AI step that feeds the person's decision: the shape of "Define X" and "Verify X" */
function researchAndDecide(id: string, phaseId: string, departmentId: string, title: string, research: string, decide: string): Part {
  return {
    tasks: [task(id, phaseId, departmentId, title)],
    steps: [
      step(`${id}-research`, id, departmentId, research, { executor: "ai", evidence: { kind: "accepted_output" } }),
      step(`${id}-decide`, id, departmentId, decide, { executor: "user", mode: "online", evidence: { kind: "written_confirmation" } }),
    ],
    relations: [{ level: "step", from: `${id}-research`, to: `${id}-decide`, type: "feeds" }],
  };
}

/** A single decision of the person: the shape of "Resolve X" */
function decideOnly(id: string, phaseId: string, departmentId: string, title: string, decide: string): Part {
  return {
    tasks: [task(id, phaseId, departmentId, title)],
    steps: [step(`${id}-decide`, id, departmentId, decide, { executor: "user", mode: "online" })],
    relations: [],
  };
}

/** Licences: the person prepares, a third party reviews (days of waiting), the person collects */
function licences(): Part {
  const id = "obtain-licences";
  return {
    tasks: [task(id, PHASE_ID.setUp, "legal", "Obtain licences")],
    steps: [
      step(`${id}-prepare`, id, "legal", "Prepare the licence application", { mode: "online" }),
      step(`${id}-review`, id, "legal", "Licence authority review", {
        executor: "third_party",
        waitDays: LICENCE_REVIEW_DAYS,
        evidence: { kind: "receipt" },
      }),
      step(`${id}-collect`, id, "legal", "Collect the licences", { mode: "online" }),
    ],
    relations: [
      { level: "step", from: `${id}-prepare`, to: `${id}-review`, type: "blocks" },
      { level: "step", from: `${id}-review`, to: `${id}-collect`, type: "blocks" },
    ],
  };
}

/** Holding other people's money: a compliance step for the person */
const compliance = (): Part => decideOnly("comply-funds", PHASE_ID.setUp, "legal", "Comply with the rules for holding funds", "Confirm the rules for holding customer funds");

/** Capital: a funding task in Finance, before the set up */
const funding = (): Part => researchAndDecide("secure-funding", PHASE_ID.prepare, "finance", "Secure funding", "Research the funding options", "Decide the funding plan");

/**
 * The tasks of the report, in order: the undefined dimensions, the unsupported claims, the warnings,
 * the regulation and funds, the capital, the product gap, and the launch. All of it is rule-based.
 */
function partsOf(report: Report): Part[] {
  const parts: Part[] = [];
  const { profile, validation } = report;
  // The schema guarantees these are the planner's keys; the types of the report keep them as text
  for (const key of profile.unknown as DimensionKey[]) {
    parts.push(researchAndDecide(`define-${slug(key)}`, PHASE_ID.prepare, DIMENSION_OWNER[key], `Define ${DIMENSION_LABEL[key]}`, `Research ${DIMENSION_LABEL[key]}`, `Decide ${DIMENSION_LABEL[key]}`));
  }
  for (const claim of validation.unsupported as ClaimKey[]) {
    parts.push(researchAndDecide(`verify-${slug(claim)}`, PHASE_ID.prepare, CLAIM_OWNER[claim], `Verify ${CLAIM_LABEL[claim]}`, `Research ${CLAIM_LABEL[claim]}`, `Confirm ${CLAIM_LABEL[claim]}`));
  }
  for (const check of validation.warnings as CheckKey[]) {
    parts.push(decideOnly(`resolve-${slug(check)}`, PHASE_ID.prepare, CHECK_OWNER[check], `Resolve ${CHECK_LABEL[check]}`, `Decide how to resolve ${CHECK_LABEL[check]}`));
  }
  if (HEAVY_REGULATION.has(profile.values.regulatory_load)) parts.push(licences());
  if (profile.values.money_handling === FUNDS_HELD) parts.push(compliance());
  if (profile.values.capital_intensity === HIGH_CAPITAL) parts.push(funding());
  return parts;
}

/** The product gap: waits for its product type, and has no steps until it is expanded (proposals) */
const productGap = (): Task => ({
  id: "plan-product-development",
  phaseId: PHASE_ID.setUp,
  primaryDepartmentId: "product",
  title: "Plan the product development",
  origin,
  confidence: 100,
  placeholder: { waitsFor: ["product_type"] },
});

export function buildPlanSkeleton(report: Report): SkeletonResult {
  const departments = buildDepartments(report.validation);
  if (!departments.ok) return departments;

  const total = TIMELINE_TOTAL[report.jev.answers.timeline?.choice ?? ""] ?? TIMELINE_TOTAL["Not specified"];
  const unit = timelineUnit(report.jev.answers.timeline?.choice ?? "");
  const setUpStart = share(total, SET_UP_START_PERCENT);
  const setUpLength = share(total, SET_UP_PERCENT);
  const launchStart = setUpStart + setUpLength;
  const phases: Plan["phases"] = [
    { id: PHASE_ID.prepare, name: PHASE_NAME.prepare, order: 0, startUnit: 0, lengthUnits: share(total, PREPARE_PERCENT) },
    { id: PHASE_ID.setUp, name: PHASE_NAME.setUp, order: 1, startUnit: setUpStart, lengthUnits: setUpLength },
    { id: PHASE_ID.launch, name: PHASE_NAME.launch, order: 2, startUnit: launchStart, lengthUnits: Math.max(1, total - launchStart) },
  ];

  const parts = partsOf(report);
  const tasks: Task[] = [];
  const steps: Step[] = [];
  const relations: Relation[] = [];
  for (const part of parts) {
    tasks.push(...part.tasks);
    steps.push(...part.steps);
    relations.push(...part.relations);
  }
  tasks.push(productGap());

  // The launch waits for every licence and compliance task
  for (const gate of tasks.filter((item) => GATES.includes(item.id))) {
    relations.push({ level: "task", from: gate.id, to: "go-live", type: "blocks" });
  }
  tasks.push(task("go-live", PHASE_ID.launch, "operations", "Go live"));
  steps.push(step("go-live-launch", "go-live", "operations", "Launch the business", { mode: "online" }));
  relations.push({ level: "phase", from: PHASE_ID.setUp, to: PHASE_ID.prepare, type: "follows" });
  relations.push({ level: "phase", from: PHASE_ID.setUp, to: PHASE_ID.launch, type: "blocks" });

  const plan = {
    timeline: { unit },
    departments: departments.departments,
    phases,
    tasks,
    steps,
    relations,
  };
  try {
    const valid = parsePlan(plan);
    if (checkPlan(valid).length > 0) return { ok: false, code: "invalid_plan" };
    return { ok: true, plan: valid };
  } catch {
    return { ok: false, code: "invalid_plan" };
  }
}

