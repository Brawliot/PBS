/**
 * The plan: departments, phases, tasks, steps and the relations between them.
 * This module only defines the shape of each record and of the whole document.
 * References between records and the dependency graphs are checked in a separate module.
 */

import { z } from "zod";
import { summarizeIssues } from "../schema-summary.js";
import type { Tier } from "../planner/planner-validation-handler.js";

export const MAX_ID = 64;
export const MAX_NAME = 120;
export const MAX_TITLE = 200;
export const MAX_STEP_TEXT = 1000;
export const MAX_NOTE = 500;
export const MAX_CONFIDENCE = 100;
// Unmeasured: most questions a draft output can carry, tune with real plans
export const MAX_OUTPUT_QUESTIONS = 20;
// Upper bounds per collection: unmeasured estimates, tune with real plans
export const LIMITS = { departments: 20, phases: 50, tasks: 500, steps: 5000, relations: 10_000 };

// Ids end up in URLs (#/task/t12): short, lowercase and stable
const IdSchema = z.string().max(MAX_ID).regex(/^[a-z0-9][a-z0-9_-]*$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const NoteSchema = text(MAX_NOTE);

const TierSchema: z.ZodType<Tier> = z.enum(["core", "important", "light"]);

/** Where an item came from, so its quality can be judged and improved later */
const OriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rule") }),
  z.strictObject({ kind: z.literal("template") }),
  z.strictObject({ kind: z.literal("ai") }),
  z.strictObject({ kind: z.literal("reference"), ref: IdSchema }),
]);
const ConfidenceSchema = z.number().int().min(0).max(MAX_CONFIDENCE);
/** What the user did with an item: the signal the plan learns from over time */
const FeedbackSchema = z.enum(["accepted", "edited", "deleted"]);

const DepartmentSchema = z.strictObject({
  id: IdSchema,
  name: text(MAX_NAME),
  tier: TierSchema,
});

const PhaseSchema = z.strictObject({
  id: IdSchema,
  name: text(MAX_NAME),
  order: z.number().int().min(0),
});

const TaskSchema = z
  .strictObject({
    id: IdSchema,
    phaseId: IdSchema,
    primaryDepartmentId: IdSchema,
    secondaryDepartmentIds: z.array(IdSchema),
    title: text(MAX_TITLE),
    status: z.enum(["todo", "in_progress", "done"]),
    origin: OriginSchema,
    confidence: ConfidenceSchema,
    feedback: FeedbackSchema.optional(),
  })
  .refine(
    (task) =>
      new Set(task.secondaryDepartmentIds).size === task.secondaryDepartmentIds.length &&
      !task.secondaryDepartmentIds.includes(task.primaryDepartmentId),
    { error: "Secondary departments must be unique and not include the primary one", path: ["secondaryDepartmentIds"] },
  );

export const STEP_EXECUTORS = ["ai", "user", "third_party"] as const;
export const STEP_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting_user",
  "waiting_third_party",
  "blocked",
  "done",
  "rejected",
] as const;

/** What a person or an AI hands over: a draft stays private to its step until confirmed */
const OutputSchema = z.strictObject({
  state: z.enum(["draft", "confirmed"]),
  summary: text(MAX_STEP_TEXT),
  questions: z.array(text(MAX_STEP_TEXT)).max(MAX_OUTPUT_QUESTIONS),
  documentRef: IdSchema.optional(),
});

const EvidenceSchema = z.strictObject({
  kind: z.enum(["none", "accepted_output", "written_confirmation", "receipt"]),
});

const StepSchema = z
  .strictObject({
    id: IdSchema,
    taskId: IdSchema,
    departmentId: IdSchema,
    text: text(MAX_STEP_TEXT),
    executor: z.enum(STEP_EXECUTORS),
    mode: z.enum(["online", "in_person"]).optional(),
    evidence: EvidenceSchema,
    // Work and waiting are kept apart: effort is work, wait is time without work
    effortHours: z.number().min(0),
    waitDays: z.number().min(0),
    status: z.enum(STEP_STATUSES),
    output: OutputSchema.optional(),
    origin: OriginSchema,
    confidence: ConfidenceSchema,
    feedback: FeedbackSchema.optional(),
  })
  .superRefine((step, ctx) => {
    if (step.executor === "user" && step.mode === undefined) {
      ctx.addIssue({ code: "custom", message: "A user step needs a mode", path: ["mode"] });
    }
    if (step.executor !== "user" && step.mode !== undefined) {
      ctx.addIssue({ code: "custom", message: "Only a user step has a mode", path: ["mode"] });
    }
    if (step.evidence.kind === "accepted_output" && step.executor !== "ai") {
      ctx.addIssue({ code: "custom", message: "Accepted output is evidence only for AI steps", path: ["evidence", "kind"] });
    }
    if (step.output !== undefined && step.executor !== "ai") {
      ctx.addIssue({ code: "custom", message: "Only an AI step has an output", path: ["output"] });
    }
  });

/** What a department depends on another for: a catalog entry, or free text when nothing fits */
const AspectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("catalog"), id: IdSchema, note: NoteSchema.optional() }),
  z.strictObject({ kind: z.literal("other"), note: NoteSchema }),
]);

// "A depends on B" is stored as "B blocks A": only one direction is kept
const link = { from: IdSchema, to: IdSchema };
const ORDER_TYPES = ["blocks", "follows"] as const;

const RelationSchema = z
  .discriminatedUnion("level", [
    // "feeds": the target step uses the result of the source (an AI step). Step level only.
    z.strictObject({ ...link, level: z.literal("step"), type: z.enum([...ORDER_TYPES, "feeds"]) }),
    z.strictObject({ ...link, level: z.literal("task"), type: z.enum(ORDER_TYPES) }),
    z.strictObject({ ...link, level: z.literal("phase"), type: z.enum(ORDER_TYPES) }),
    z.strictObject({ ...link, level: z.literal("department"), type: z.enum(ORDER_TYPES), aspect: AspectSchema }),
  ])
  .refine((relation) => relation.from !== relation.to, {
    error: "A relation needs two different elements",
    path: ["to"],
  });

export const PlanSchema = z
  .strictObject({
    departments: z.array(DepartmentSchema).max(LIMITS.departments),
    phases: z.array(PhaseSchema).max(LIMITS.phases),
    tasks: z.array(TaskSchema).max(LIMITS.tasks),
    steps: z.array(StepSchema).max(LIMITS.steps),
    relations: z.array(RelationSchema).max(LIMITS.relations),
  })
  .superRefine((plan, ctx) => {
    for (const key of ["departments", "phases", "tasks", "steps"] as const) {
      const seen = new Set<string>();
      plan[key].forEach((item, index) => {
        if (seen.has(item.id)) {
          ctx.addIssue({ code: "custom", message: "Duplicate id", path: [key, index, "id"] });
        }
        seen.add(item.id);
      });
    }
  });

export type Plan = z.infer<typeof PlanSchema>;
export type Department = Plan["departments"][number];
export type Phase = Plan["phases"][number];
export type Task = Plan["tasks"][number];
export type Step = Plan["steps"][number];
export type StepStatus = Step["status"];
export type StepExecutor = Step["executor"];
export type StepOutput = NonNullable<Step["output"]>;
export type Relation = Plan["relations"][number];
export type Origin = Task["origin"];
export type Aspect = Extract<Relation, { level: "department" }>["aspect"];

/** Validates a stored or generated plan. The error lists paths and codes, never values. */
export function parsePlan(value: unknown): Plan {
  const result = PlanSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid plan: ${summarizeIssues(result.error)}`);
  return result.data;
}
