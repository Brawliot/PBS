import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan } from "../../plan/plan-check.js";
import { parsePlan, type Plan } from "../../plan/plan-model.js";
import { confirmFact, proposeFact, rejectFact, staleItems } from "../../plan/fact-actions.js";
import { applyProposalAction, createProposal, expandable, proposeExpansion, type ProposalInput } from "../../plan/proposals.js";
import { derivePlan } from "../../plan/plan-derived.js";
import { prng } from "./prng.js";
import { exampleGrowthPlan } from "./growth-fixtures.js";

const NOW = "2026-10-08T10:00:00Z";
const LATER = "2026-10-08T11:00:00Z";
const at = (instant: string) => ({ now: () => instant });
const catalog = (id: string) => ({ kind: "catalog" as const, id });
const other = (text: string) => ({ kind: "other" as const, text });

describe("the whole example: a gap grows into the development", () => {
  test("proposed by AI, not confirmable by AI, confirmed by the person, expanded, accepted, then changed", () => {
    const start = exampleGrowthPlan();
    assert.deepEqual(checkPlan(start), []);

    // The AI proposes the fact from its own step
    const proposed = proposeFact(start, { key: catalog("product_type"), value: catalog("mobile_game"), stepId: "s-idea" }, { ...at(NOW), actor: "ai" });
    if (!proposed.ok) throw new Error("expected ok");
    assert.deepEqual(proposed.fact, {
      id: "fact-product_type",
      key: catalog("product_type"),
      value: catalog("mobile_game"),
      status: "proposed",
      from: { kind: "step", stepId: "s-idea" },
      createdAt: NOW,
    });

    // The AI cannot confirm it, and the gap is not expandable yet
    assert.deepEqual(confirmFact(proposed.plan, "fact-product_type", { ...at(LATER), actor: "ai" }), { ok: false, code: "wrong_actor" });
    assert.equal(expandable(proposed.plan, "t-plan"), false);
    assert.deepEqual(proposeExpansion(proposed.plan, "t-plan"), { ok: false, code: "not_expandable" });

    // The person confirms it: the gap becomes expandable
    const confirmed = confirmFact(proposed.plan, "fact-product_type", { ...at(LATER), actor: "user" });
    if (!confirmed.ok) throw new Error("expected ok");
    assert.equal(confirmed.fact.status, "confirmed");
    assert.equal(confirmed.fact.confirmedAt, LATER);
    assert.equal(expandable(confirmed.plan, "t-plan"), true);

    // The proposal for mobile_game, created and accepted by the person
    const expansion = proposeExpansion(confirmed.plan, "t-plan");
    if (!expansion.ok) throw new Error("expected ok");
    assert.equal(expansion.proposal.id, "expand-mobile-game-t-plan");
    const created = createProposal(confirmed.plan, expansion.proposal, at(LATER));
    if (!created.ok) throw new Error("expected ok");
    assert.equal(created.proposal.status, "pending");
    const accepted = applyProposalAction(created.plan, "expand-mobile-game-t-plan", "accept", { ...at(LATER), actor: "user" });
    if (!accepted.ok) throw new Error("expected ok");

    const plan = accepted.plan;
    assert.deepEqual(checkPlan(plan), []);
    assert.deepEqual(
      plan.tasks.map((task) => task.id),
      ["t-idea", "t-plan", "expand-mobile-game-design", "expand-mobile-game-prototype", "expand-mobile-game-publish"],
    );
    assert.equal(plan.tasks.find((task) => task.id === "t-plan")!.placeholder, undefined, "the gap is resolved");
    assert.deepEqual(
      plan.steps.map((step) => [step.id, step.executor, step.derivedFrom]),
      [
        ["s-idea", "ai", undefined],
        ["expand-mobile-game-design-ai", "ai", ["fact-product_type"]],
        ["expand-mobile-game-design-decide", "user", ["fact-product_type"]],
        ["expand-mobile-game-prototype-ai", "ai", ["fact-product_type"]],
        ["expand-mobile-game-prototype-decide", "user", ["fact-product_type"]],
        ["expand-mobile-game-publish-ai", "ai", ["fact-product_type"]],
        ["expand-mobile-game-publish-decide", "user", ["fact-product_type"]],
      ],
    );
    assert.deepEqual(
      plan.tasks.filter((task) => task.derivedFrom).map((task) => [task.id, task.primaryDepartmentId, task.derivedFrom]),
      [
        ["expand-mobile-game-design", "product", ["fact-product_type"]],
        ["expand-mobile-game-prototype", "technology", ["fact-product_type"]],
        ["expand-mobile-game-publish", "operations", ["fact-product_type"]],
      ],
    );
    assert.deepEqual(staleItems(plan, "fact-product_type"), { taskIds: [], stepIds: [] }, "nothing is stale while the fact is confirmed");
    assert.equal(derivePlan(plan).confirmedFacts["product_type"].factId, "fact-product_type");

    // The decision changes to web_app: the old fact is superseded, and its items are stale
    const web = proposeFact(plan, { key: catalog("product_type"), value: catalog("web_app") }, { ...at(LATER), actor: "user" });
    if (!web.ok) throw new Error("expected ok");
    assert.equal(web.fact.id, "fact-product_type-2");
    const webConfirmed = confirmFact(web.plan, "fact-product_type-2", { ...at("2026-10-08T12:00:00Z"), actor: "user" });
    if (!webConfirmed.ok) throw new Error("expected ok");
    const mobile = webConfirmed.plan.facts!.find((fact) => fact.id === "fact-product_type")!;
    assert.equal(mobile.status, "superseded");
    assert.equal(mobile.supersededBy, "fact-product_type-2");
    assert.deepEqual(staleItems(webConfirmed.plan, "fact-product_type"), {
      taskIds: ["expand-mobile-game-design", "expand-mobile-game-prototype", "expand-mobile-game-publish"],
      stepIds: [
        "expand-mobile-game-design-ai",
        "expand-mobile-game-design-decide",
        "expand-mobile-game-prototype-ai",
        "expand-mobile-game-prototype-decide",
        "expand-mobile-game-publish-ai",
        "expand-mobile-game-publish-decide",
      ],
    });
    assert.deepEqual(staleItems(webConfirmed.plan, "fact-product_type-2"), { taskIds: [], stepIds: [] });
    assert.deepEqual(checkPlan(webConfirmed.plan), [], "superseded facts keep the plan valid");
  });
});

describe("facts", () => {
  const base = exampleGrowthPlan();
  const productType = catalog("product_type");

  test("only the AI from one of its own steps, or the person, can propose", () => {
    assert.deepEqual(proposeFact(base, { key: productType, value: catalog("saas") }, { ...at(NOW), actor: "system" }), { ok: false, code: "wrong_actor" });
    assert.deepEqual(proposeFact(base, { key: productType, value: catalog("saas") }, { ...at(NOW), actor: "ai" }), { ok: false, code: "unknown_step" });
    assert.deepEqual(proposeFact(base, { key: productType, value: catalog("saas"), stepId: "ghost" }, { ...at(NOW), actor: "ai" }), { ok: false, code: "unknown_step" });
    assert.deepEqual(proposeFact(base, { key: productType, value: catalog("saas"), stepId: "s-idea" }, { ...at(NOW), actor: "user" }), { ok: false, code: "invalid_fact" }, "the person does not name a step");
  });

  test("the person can propose without a step, and the id counts up for the same key", () => {
    const first = proposeFact(base, { key: productType, value: catalog("saas") }, { ...at(NOW), actor: "user" });
    if (!first.ok) throw new Error("expected ok");
    assert.equal(first.fact.id, "fact-product_type");
    assert.deepEqual(first.fact.from, { kind: "user" });
    const second = proposeFact(first.plan, { key: productType, value: catalog("marketplace") }, { ...at(NOW), actor: "user" });
    if (!second.ok) throw new Error("expected ok");
    assert.equal(second.fact.id, "fact-product_type-2");
  });

  test("values follow the catalog: product_type takes its own values, other keys take free text only", () => {
    const user = { ...at(NOW), actor: "user" as const };
    assert.deepEqual(proposeFact(base, { key: productType, value: catalog("spaceship") }, user), { ok: false, code: "invalid_fact" });
    assert.deepEqual(proposeFact(base, { key: productType, value: other("a boat") }, user), { ok: false, code: "invalid_fact" });
    assert.deepEqual(proposeFact(base, { key: catalog("revenue_model"), value: catalog("subscription") }, user), { ok: false, code: "invalid_fact" });
    assert.deepEqual(proposeFact(base, { key: catalog("unknown_key"), value: other("x") }, user), { ok: false, code: "invalid_fact" });
    const free = proposeFact(base, { key: catalog("target_customer"), value: other("Tourists in Madrid") }, user);
    if (!free.ok) throw new Error("expected ok");
    assert.equal(free.fact.id, "fact-target_customer");
    const freeKey = proposeFact(base, { key: other("Launch date"), value: other("Spring") }, user);
    if (!freeKey.ok) throw new Error("expected ok");
    assert.equal(freeKey.fact.id, "fact-other");
  });

  test("confirming: the person only, and only a proposed fact", () => {
    const proposed = proposeFact(base, { key: productType, value: catalog("saas") }, { ...at(NOW), actor: "user" });
    if (!proposed.ok) throw new Error("expected ok");
    assert.deepEqual(confirmFact(proposed.plan, "ghost", { ...at(NOW), actor: "user" }), { ok: false, code: "unknown_fact" });
    assert.deepEqual(confirmFact(proposed.plan, "fact-product_type", { ...at(NOW), actor: "system" }), { ok: false, code: "wrong_actor" });
    const confirmed = confirmFact(proposed.plan, "fact-product_type", { ...at(NOW), actor: "user" });
    if (!confirmed.ok) throw new Error("expected ok");
    assert.deepEqual(confirmFact(confirmed.plan, "fact-product_type", { ...at(LATER), actor: "user" }), { ok: false, code: "not_proposed" });
    const rejected = rejectFact(proposed.plan, "fact-product_type", { ...at(NOW), actor: "user" });
    if (!rejected.ok) throw new Error("expected ok");
    assert.equal(rejected.fact.status, "rejected");
    assert.deepEqual(confirmFact(rejected.plan, "fact-product_type", { ...at(NOW), actor: "user" }), { ok: false, code: "not_proposed" });
    assert.deepEqual(rejectFact(proposed.plan, "fact-product_type", { ...at(NOW), actor: "ai" }), { ok: false, code: "wrong_actor" });
  });

  test("confirming a key that already has a confirmed fact supersedes the old one, and no key has two confirmed", () => {
    let plan = base;
    for (const value of ["saas", "marketplace", "service"]) {
      const proposed = proposeFact(plan, { key: productType, value: catalog(value) }, { ...at(NOW), actor: "user" });
      if (!proposed.ok) throw new Error("expected ok");
      const confirmed = confirmFact(proposed.plan, proposed.fact.id, { ...at(LATER), actor: "user" });
      if (!confirmed.ok) throw new Error("expected ok");
      plan = confirmed.plan;
    }
    const confirmed = plan.facts!.filter((fact) => fact.status === "confirmed");
    assert.deepEqual(confirmed.map((fact) => fact.id), ["fact-product_type-3"]);
    assert.deepEqual(
      plan.facts!.map((fact) => [fact.id, fact.status, fact.supersededBy]),
      [
        ["fact-product_type", "superseded", "fact-product_type-2"],
        ["fact-product_type-2", "superseded", "fact-product_type-3"],
        ["fact-product_type-3", "confirmed", undefined],
      ],
    );
    assert.deepEqual(checkPlan(plan), []);
  });
});

describe("proposals", () => {
  /** The example with its mobile_game fact confirmed: the plan a gap can be expanded from */
  function confirmedExample(): Plan {
    const proposed = proposeFact(exampleGrowthPlan(), { key: catalog("product_type"), value: catalog("mobile_game"), stepId: "s-idea" }, { ...at(NOW), actor: "ai" });
    if (!proposed.ok) throw new Error("expected ok");
    const confirmed = confirmFact(proposed.plan, "fact-product_type", { ...at(NOW), actor: "user" });
    if (!confirmed.ok) throw new Error("expected ok");
    return confirmed.plan;
  }
  /** The plan of a successful result (the failed ones have no plan, and the test fails here) */
  const planOf = (result: { ok: boolean; plan?: Plan }): Plan => {
    if (!result.ok || !result.plan) throw new Error("expected ok");
    return result.plan;
  };
  const origin = { kind: "template" } as const;
  const task = (id: string, phaseId: string, derivedFrom?: string[]) =>
    ({
      id,
      phaseId,
      primaryDepartmentId: "product",
      title: id,
      origin,
      confidence: 100,
      ...(derivedFrom && { derivedFrom }),
    }) as Plan["tasks"][number];
  const step = (id: string, taskId: string, derivedFrom?: string[]) =>
    ({
      id,
      taskId,
      departmentId: "product",
      text: id,
      executor: "user",
      mode: "online",
      evidence: { kind: "none" },
      effortHours: 1,
      waitDays: 0,
      status: "not_started",
      events: [],
      origin,
      confidence: 100,
      ...(derivedFrom && { derivedFrom }),
    }) as Plan["steps"][number];
  const input = (id: string, extra: Partial<ProposalInput> = {}): ProposalInput => ({
    id,
    reason: { taskId: "t-plan" },
    resolves: "t-plan",
    add: { tasks: [task(`${id}-task`, "f2", ["fact-product_type"])], steps: [step(`${id}-step`, `${id}-task`, ["fact-product_type"])], relations: [] },
    ...extra,
  });

  test("a gap waits for its keys: expandable only with every key confirmed", () => {
    assert.equal(expandable(exampleGrowthPlan(), "t-plan"), false);
    assert.equal(expandable(exampleGrowthPlan(), "t-idea"), false, "not a gap");
    assert.equal(expandable(confirmedExample(), "t-plan"), true);
  });

  test("creation refuses what the rules refuse, with a closed code", () => {
    const plan = confirmedExample();
    const now = at(LATER);
    assert.deepEqual(createProposal(exampleGrowthPlan(), input("p1"), now), { ok: false, code: "not_expandable" }, "a gap that waits for a key not confirmed");
    assert.deepEqual(createProposal(plan, input("p1", { reason: { taskId: "t-idea" }, resolves: undefined }), now), { ok: false, code: "not_expandable" });
    assert.deepEqual(createProposal(plan, input("p1", { reason: { taskId: "ghost" }, resolves: undefined }), now), { ok: false, code: "unknown_reason" });
    assert.deepEqual(createProposal(plan, input("p1", { reason: { factId: "ghost" }, resolves: undefined }), now), { ok: false, code: "unknown_reason" });
    assert.deepEqual(createProposal(plan, input("p1", { reason: { factId: "fact-product_type" }, resolves: undefined }), now).ok, true, "a confirmed fact is a reason too");
    assert.deepEqual(
      createProposal(plan, input("p1", { add: { tasks: [], steps: [], relations: [] } }), now).ok,
      true,
      "an empty proposal is allowed (nothing to add)",
    );
    const noDerivation = input("p1", { add: { tasks: [task("x", "f2")], steps: [], relations: [] } });
    assert.deepEqual(createProposal(plan, noDerivation, now), { ok: false, code: "invalid_proposal" });
    const notConfirmed = input("p1", { add: { tasks: [task("x", "f2", ["fact-missing"])], steps: [], relations: [] } });
    assert.deepEqual(createProposal(plan, notConfirmed, now), { ok: false, code: "not_confirmed" });
    const clash = input("p1", { add: { tasks: [task("t-idea", "f2", ["fact-product_type"])], steps: [], relations: [] } });
    assert.deepEqual(createProposal(plan, clash, now), { ok: false, code: "id_taken" });
    const big = input("p1", { add: { tasks: Array.from({ length: 21 }, (_, i) => task(`big-${i}`, "f2", ["fact-product_type"])), steps: [], relations: [] } });
    assert.deepEqual(createProposal(plan, big, now), { ok: false, code: "too_large" });
    const badDepartment = input("p1", { add: { tasks: [], steps: [{ ...step("bad", "t-plan", ["fact-product_type"]), departmentId: "nobody" }], relations: [] } });
    assert.deepEqual(createProposal(plan, badDepartment, now), { ok: false, code: "invalid_result" });
  });

  test("one pending proposal per reason: the second one is refused until the first is decided", () => {
    const plan = confirmedExample();
    const first = createProposal(plan, input("p1"), at(LATER));
    if (!first.ok) throw new Error("expected ok");
    assert.deepEqual(createProposal(first.plan, input("p2"), at(LATER)), { ok: false, code: "duplicate_pending" });
    // The id of a proposal is taken, even for another reason
    assert.deepEqual(createProposal(first.plan, input("p1", { reason: { factId: "fact-product_type" }, resolves: undefined }), at(LATER)), { ok: false, code: "id_taken" });
    const rejected = applyProposalAction(first.plan, "p1", "reject", { ...at(LATER), actor: "user" });
    if (!rejected.ok) throw new Error("expected ok");
    assert.equal(rejected.proposal.status, "rejected");
    assert.equal(rejected.proposal.decidedAt, LATER);
    assert.ok(createProposal(rejected.plan, input("p2"), at(LATER)).ok, "a decided proposal no longer blocks");
  });

  test("accepting: the person only, once, and only while the facts still hold", () => {
    const plan = confirmedExample();
    const created = createProposal(plan, input("p1"), at(LATER));
    if (!created.ok) throw new Error("expected ok");
    assert.deepEqual(applyProposalAction(created.plan, "p1", "accept", { ...at(LATER), actor: "ai" }), { ok: false, code: "wrong_actor" });
    assert.deepEqual(applyProposalAction(created.plan, "ghost", "accept", { ...at(LATER), actor: "user" }), { ok: false, code: "unknown_proposal" });

    const accepted = applyProposalAction(created.plan, "p1", "accept", { ...at(LATER), actor: "user" });
    if (!accepted.ok) throw new Error("expected ok");
    assert.deepEqual(applyProposalAction(accepted.plan, "p1", "accept", { ...at(LATER), actor: "user" }), { ok: false, code: "already_decided" });
    assert.deepEqual(applyProposalAction(accepted.plan, "p1", "reject", { ...at(LATER), actor: "user" }), { ok: false, code: "already_decided" });

    // A proposal made from a fact that has since been superseded cannot be accepted any more
    const other = confirmFact(
      planOf(proposeFact(created.plan, { key: catalog("product_type"), value: catalog("saas") }, { ...at(LATER), actor: "user" })),
      "fact-product_type-2",
      { ...at(LATER), actor: "user" },
    );
    if (!other.ok) throw new Error("expected ok");
    assert.deepEqual(applyProposalAction(other.plan, "p1", "accept", { ...at(LATER), actor: "user" }), { ok: false, code: "not_confirmed" });
  });

  test("proposeExpansion: a template per confirmed value; another value needs the AI", () => {
    const plan = confirmedExample();
    assert.equal(proposeExpansion(plan, "t-plan").ok, true);
    const saas = confirmFact(
      planOf(proposeFact(plan, { key: catalog("product_type"), value: catalog("saas") }, { ...at(LATER), actor: "user" })),
      "fact-product_type-2",
      { ...at(LATER), actor: "user" },
    );
    assert.deepEqual(proposeExpansion(planOf(saas), "t-plan"), { ok: false, code: "needs_ai" });
    assert.deepEqual(proposeExpansion(exampleGrowthPlan(), "t-plan"), { ok: false, code: "not_expandable" });
  });
});

describe("the problems of the growth, as checkPlan reports them", () => {
  const task = (id: string, phaseId: string) =>
    ({ id, phaseId, primaryDepartmentId: "product", title: id, origin: { kind: "template" }, confidence: 100 }) as Plan["tasks"][number];
  const withFacts = (facts: unknown[], extra: Record<string, unknown> = {}) => ({ ...exampleGrowthPlan(), facts, ...extra }) as unknown as Plan;
  const fact = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    key: catalog("product_type"),
    value: catalog("mobile_game"),
    status,
    from: { kind: "user" },
    createdAt: NOW,
    ...(status === "confirmed" && { confirmedAt: LATER }),
    ...extra,
  });

  test("each code is reported where it belongs", () => {
    const codes = (plan: Plan) => checkPlan(plan).map((problem) => [problem.code, problem.level]);
    assert.deepEqual(codes(withFacts([fact("f1", "confirmed", { key: catalog("nope") })])), [["fact_unknown_key", "fact"]]);
    assert.deepEqual(codes(withFacts([fact("f1", "proposed", { value: catalog("spaceship") })])), [["fact_value_not_allowed", "fact"]]);
    assert.deepEqual(codes(withFacts([fact("f1", "proposed", { from: { kind: "step", stepId: "ghost" } })])), [["fact_unknown_step", "fact"]]);
    assert.deepEqual(codes(withFacts([fact("f1", "confirmed"), fact("f2", "confirmed")])), [["fact_duplicate_confirmed", "fact"]]);
    assert.deepEqual(codes(withFacts([fact("f1", "superseded", { supersededBy: "ghost", confirmedAt: LATER })])), [["fact_superseded_by_broken", "fact"]]);
    // The successor must be a fact of the same key
    assert.deepEqual(
      codes(withFacts([fact("f1", "superseded", { supersededBy: "f2", confirmedAt: LATER }), fact("f2", "confirmed", { key: catalog("target_customer"), value: other("x") })])),
      [["fact_superseded_by_broken", "fact"]],
    );
    assert.deepEqual(
      codes(withFacts([fact("f1", "superseded", { supersededBy: "f2", confirmedAt: LATER }), fact("f2", "confirmed", { value: other("x") })])),
      [["fact_value_not_allowed", "fact"]],
    );
    assert.deepEqual(codes(withFacts([fact("f1", "confirmed", { key: catalog("saas") })])), [["fact_unknown_key", "fact"]]);
    const withDerived = { ...exampleGrowthPlan(), tasks: exampleGrowthPlan().tasks.map((t) => (t.id === "t-idea" ? { ...t, derivedFrom: ["ghost"] } : t)) } as unknown as Plan;
    assert.deepEqual(codes(withDerived), [["derived_from_unknown_fact", "fact"]]);
    const gapWithSteps = { ...exampleGrowthPlan(), steps: [{ ...exampleGrowthPlan().steps[0], taskId: "t-plan" }] } as unknown as Plan;
    assert.deepEqual(codes(gapWithSteps), [["placeholder_has_steps", "task"]]);
    const badKey = { ...exampleGrowthPlan(), tasks: exampleGrowthPlan().tasks.map((t) => (t.id === "t-plan" ? { ...t, placeholder: { waitsFor: ["nope"] } } : t)) } as unknown as Plan;
    assert.deepEqual(codes(badKey), [["placeholder_unknown_key", "task"]]);
    const proposal = (extra: Record<string, unknown>) => ({ id: "p1", status: "pending", reason: { taskId: "t-plan" }, add: { tasks: [], steps: [], relations: [] }, createdAt: NOW, ...extra });
    assert.deepEqual(codes({ ...exampleGrowthPlan(), proposals: [proposal({ reason: { factId: "ghost" } })] } as unknown as Plan), [["proposal_reason_unknown", "proposal"]]);
    assert.deepEqual(codes({ ...exampleGrowthPlan(), proposals: [proposal({ resolves: "t-idea" })] } as unknown as Plan), [["proposal_resolves_unknown_task", "proposal"]]);
    assert.deepEqual(codes({ ...exampleGrowthPlan(), proposals: [proposal({ decidedAt: LATER })] } as unknown as Plan), [["proposal_pending_has_time", "proposal"]]);
    assert.deepEqual(codes({ ...exampleGrowthPlan(), proposals: [proposal({ status: "accepted" })] } as unknown as Plan), [["proposal_decided_without_time", "proposal"]]);
    const clash = { ...exampleGrowthPlan(), proposals: [proposal({ add: { tasks: [{ ...task("t-idea", "f2") }], steps: [], relations: [] } })] } as unknown as Plan;
    assert.deepEqual(codes(clash), [["proposal_pending_ids_exist", "proposal"]]);
  });


  test("the schema rejects a confirmed fact without its date, and a superseded one without its successor", () => {
    const base = exampleGrowthPlan();
    assert.throws(() => parsePlan({ ...base, facts: [{ ...fact("f1", "confirmed"), confirmedAt: undefined }] }));
    assert.throws(() => parsePlan({ ...base, facts: [{ ...fact("f1", "superseded", { confirmedAt: LATER }) }] }));
    assert.throws(() => parsePlan({ ...base, facts: [fact("f1", "proposed", { supersededBy: "f2" })] }));
    assert.throws(() => parsePlan({ ...base, facts: [fact("f1", "proposed"), fact("f1", "proposed")] }), /Duplicate|id/);
  });
});

describe("what was there before still reads the same", () => {
  test("a document without facts, gaps or proposals is valid and unchanged", () => {
    const old = { timeline: { unit: "week" }, departments: [{ id: "product", name: "Product", tier: "core" }], phases: [{ id: "f1", name: "Prepare", order: 0 }], tasks: [], steps: [], relations: [] };
    assert.deepEqual(parsePlan(structuredClone(old)), old);
  });
});

describe("random sequences keep the plan without problems", () => {
  test("seeded: every change that succeeds leaves checkPlan empty and the document valid", () => {
    for (const seed of [11, 4242, 90210]) {
      const random = prng(seed);
      let plan = exampleGrowthPlan();
      let counter = 0;
      let accepted = 0;
      for (let round = 0; round < 250; round++) {
        const clock = at(`2026-10-08T${String(10 + (round % 12)).padStart(2, "0")}:00:00Z`);
        let next: Plan | undefined;
        switch (random.int(5)) {
          case 0: {
            const value = random.pick(["mobile_game", "web_app", "saas", "spaceship"]);
            const result = proposeFact(plan, { key: catalog("product_type"), value: catalog(value), ...(random.chance(0.5) && { stepId: "s-idea" }) }, { ...clock, actor: random.chance(0.5) ? "user" : "ai" });
            if (result.ok) next = result.plan;
            break;
          }
          case 1: {
            const proposed = (plan.facts ?? []).filter((fact) => fact.status === "proposed");
            if (proposed.length) {
              const result = confirmFact(plan, random.pick(proposed).id, { ...clock, actor: "user" });
              if (result.ok) next = result.plan;
            }
            break;
          }
          case 2: {
            const proposed = (plan.facts ?? []).filter((fact) => fact.status === "proposed");
            if (proposed.length) {
              const result = rejectFact(plan, random.pick(proposed).id, { ...clock, actor: "user" });
              if (result.ok) next = result.plan;
            }
            break;
          }
          case 3: {
            const expansion = proposeExpansion(plan, "t-plan");
            if (expansion.ok) {
              counter++;
              const result = createProposal(plan, { ...expansion.proposal, id: `${expansion.proposal.id}-${counter}` }, clock);
              if (result.ok) next = result.plan;
            }
            break;
          }
          default: {
            const pending = (plan.proposals ?? []).filter((item) => item.status === "pending");
            if (pending.length) {
              const result = applyProposalAction(plan, random.pick(pending).id, random.chance(0.7) ? "accept" : "reject", { ...clock, actor: "user" });
              if (result.ok) {
                next = result.plan;
                if (result.proposal.status === "accepted") accepted++;
              }
            }
          }
        }
        if (!next) continue;
        assert.deepEqual(checkPlan(next), [], `seed ${seed}, round ${round}`);
        assert.doesNotThrow(() => parsePlan(JSON.parse(JSON.stringify(next))), `seed ${seed}, round ${round}`);
        const confirmedKeys = (next.facts ?? []).filter((fact) => fact.status === "confirmed").length;
        assert.ok(confirmedKeys <= 1, "one confirmed product_type at most");
        plan = next;
      }
      assert.ok(accepted >= 1, `seed ${seed} accepted at least one proposal`);
    }
  });
});
