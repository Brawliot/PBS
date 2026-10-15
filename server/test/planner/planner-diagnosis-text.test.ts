import { USER } from "../user-ids.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { explainDiagnosis } from "../../planner/planner-explain-handler.js";
import { runPlanner } from "../../planner/planner-run.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { DEFAULT_WHY, DEFAULT_RISK, IDENTIFIED_WHY } from "../../plan/diagnosis-text.js";
import { REASONLESS_EXPLANATIONS, isExplanationCall, mockFetch, jsonResponse, silenceConsoleError } from "./helpers.js";
import "./helpers.js";

// The text of the diagnosis: one call to the model, after the report is built. Its reply is checked part by part
// (plan/diagnosis-text.ts); a failed call keeps the default words, so the report is never kept empty.

const input = { idea: "Tapas bar in Malasaña", budget: 10_000, location: "Madrid", start_mode: "scratch" as const, premises: "have" as const };
const answers = [{ topic: "existing_customers", question: "Do you already have customers?", answer: "Yes, ten people" }];
const claims = { subsector: "Bar" };

const jevReply = {
  model: "test",
  answers: {
    sector: { type: "choice", choice: "Hospitality/Food service" },
    geographic_scope: { type: "choice", choice: "Local" },
    timeline: { type: "choice", choice: "Fast (3-6m)" },
    concept: { type: "choice", choice: "Strong" },
    location: { type: "choice", choice: "Risk" },
    competition: { type: "choice", choice: "Watch" },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
};

const phase2Stub = { maturity: "developing" };
const chatReply = (content: unknown) => jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
const isDiagnosisCall = (request: { body?: any }) => request.body?.response_format?.json_schema?.name === "diagnosis_text";

const diagnosisText = {
  idea: "A neighbourhood tapas bar for locals and after-work crowds.",
  checks: [
    { key: "concept", why: "Locals already eat tapas in this street." },
    { key: "location", why: "The street is quiet during the day, so customers must be drawn in." },
    { key: "money", why: "The budget is well below the cost of the first months." },
    { key: "experience", why: "The owner has run a kitchen for years." },
    { key: "competition", why: "Several bars nearby serve the same tapas." },
  ],
  risks: ["Rent takes most of the margin.", "Lunch trade is thin in this street.", "Two bars two streets away copy the menu."],
};

function mockRun(diagnosis: (request: { body?: any }) => Response) {
  return mockFetch((request) => {
    if (request.url.includes("typesafe.ai")) return jsonResponse(200, jevReply);
    if (isDiagnosisCall(request)) return diagnosis(request);
    if (isExplanationCall(request)) return chatReply(REASONLESS_EXPLANATIONS);
    return chatReply(phase2Stub);
  });
}

describe("explainDiagnosis: the call", () => {
  test("it sends a closed schema whose check keys are the checks of this business, and no other", async () => {
    const calls = mockRun(() => chatReply(diagnosisText));
    const checks = [
      { key: "concept", status: "strong", why: "", estimated: true, decidedBy: "jev" },
      { key: "reach", status: "watch", why: "", estimated: true, decidedBy: "jev" },
    ] as const;
    await explainDiagnosis({ input, answers, checks: checks as never }, undefined);
    const call = calls.find((request) => request.body?.response_format?.json_schema?.name === "diagnosis_text");
    const schema = call?.body.response_format.json_schema.schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.checks.items.properties.key.enum, ["concept", "reach"]);
  });

  test("a failed call returns undefined, and the run goes on", async () => {
    silenceConsoleError();
    mockRun(() => jsonResponse(500, { error: "down" }));
    const result = await explainDiagnosis({ input, answers, checks: [] as never }, undefined);
    assert.equal(result, undefined);
  });
});

describe("runPlanner: the diagnosis of a final request carries the model's words", () => {
  test("the words the model gives are kept in the report, checked", async () => {
    mockRun(() => chatReply(diagnosisText));
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, true, claims, { reports, owner: USER })) as Record<string, any>;
    const stored = (await reports.get(result.reportId, USER))?.report.diagnosis;
    assert.equal(stored?.idea, diagnosisText.idea);
    assert.equal(stored?.checks[0].why, "Locals already eat tapas in this street.");
    assert.deepEqual(stored?.risks, diagnosisText.risks);
  });

  test("a reason that contradicts its status is replaced by the default of that check and status", async () => {
    mockRun(() => chatReply({ ...diagnosisText, checks: [{ key: "location", why: "The place is excellent, a solid choice." }] }));
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, true, claims, { reports, owner: USER })) as Record<string, any>;
    const stored = (await reports.get(result.reportId, USER))?.report.diagnosis;
    const location = stored?.checks.find((c: { key: string }) => c.key === "location");
    assert.equal(location?.status, "risk");
    assert.equal(location?.why, DEFAULT_WHY.location.risk);
  });

  test("a failed call keeps the report, with the default words", async () => {
    silenceConsoleError();
    mockRun(() => jsonResponse(500, { error: "down" }));
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, true, claims, { reports, owner: USER })) as Record<string, any>;
    assert.equal(typeof result.reportId, "string");
    const stored = (await reports.get(result.reportId, USER))?.report.diagnosis;
    assert.ok(stored);
    assert.equal(stored.checks.find((c: { key: string }) => c.key === "location")?.why, DEFAULT_WHY.location.risk);
    assert.ok(stored.risks.length >= 1 && stored.risks.length <= 3);
    assert.ok(stored.risks.includes(DEFAULT_RISK.location));
  });

  test("a reply that is not the model's words (the phase 2 one) keeps the defaults, without failing", async () => {
    silenceConsoleError();
    mockRun(() => chatReply(phase2Stub));
    const reports = new InMemoryReportRepository();
    const result = (await runPlanner(input, answers, true, claims, { reports, owner: USER })) as Record<string, any>;
    const stored = (await reports.get(result.reportId, USER))?.report.diagnosis;
    assert.ok(stored);
    assert.equal(stored.checks[0].why, DEFAULT_WHY.concept.strong);
  });
});

describe("runPlanner: an identified check keeps the identified text", () => {
  test("a gap answer makes concept identified; the model's 'solid' reason is not stored", async () => {
    const jevRisk = { ...jevReply, answers: { ...jevReply.answers, concept: { type: "choice", choice: "Risk" } } };
    mockFetch((request) => {
      if (request.url.includes("typesafe.ai")) return jsonResponse(200, jevRisk);
      if (isDiagnosisCall(request)) return chatReply({ ...diagnosisText, checks: [{ key: "concept", why: "The offer is solid and proven." }] });
      if (isExplanationCall(request)) return chatReply(REASONLESS_EXPLANATIONS);
      return chatReply(phase2Stub);
    });
    const reports = new InMemoryReportRepository();
    const answers = [{ topic: "imp_concept_difference", question: "What will make you different?", answer: "I don't know yet" }];
    const result = (await runPlanner(input, answers, true, claims, { reports, owner: USER })) as Record<string, any>;
    const concept = (await reports.get(result.reportId, USER))?.report.diagnosis?.checks.find((c: { key: string }) => c.key === "concept");
    assert.equal(concept?.identified, true);
    assert.equal(concept?.status, "watch");
    assert.equal(concept?.why, IDENTIFIED_WHY.concept);
    assert.equal(concept?.planTask, "Define what makes you different before opening");
  });
});
