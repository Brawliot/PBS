/**
 * The plan: departments, phases, tasks, steps and the relations between them.
 * This module only defines the shape of each record and of the whole document.
 * The rules of a step (transitions, invariants, graph, actions) live in step-*.ts,
 * and the checks of references between records (ids that exist, no cycles...) in plan-check.ts.
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
// Largest plan document that is stored, in bytes of its JSON text. Unmeasured: tune with real plans
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
// Most output versions over the whole life of a step, across attempts. Unmeasured: every version costs
// at least two events (a launch or an answer, then attach_output), so MAX_EVENTS / 2 is the most that
// can ever exist; MAX_EVENTS already bounds the total, this only keeps the schema honest about it.
export const MAX_OUTPUTS = MAX_EVENTS / 2;
// Upper bounds per collection: unmeasured estimates, tune with real plans
export const LIMITS = { departments: 20, phases: 50, tasks: 500, steps: 5000, relations: 10_000 };
// Growth of the plan (facts and proposals). Unmeasured: tune with real plans
export const MAX_FACTS = 200;
export const MAX_PROPOSALS = 100;
export const MAX_DERIVED_FROM = 20;
export const MAX_WAITS_FOR = 5;
export const PROPOSAL_LIMITS = { tasks: 20, steps: 60, relations: 120 };
/** Notes of a proposal (read-only text: requests, questions and review findings). Added after the first version: optional */
export const PROPOSAL_NOTE_LIMITS = { notes: 20, text: 400 };
// The plan structure proposed by the plan level (phases, tiers, department relations). Unmeasured: tune with real runs
export const STRUCTURE_LIMITS = { phases: LIMITS.phases, tiers: LIMITS.departments, relations: 40, requests: 5, questions: 5, text: 300 };
/** Requests and questions kept in a structure: the agent's text, plus the department it is sent to */
export const MAX_STRUCTURE_TEXT = 400;

// Ids end up in URLs (#/task/t12): short, lowercase and stable
export const IdSchema = z.string().max(MAX_ID).regex(/^[a-z0-9][a-z0-9_-]*$/);
// The NUL character cannot be stored in PostgreSQL's jsonb, so no text of the plan may carry it
const text = (max: number) => z.string().trim().min(1).max(max).refine((value) => !value.includes("\u0000"), "NUL is not allowed");
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

export const DepartmentSchema = z.strictObject({
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
export const PhaseSchema = z.strictObject({
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
  // Ids of the facts this task was generated from (growth of the plan, see fact-actions.ts)
  derivedFrom: z.array(IdSchema).min(1).max(MAX_DERIVED_FROM).optional(),
  // A gap: a task waiting for confirmed facts, with no steps yet (proposals.ts expands it)
  placeholder: z.strictObject({ waitsFor: z.array(IdSchema).min(1).max(MAX_WAITS_FOR) }).optional(),
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
/** Who acts: the person, the AI, or the system (plan_events.actor and plan_log.actor in the migrations) */
export const EVENT_ACTORS = ["user", "ai", "system"] as const;
/** What a step needs to be closed without the AI: none, or a kind of evidence from the person */
export const EVIDENCE_KINDS = ["none", "accepted_output", "written_confirmation", "receipt"] as const;
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
  kind: z.enum(EVIDENCE_KINDS),
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
    actor: z.enum(EVENT_ACTORS),
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
    derivedFrom: z.array(IdSchema).min(1).max(MAX_DERIVED_FROM).optional(),
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

const DepartmentRelationSchema = z.strictObject({ ...link, level: z.literal("department"), type: z.enum(ORDER_TYPES), aspect: AspectSchema });

export const RelationSchema = z
  .discriminatedUnion("level", [
    // "feeds": the target step uses the result of the source (an AI step). Step level only.
    z.strictObject({ ...link, level: z.literal("step"), type: z.enum([...ORDER_TYPES, "feeds"]) }),
    z.strictObject({ ...link, level: z.literal("task"), type: z.enum(ORDER_TYPES) }),
    z.strictObject({ ...link, level: z.literal("phase"), type: z.enum(ORDER_TYPES) }),
    DepartmentRelationSchema,
  ])
  .refine((relation) => relation.from !== relation.to, {
    error: "A relation needs two different elements",
    path: ["to"],
  });

/**
 * A key or a value of a fact: a catalog entry (fact-catalog.ts decides which ones exist) or free text.
 * It has the same shape as an aspect, so both kinds of record read alike.
 */
export const FactTermSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("catalog"), id: IdSchema }),
  z.strictObject({ kind: z.literal("other"), text: text(MAX_NOTE) }),
]);
export const FACT_STATUSES = ["proposed", "confirmed", "superseded", "rejected"] as const;

/**
 * Where a fact came from: the person, an AI step (and the version of its output, if any), or an agent of the
 * plan or a department level (no step: the agent proposes the fact about the whole plan or one department)
 */
const FactSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("step"), stepId: IdSchema, version: z.number().int().min(1).optional() }),
  z.strictObject({ kind: z.literal("agent"), level: z.enum(["plan", "department"]) }),
]);

/** A project fact: something the person has confirmed about the business (or proposed, and not yet). */
const FactSchema = z
  .strictObject({
    id: IdSchema,
    key: FactTermSchema,
    value: FactTermSchema,
    status: z.enum(FACT_STATUSES),
    from: FactSourceSchema,
    createdAt: DateTimeSchema,
    confirmedAt: DateTimeSchema.optional(),
    supersededBy: IdSchema.optional(),
  })
  .superRefine((fact, ctx) => {
    if (fact.status === "confirmed" && fact.confirmedAt === undefined) {
      ctx.addIssue({ code: "custom", message: "A confirmed fact needs confirmedAt", path: ["confirmedAt"] });
    }
    if (fact.confirmedAt !== undefined && fact.status !== "confirmed" && fact.status !== "superseded") {
      ctx.addIssue({ code: "custom", message: "Only a confirmed or superseded fact has confirmedAt", path: ["confirmedAt"] });
    }
    if (fact.status === "superseded" && fact.supersededBy === undefined) {
      ctx.addIssue({ code: "custom", message: "A superseded fact needs supersededBy", path: ["supersededBy"] });
    }
    if (fact.status !== "superseded" && fact.supersededBy !== undefined) {
      ctx.addIssue({ code: "custom", message: "Only a superseded fact has supersededBy", path: ["supersededBy"] });
    }
    if (fact.supersededBy === fact.id) ctx.addIssue({ code: "custom", message: "A fact cannot supersede itself", path: ["supersededBy"] });
  });

export const PROPOSAL_STATUSES = ["pending", "accepted", "rejected"] as const;

/**
 * A proposal: tasks, steps and relations the person can accept or reject. Nothing in it is in the plan
 * until it is accepted. "resolves" is the gap it fills, if the reason is a gap.
 */
/**
 * The structure of the plan as the plan level proposes it: phases, the tier of each department, the relations
 * between departments, and the requests and questions for the person (text only, shown and never applied).
 */
const StructureTextSchema = text(MAX_STRUCTURE_TEXT);
export const StructureSchema = z.strictObject({
  phases: z.array(PhaseSchema).min(1).max(STRUCTURE_LIMITS.phases),
  tiers: z.array(z.strictObject({ departmentId: IdSchema, tier: TierSchema })).max(STRUCTURE_LIMITS.tiers),
  relations: z.array(DepartmentRelationSchema).max(STRUCTURE_LIMITS.relations),
  requests: z.array(StructureTextSchema).max(STRUCTURE_LIMITS.requests),
  questions: z.array(StructureTextSchema).max(STRUCTURE_LIMITS.questions),
});
export type Structure = z.infer<typeof StructureSchema>;

/** What a proposal is about: a fact, a gap (a task), or the plan as a whole (its structure) */
const ProposalReasonSchema = z.union([
  z.strictObject({ factId: IdSchema }),
  z.strictObject({ taskId: IdSchema }),
  z.strictObject({ scope: z.literal("plan") }),
]);

/**
 * A proposal: tasks, steps and relations the person can accept or reject. Nothing in it is in the plan
 * until it is accepted. "resolves" is the gap it fills, if the reason is a gap. A structure proposal has the
 * plan scope, an empty "add", and its structure; the two kinds never mix.
 */
const ProposalSchema = z
  .strictObject({
    id: IdSchema,
    status: z.enum(PROPOSAL_STATUSES),
    reason: ProposalReasonSchema,
    resolves: IdSchema.optional(),
    add: z.strictObject({
      tasks: z.array(TaskSchema).max(PROPOSAL_LIMITS.tasks),
      steps: z.array(StepSchema).max(PROPOSAL_LIMITS.steps),
      relations: z.array(RelationSchema).max(PROPOSAL_LIMITS.relations),
    }),
    structure: StructureSchema.optional(),
    notes: z.array(text(PROPOSAL_NOTE_LIMITS.text)).max(PROPOSAL_NOTE_LIMITS.notes).optional(),
    createdAt: DateTimeSchema,
    decidedAt: DateTimeSchema.optional(),
  })
  .superRefine((proposal, ctx) => {
    const isStructure = proposal.structure !== undefined;
    if (isStructure !== ("scope" in proposal.reason)) {
      ctx.addIssue({ code: "custom", message: "Only a plan structure has the plan scope", path: ["reason"] });
    }
    if (!isStructure) return;
    const { tasks, steps, relations } = proposal.add;
    if (tasks.length + steps.length + relations.length > 0 || proposal.resolves !== undefined) {
      ctx.addIssue({ code: "custom", message: "A plan structure adds nothing else", path: ["add"] });
    }
  });

export const PlanSchema = z
  .strictObject({
    timeline: TimelineSchema.optional(),
    departments: z.array(DepartmentSchema).max(LIMITS.departments),
    phases: z.array(PhaseSchema).max(LIMITS.phases),
    tasks: z.array(TaskSchema).max(LIMITS.tasks),
    steps: z.array(StepSchema).max(LIMITS.steps),
    relations: z.array(RelationSchema).max(LIMITS.relations),
    facts: z.array(FactSchema).max(MAX_FACTS).optional(),
    proposals: z.array(ProposalSchema).max(MAX_PROPOSALS).optional(),
  })
  .superRefine((plan, ctx) => {
    const growth = [
      ["facts", plan.facts ?? []],
      ["proposals", plan.proposals ?? []],
    ] as const;
    for (const [key, items] of growth) {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id)) ctx.addIssue({ code: "custom", message: "Duplicate id", path: [key, index, "id"] });
        seen.add(item.id);
      });
    }
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
export type FactTerm = z.infer<typeof FactTermSchema>;
export type Fact = NonNullable<Plan["facts"]>[number];
export type Proposal = NonNullable<Plan["proposals"]>[number];

/** Validates a stored or generated plan. The error lists paths and codes, never values. */
export function parsePlan(value: unknown): Plan {
  const result = PlanSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid plan: ${summarizeIssues(result.error)}`);
  return result.data;
}
