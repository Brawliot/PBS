import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, PROPOSAL_NOTE_LIMITS, type Plan } from "../../plan/plan-model.js";
import { restaurantPlan } from "../../plan/demo-plan.js";

const NOW = "2026-10-07T10:00:00Z";

/** The restaurant plan with one pending proposal that carries the given extra fields */
function withProposal(extra: Record<string, unknown>): unknown {
  const base = restaurantPlan();
  return {
    ...base,
    proposals: [
      {
        id: "agent-legal",
        status: "pending",
        reason: { factId: "fact-product_type" },
        add: { tasks: [], steps: [], relations: [] },
        createdAt: NOW,
        ...extra,
      },
    ],
  };
}

/** A plan with a pending task proposal and no notes: plans saved before the field existed */
function oldPlan(): Plan {
  const base = restaurantPlan();
  return parsePlan({
    ...base,
    proposals: [
      { id: "gap-1", status: "pending", reason: { taskId: "t-menu" }, add: { tasks: [], steps: [], relations: [] }, createdAt: NOW },
    ],
  });
}

describe("the notes of a proposal", () => {
  test("notes of text are accepted", () => {
    const plan = parsePlan(withProposal({ notes: ["Request to Plan: Confirm the opening date", "Suggested order: A before B"] }));
    assert.deepEqual(plan.proposals![0].notes, ["Request to Plan: Confirm the opening date", "Suggested order: A before B"]);
  });

  test("a plan without notes still reads, as before", () => {
    assert.equal(oldPlan().proposals![0].notes, undefined);
  });

  test("a list longer than the limit is refused", () => {
    const notes = Array.from({ length: PROPOSAL_NOTE_LIMITS.notes + 1 }, (_, index) => `Note ${index}`);
    assert.throws(() => parsePlan(withProposal({ notes })));
  });

  test("a text longer than the limit is refused", () => {
    assert.throws(() => parsePlan(withProposal({ notes: ["x".repeat(PROPOSAL_NOTE_LIMITS.text + 1)] })));
  });

  test("an empty text, and a text with a NUL character, are refused", () => {
    assert.throws(() => parsePlan(withProposal({ notes: ["   "] })));
    assert.throws(() => parsePlan(withProposal({ notes: ["a\u0000b"] })));
  });

  test("an extra field next to the notes is refused", () => {
    assert.throws(() => parsePlan(withProposal({ notes: ["ok"], author: "someone" })));
  });
});
