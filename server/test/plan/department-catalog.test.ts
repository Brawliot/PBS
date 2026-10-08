import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildDepartments, DEPARTMENT_IDS, GROUP_IDS, DEPENDENCY_ASPECTS, isCatalogAspect } from "../../plan/department-catalog.js";
import { analyzeValidation, GROUPS, type Validation } from "../../planner/planner-validation-handler.js";
import type { JevResponse, PlannerInput } from "../../planner/planner-handler.js";
import { mockFetch, jsonResponse } from "../planner/helpers.js";
import "../planner/helpers.js";

const TEN = [
  ["Legal & Compliance", "legal"],
  ["Finance", "finance"],
  ["HR", "hr"],
  ["Marketing", "marketing"],
  ["Sales", "sales"],
  ["Product", "product"],
  ["Technology", "technology"],
  ["Operations", "operations"],
  ["Infrastructure", "infrastructure"],
  ["Health", "health"],
] as const;

describe("department ids", () => {
  test("the ten departments have the expected stable ids, in GROUPS order", () => {
    const names = GROUPS.flatMap((group) => group.departments.map(([name]) => name));
    assert.deepEqual(Object.entries(DEPARTMENT_IDS), [...TEN]);
    assert.deepEqual(names, TEN.map(([name]) => name));
  });

  test("the six groups have the expected ids, in GROUPS order", () => {
    assert.deepEqual(
      Object.entries(GROUP_IDS),
      [
        ["Legal & Compliance", "legal"],
        ["Finance & People", "finance-people"],
        ["Growth", "growth"],
        ["Product & Tech", "product-tech"],
        ["Operations", "operations"],
        ["Health", "health"],
      ],
    );
    assert.deepEqual(Object.keys(GROUP_IDS), GROUPS.map((group) => group.group));
  });
});

describe("buildDepartments", () => {
  // Heaviest first, as the validation delivers them
  const validation = (order: readonly string[]): Pick<Validation, "departments"> => ({
    departments: order.map((name, index) => ({ name, confidence: 100 - index, tier: "light" as const })),
  });

  test("builds the ten departments with their ids and tiers, in the validation order", () => {
    const order = ["Health", "Legal & Compliance", "Finance", "HR", "Marketing", "Sales", "Product", "Technology", "Operations", "Infrastructure"];
    const tiers = order.map((_, index) => (index < 3 ? "core" : "light"));
    const input: Pick<Validation, "departments"> = {
      departments: order.map((name, index) => ({ name, confidence: 100 - index, tier: tiers[index] as "core" | "light" })),
    };
    assert.deepEqual(buildDepartments(input), [
      { id: "health", name: "Health", tier: "core" },
      { id: "legal", name: "Legal & Compliance", tier: "core" },
      { id: "finance", name: "Finance", tier: "core" },
      { id: "hr", name: "HR", tier: "light" },
      { id: "marketing", name: "Marketing", tier: "light" },
      { id: "sales", name: "Sales", tier: "light" },
      { id: "product", name: "Product", tier: "light" },
      { id: "technology", name: "Technology", tier: "light" },
      { id: "operations", name: "Operations", tier: "light" },
      { id: "infrastructure", name: "Infrastructure", tier: "light" },
    ]);
  });

  test("a validation missing a department is an error with its code, never an invented department", () => {
    const withoutHealth = TEN.slice(0, 9).map(([name]) => name);
    assert.throws(
      () => buildDepartments(validation(withoutHealth)),
      (error: Error & { code?: string }) => error.code === "missing_department" && error.message.includes("health"),
    );
  });

  test("the base departments (Legal & Compliance, Finance, Marketing) are at least important, from the real validation", async () => {
    // Jev scores nothing: every department is at zero, so only the baseline can lift them
    mockFetch(() => jsonResponse(200, { model: "test", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }));
    const input: PlannerInput = { idea: "Bakery delivery", budget: 10_000, experience: 1, team: 1, hours: 1 };
    const jev: JevResponse = { model: "test", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
    const built = buildDepartments(await analyzeValidation(input, jev, {}, []));
    const tierOf = (name: string) => built.find((department) => department.name === name)?.tier;
    assert.equal(tierOf("Legal & Compliance"), "important");
    assert.equal(tierOf("Finance"), "important");
    assert.equal(tierOf("Marketing"), "important");
    assert.equal(tierOf("Health"), "light");
    assert.equal(built.length, 10);
  });
});

describe("dependency aspects", () => {
  test("the closed list has the nine agreed aspects, each with a one-line description", () => {
    assert.deepEqual(Object.keys(DEPENDENCY_ASPECTS), [
      "data-protection", "contracts", "product-spec", "pricing", "licenses", "hiring", "budget", "brand", "suppliers",
    ]);
    for (const description of Object.values(DEPENDENCY_ASPECTS)) {
      assert.ok(description.length > 0 && !description.includes("\n"));
    }
  });

  test("isCatalogAspect accepts catalog ids only, and not inherited keys", () => {
    assert.equal(isCatalogAspect("contracts"), true);
    assert.equal(isCatalogAspect("other"), false);
    assert.equal(isCatalogAspect("toString"), false);
    assert.equal(isCatalogAspect("__proto__"), false);
  });
});
