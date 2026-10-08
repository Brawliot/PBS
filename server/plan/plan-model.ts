/**
 * The plan: departments, phases, tasks, steps and the relations between them.
 * This module only defines the shape of each record and of the whole document.
 * The rules of a step (transitions, invariants, graph, actions) live in step-*.ts;
 * the checks of references between records are not written yet.
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
// Unmeasured limits of the step level, tune with real plans
export const MAX_OUTPUT_QUESTIONS = 20;
// Most rounds an AI step may use in one attempt (the first draft plus the refinements); see roundsUsed
export const MAX_ROUNDS = 3;
export const MAX_EVENTS = 200;
// Most output versions over the whole life of a step, across attempts. Unmeasured: every version costs
// at least two events (a launch or an answer, then attach_output), so MAX_EVENTS / 2 is the most that
// can ever exist; MAX_EVENTS already bounds the total, this only keeps the schema honest about it.
export const MAX_OUTPUTS = MAX_EVENTS / 2;
// Upper bounds per collection: unmeasured estimates, tune with real plans
export const LIMITS = { departments: 20, phases: 50, tasks: 500, steps: 5000, relations: 10_000 };

// Ids end up in URLs (#/task/t12): short, lowercase and stable
export const IdSchema = z.string().max(MAX_ID).regex(/^[a-z0-9][a-z0-9_-]*$/);
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

// The unit of the plan's timeline: the phases place themselves on it (phase-rules.ts)
export const TIMELINE_UNITS = ["day", "week", "month"] as const;
const TimelineSchema = z.strictObject({ unit: z.enum(TIMELINE_UNITS) });
export type TimelineUnit = (typeof TIMELINE_UNITS)[number];

// A phase is only a group of tasks. Its place on the timeline is optional, in units of the plan's
// timeline; it needs the timeline to mean anything (checked on the whole plan below)
const PhaseSchema = z.strictObject({
  id: IdSchema,
  name: text(MAX_NAME),
  order: z.number().int().min(0),
  startUnit: z.number().int().min(0).optional(),
  lengthUnits: z.number().int().min(1).optional(),
});

// Status, mode, effort, elapsed time and secondary departments are not stored: task-rules.ts
// computes them from the steps, so they can never disagree with them
const TaskSchema = z.strictObject({
  id: IdSchema,
  phaseId: IdSchema,
  primaryDepartmentId: IdSchema,
  title: text(MAX_TITLE),
  origin: OriginSchema,
  confidence: ConfidenceSchema,
  feedback: FeedbackSchema.optional(),
});

export const STEP_EXECUTORS = ["ai", "user", "third_party"] as const;
// Only the life cycle is stored: "ready" and "blocked" are deduced from the relations
export const STEP_STATUSES = [
  "not_started",
  "running",
  "waiting_user",
  "waiting_third_party",
  "done",
  "rejected",
] as const;
export const EVENT_ACTIONS = [
  "launch",
  "attach_output",
  "answer",
  "confirm_output",
  "reject_output",
  "submit_proof",
  "wait_third_party",
  "third_party_responded",
  "reopen",
  "change_executor",
] as const;

// UTC only ("2026-10-07T10:00:00Z"): the same instant always has the same text
const DateTimeSchema = z.iso.datetime();
const StatusSchema = z.enum(STEP_STATUSES);

export const QuestionSchema = z.strictObject({
  question: text(MAX_STEP_TEXT),
  answer: text(MAX_STEP_TEXT).optional(),
  answeredAt: DateTimeSchema.optional(),
});

/** One version of what an AI step delivers: a draft stays private to its step until confirmed */
export const OutputSchema = z.strictObject({
  version: z.number().int().min(1),
  state: z.enum(["draft", "confirmed", "rejected", "superseded"]),
  summary: text(MAX_STEP_TEXT),
  documentRef: IdSchema.optional(),
  questions: z.array(QuestionSchema).max(MAX_OUTPUT_QUESTIONS),
  createdAt: DateTimeSchema,
  confirmedAt: DateTimeSchema.optional(),
});

const EvidenceSchema = z.strictObject({
  kind: z.enum(["none", "accepted_output", "written_confirmation", "receipt"]),
});

/** What the person handed in to close the step. For now only text; a file comes later. */
export const ProofSchema = z.strictObject({
  text: text(MAX_STEP_TEXT),
  at: DateTimeSchema,
  by: z.literal("user"),
});

/**
 * One entry of the history. The history only grows: nothing is edited or removed. Most
 * entries change the status; "change_executor" keeps it and records the executors instead.
 */
const EventSchema = z
  .strictObject({
    at: DateTimeSchema,
    actor: z.enum(["user", "ai", "system"]),
    action: z.enum(EVENT_ACTIONS),
    from: StatusSchema,
    to: StatusSchema,
    executorFrom: z.enum(STEP_EXECUTORS).optional(),
    executorTo: z.enum(STEP_EXECUTORS).optional(),
  })
  .superRefine((event, ctx) => {
    const isChange = event.action === "change_executor";
    if (!isChange) {
      if (event.executorFrom !== undefined) ctx.addIssue({ code: "custom", message: "Only change_executor has executors", path: ["executorFrom"] });
      if (event.executorTo !== undefined) ctx.addIssue({ code: "custom", message: "Only change_executor has executors", path: ["executorTo"] });
      return;
    }
    if (event.executorFrom === undefined) ctx.addIssue({ code: "custom", message: "change_executor needs the previous executor", path: ["executorFrom"] });
    if (event.executorTo === undefined) ctx.addIssue({ code: "custom", message: "change_executor needs the new executor", path: ["executorTo"] });
    if (event.executorFrom !== undefined && event.executorFrom === event.executorTo) {
      ctx.addIssue({ code: "custom", message: "The executor must change", path: ["executorTo"] });
    }
    // The executor can only change before the step starts, and the status stays
    if (event.from !== "not_started" || event.to !== "not_started") {
      ctx.addIssue({ code: "custom", message: "The executor changes only before the step starts", path: ["to"] });
    }
  });

export const StepSchema = z
  .strictObject({
    id: IdSchema,
    taskId: IdSchema,
    departmentId: IdSchema,
    text: text(MAX_STEP_TEXT),
    executor: z.enum(STEP_EXECUTORS),
    mode: z.enum(["online", "in_person"]).optional(),
    evidence: EvidenceSchema,
    proof: ProofSchema.optional(),
    // Work and waiting are kept apart: effort is work, wait is time without work
    effortHours: z.number().min(0),
    waitDays: z.number().min(0),
    status: StatusSchema,
    outputs: z.array(OutputSchema).max(MAX_OUTPUTS).optional(),
    events: z.array(EventSchema).max(MAX_EVENTS),
    origin: OriginSchema,
    confidence: ConfidenceSchema,
    feedback: FeedbackSchema.optional(),
  })
  .superRefine((step, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });

    if (step.executor === "user" && step.mode === undefined) issue("A user step needs a mode", ["mode"]);
    if (step.executor !== "user" && step.mode !== undefined) issue("Only a user step has a mode", ["mode"]);
    if (step.evidence.kind === "accepted_output" && step.executor !== "ai") {
      issue("Accepted output is evidence only for AI steps", ["evidence", "kind"]);
    }

    // Versions count 1, 2, 3... and only the latest can still be open (draft) or accepted.
    // A step that is not AI may keep the outputs from when it was (read-only history), closed.
    step.outputs?.forEach((output, index) => {
      if (step.executor !== "ai" && (output.state === "draft" || output.state === "confirmed")) {
        issue("A step that is not AI cannot have a draft or confirmed output", ["outputs", index, "state"]);
      }
      if (output.version !== index + 1) issue("Output versions must be consecutive from 1", ["outputs", index, "version"]);
      const isLast = index === step.outputs!.length - 1;
      if (!isLast && (output.state === "draft" || output.state === "confirmed")) {
        issue("Only the latest output can be a draft or confirmed", ["outputs", index, "state"]);
      }
    });

    // The history never goes back in time, each event starts where the previous ended,
    // and the current status is where the last one ended
    step.events.forEach((event, index) => {
      const previous = step.events[index - 1];
      if (previous && Date.parse(event.at) < Date.parse(previous.at)) {
        issue("Events cannot go back in time", ["events", index, "at"]);
      }
      if (event.from !== (previous ? previous.to : "not_started")) {
        issue("An event must start where the previous one ended", ["events", index, "from"]);
      }
    });
    const expected = step.events.at(-1)?.to ?? "not_started";
    if (step.status !== expected) issue("The status must be where the last event ended", ["status"]);

    // The executors chain too, and the current one is where the last change ended
    let current: string | undefined;
    step.events.forEach((event, index) => {
      if (event.action !== "change_executor") return;
      if (current !== undefined && event.executorFrom !== current) {
        issue("A change must start from the executor the previous change ended on", ["events", index, "executorFrom"]);
      }
      current = event.executorTo;
    });
    if (current !== undefined && step.executor !== current) issue("The executor must be where the last change ended", ["executor"]);
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
    timeline: TimelineSchema.optional(),
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
    plan.phases.forEach((phase, index) => {
      if (plan.timeline === undefined && (phase.startUnit !== undefined || phase.lengthUnits !== undefined)) {
        ctx.addIssue({ code: "custom", message: "A phase placed on the timeline needs the plan timeline", path: ["phases", index] });
      }
    });
  });

export type Plan = z.infer<typeof PlanSchema>;
export type Department = Plan["departments"][number];
export type Phase = Plan["phases"][number];
export type Task = Plan["tasks"][number];
export type Step = Plan["steps"][number];
export type StepStatus = Step["status"];
export type StepExecutor = Step["executor"];
export type StepOutput = NonNullable<Step["outputs"]>[number];
export type StepEvent = Step["events"][number];
export type Relation = Plan["relations"][number];
export type Origin = Task["origin"];
export type Aspect = Extract<Relation, { level: "department" }>["aspect"];

/** Validates a stored or generated plan. The error lists paths and codes, never values. */
export function parsePlan(value: unknown): Plan {
  const result = PlanSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid plan: ${summarizeIssues(result.error)}`);
  return result.data;
}
