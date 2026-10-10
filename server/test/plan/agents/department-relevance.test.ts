import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runDepartmentTasks, runDepartments } from "../../../plan/agents/department-agent.js";
import { buildDepartmentInput } from "../../../plan/agents/department-input.js";
import type { AgentModel, AgentRequest, RelevanceJudge } from "../../../plan/agents/contract.js";
import { MAX_AGENT_IDEA } from "../../../plan/agents/contract.js";
import { FakeModel, NOW, planWithFact } from "./fakes.js";

const IDEA = "A Japanese restaurant with a bar";
const EXTRAS = { facts: [], requests: [], questions: [] };

/** A judge that keeps every text it is given, so a test can read what Jev received */
class RecordingJudge implements RelevanceJudge {
  readonly seen: string[] = [];
  async judge(_idea: string, text: string): Promise<boolean> {
    this.seen.push(text);
    return true;
  }
}

/** A model that answers each department by its role */
class RoleModel implements AgentModel {
  readonly requests: AgentRequest[] = [];
  constructor(private readonly answer: (role: string) => unknown) {}
  async complete(request: AgentRequest): Promise<unknown> {
    this.requests.push(request);
    return structuredClone(this.answer(request.role));
  }
}

const { plan, factId } = planWithFact();
const legalInput = () => buildDepartmentInput(plan, "legal", IDEA)!;
const legalTasks = (factIdValue: string) => ({
  tasks: [{ id: "legal-register-business", phaseId: plan.phases[0].id, title: "Register the business", derivedFrom: [factIdValue] }],
  relations: [],
  ...EXTRAS,
});

describe("a department with nothing relevant to propose", () => {
  test("an empty task list is a valid answer: no proposal, no call to Jev, no failure", async () => {
    const judge = new RecordingJudge();
    const result = await runDepartmentTasks({ model: new FakeModel([{ tasks: [], relations: [], ...EXTRAS }]), judge, attempts: 1 }, legalInput(), plan, { now: () => NOW });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.proposal, undefined);
      assert.equal(result.value.checked, false);
    }
    assert.deepEqual(judge.seen, [], "Jev is not asked about nothing");
  });

  test("one empty department among others: the others still propose, and the empty one adds nothing", async () => {
    const judge = new RecordingJudge();
    const model = new RoleModel((role) =>
      role === "department_legal"
        ? { tasks: [], relations: [], ...EXTRAS }
        : { tasks: [{ id: "finance-secure-funding", phaseId: plan.phases[0].id, title: "Secure funding", derivedFrom: [factId] }], relations: [], ...EXTRAS },
    );
    const result = await runDepartments({ model, judge, attempts: 1 }, [legalInput(), buildDepartmentInput(plan, "finance", IDEA)!], plan, { now: () => NOW });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.proposals.map((proposal) => proposal.add.tasks[0].primaryDepartmentId), ["finance"]);
    assert.equal(judge.seen.length, 1, "only the department with a task is judged");
  });

  test("the answer that says there is nothing is not retried: it is accepted on the first attempt", async () => {
    const model = new FakeModel([{ tasks: [], relations: [], ...EXTRAS }]);
    await runDepartmentTasks({ model, judge: null, attempts: 3 }, legalInput(), plan, { now: () => NOW });
    assert.equal(model.requests.length, 1);
  });
});

describe("what Jev reads about a department: its name, and the titles", () => {
  test("the text starts with the department's name, then the titles of its tasks", async () => {
    const judge = new RecordingJudge();
    await runDepartmentTasks({ model: new FakeModel([legalTasks(factId)]), judge, attempts: 1 }, legalInput(), plan, { now: () => NOW });
    assert.equal(judge.seen[0], "Department: Legal & Compliance\nRegister the business");
  });

  test("the department's name is kept when the titles are cut to the limit of an idea", async () => {
    const judge = new RecordingJudge();
    const long = { tasks: Array.from({ length: 20 }, (_, index) => ({ id: `legal-t${index}`, phaseId: plan.phases[0].id, title: "t".repeat(190), derivedFrom: [factId] })), relations: [], ...EXTRAS };
    await runDepartmentTasks({ model: new FakeModel([long]), judge, attempts: 1 }, legalInput(), plan, { now: () => NOW });
    assert.equal(judge.seen[0].length, MAX_AGENT_IDEA);
    assert.equal(judge.seen[0].startsWith("Department: Legal & Compliance\n"), true);
  });
});

describe("the department prompt: nothing to propose, the weight, and the order between tasks", () => {
  const system = async () => {
    const model = new FakeModel([{ tasks: [], relations: [], ...EXTRAS }]);
    await runDepartmentTasks({ model, judge: null, attempts: 1 }, legalInput(), plan, { now: () => NOW });
    return model.requests[0].system;
  };

  test("it says an empty list is valid, and that an invented task is worse than none", async () => {
    const text = await system();
    assert.match(text, /An empty list is a valid answer/);
    assert.match(text, /"tasks": \[\]/);
    assert.match(text, /An invented task is worse than none/);
  });

  test("it explains the weight of a department: core, important, light", async () => {
    const text = await system();
    assert.match(text, /core = central/);
    assert.match(text, /important = needed/);
    assert.match(text, /light = marginal/);
    assert.match(text, /"tier" in <department>/);
  });

  test("it gives a second example in the other direction, an existing task before a new one", async () => {
    const text = await system();
    assert.match(text, /"from":"verify-location","to":"operations-design-layout","type":"blocks"/);
    assert.match(text, /not by whether a task is new or already\s+exists/);
  });

  test("it says not to chain tasks just to list them in order", async () => {
    const text = await system();
    assert.match(text, /do not chain tasks just to list them in order/);
  });

  test("the rules of the validator are unchanged: prefixes, phases, loops and the direction words", async () => {
    const text = await system();
    assert.match(text, /STARTS with your department id/);
    assert.match(text, /A task that comes first must not sit in a LATER/);
    assert.match(text, /must not form a loop/);
    assert.match(text, /"A blocks B" means A must be ready BEFORE B/);
  });
});
