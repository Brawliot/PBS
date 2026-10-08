/**
 * Deterministic templates of what a gap expands into, by the value of product_type. EXAMPLE CONTENT,
 * not a final catalogue: the tasks, steps and departments are a proposal to review. Each template gets
 * the phase of the gap, the id prefix and the fact it comes from, and returns the tasks, steps and
 * relations to propose. An AI step feeds a decision of the person in each task.
 */

import type { Plan, Proposal } from "./plan-model.js";

export type ProposalAdd = Proposal["add"];

export interface TemplateContext {
  phaseId: string;
  prefix: string;
  factId: string;
}

type Template = (context: TemplateContext) => ProposalAdd;

const origin = { kind: "template" } as const;

/** One piece of work: an AI step that feeds the person's decision, in a department */
function workStep(context: TemplateContext, id: string, taskId: string, departmentId: string, ai: string, decision: string): ProposalAdd["steps"] {
  const base = {
    taskId,
    departmentId,
    effortHours: 2,
    waitDays: 0,
    status: "not_started" as const,
    events: [],
    origin,
    confidence: 100,
    derivedFrom: [context.factId],
  };
  return [
    { ...base, id: `${id}-ai`, text: ai, executor: "ai" as const, evidence: { kind: "accepted_output" as const } },
    {
      ...base,
      id: `${id}-decide`,
      text: decision,
      executor: "user" as const,
      mode: "online" as const,
      evidence: { kind: "written_confirmation" as const },
    },
  ];
}

/** Three tasks in a row (each follows the one before), each with its AI step and decision */
function chain(context: TemplateContext, parts: { key: string; title: string; department: string; ai: string; decision: string }[]): ProposalAdd {
  const { prefix, phaseId, factId } = context;
  const tasks: ProposalAdd["tasks"] = parts.map((part) => ({
    id: `${prefix}-${part.key}`,
    phaseId,
    primaryDepartmentId: part.department,
    title: part.title,
    origin,
    confidence: 100,
    derivedFrom: [factId],
  }));
  const steps: ProposalAdd["steps"] = parts.flatMap((part) => workStep(context, `${prefix}-${part.key}`, `${prefix}-${part.key}`, part.department, part.ai, part.decision));
  const relations: ProposalAdd["relations"] = [];
  for (const part of parts) relations.push({ level: "step", from: `${prefix}-${part.key}-ai`, to: `${prefix}-${part.key}-decide`, type: "feeds" });
  for (let index = 1; index < parts.length; index++) {
    relations.push({ level: "task", from: `${prefix}-${parts[index].key}`, to: `${prefix}-${parts[index - 1].key}`, type: "follows" });
  }
  return { tasks, steps, relations };
}

/** The gap's own phase, the tasks follow each other in the order listed */
export const EXPANSION_TEMPLATES: Readonly<Record<string, Template>> = {
  mobile_game: (context) =>
    chain(context, [
      { key: "design", title: "Design the game", department: "product", ai: "Draft the game concept and core loop", decision: "Decide the game concept" },
      { key: "prototype", title: "Prototype the game", department: "technology", ai: "Plan the prototype scope", decision: "Approve the prototype" },
      { key: "publish", title: "Publish the game to the stores", department: "operations", ai: "Prepare the store listing and checklist", decision: "Submit the game to the stores" },
    ]),
  web_app: (context) =>
    chain(context, [
      { key: "design", title: "Design the web app", department: "product", ai: "Draft the product scope and user flows", decision: "Decide the product scope" },
      { key: "build", title: "Build the web app", department: "technology", ai: "Plan the build and its milestones", decision: "Approve the build plan" },
      { key: "deploy", title: "Deploy the web app", department: "operations", ai: "Prepare the deployment checklist", decision: "Approve the deployment" },
    ]),
};

/** The templates use these departments: a plan without them cannot take the proposal */
export const TEMPLATE_DEPARTMENTS = ["product", "technology", "operations"] as const;

export const templateFor = (value: string): Template | undefined =>
  Object.hasOwn(EXPANSION_TEMPLATES, value) ? EXPANSION_TEMPLATES[value] : undefined;

export type { Plan };
