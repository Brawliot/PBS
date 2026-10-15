/**
 * Writes the four cases of the diagnosis e2e (test/e2e/fixtures/diagnosis-cases.json). Each case runs the server's own
 * runPlanner: the rules (checks, split, the words that contradict a status) are the real code. Only the model is
 * simulated: Jev (which also answers the profile and the validation), the phase 2 analysis, the explanations and
 * the diagnosis words. The answers given to the model are written per case here, so the fixture is reproducible.
 *
 * Run from server/: npx tsx test/e2e/diagnosis-cases.gen.ts
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runPlanner } from "../../planner/planner-run.js";
import { claimsFromPhase2 } from "../../planner/planner-validation-handler.js";
import { REPORT_TEMPLATES } from "../../planner/report-templates.js";
import { selectImproveQuestions } from "../../plan/improve-questions.js";
import { MAX_ANSWERS } from "../../request.js";
import type { PlannerInput } from "../../planner/planner-handler.js";
import { InMemoryReportRepository } from "../../plan/report-repository-memory.js";
import { USER } from "../user-ids.js";

type Choice = string;
interface Case {
  name: string;
  input: { idea: string; budget: number; location: string; start_mode: string; premises: string };
  /** Jev's answer by question key: the checks, the scope, the sector and the profile dimensions */
  jev: Record<string, Choice>;
  /** The phase 2 money range (the glance's budget) and the risks the analysis lists */
  budget: { min: number | null; max: number | null };
  execution: unknown[];
  diagnosisText: unknown;
  detect: { location: string | null; budget: number | null; start_mode: string | null; premises: string | null };
}

const CASES: Case[] = [
  {
    name: "tapas",
    input: { idea: "A tapas bar in Malasaña, Madrid", budget: 40_000, location: "Malasaña, Madrid", start_mode: "takeover", premises: "looking" },
    jev: {
      sector: "Hospitality/Food service",
      geographic_scope: "Hyper-local",
      timeline: "Fast (3-6m)",
      concept: "Strong",
      location: "Strong",
      competition: "Risk",
      experience: "Watch",
    },
    budget: { min: 45_000, max: 60_000 },
    execution: [
      { name: "Menu and recipes", who: "you", mando_key: "", cost_min: null, cost_max: null, hours_week: 10, reason: "The owner knows the kitchen" },
      { name: "Website and bookings", who: "mando", mando_key: "website", cost_min: null, cost_max: null, hours_week: null, reason: "Built in Mando" },
    ],
    diagnosisText: {
      idea: "A neighbourhood tapas bar for locals and after-work crowds in Malasaña.",
      checks: [
        { key: "concept", why: "Locals already eat tapas in this street, so the offer has a ready market." },
        { key: "location", why: "The street is busy after work, though rents are high." },
        { key: "money", why: "€40k is tight against a typical €45–60k takeover, with little cushion." },
        { key: "experience", why: "The owner has run a kitchen for years, but not this trade's front of house." },
        { key: "competition", why: "Very dense: many tapas bars in Malasaña, so price alone will not set you apart." },
      ],
      risks: ["High rent in this area.", "Dependence on the terrace: licence and season.", "Very dense competition."],
    },
    detect: { location: "Malasaña, Madrid", budget: 40_000, start_mode: "takeover", premises: "looking" },
  },
  {
    name: "physio",
    input: { idea: "Physio clinic in Valencia", budget: 60_000, location: "Valencia", start_mode: "scratch", premises: "looking" },
    jev: {
      sector: "Health/Medicine",
      geographic_scope: "Local",
      timeline: "Normal (6-12m)",
      concept: "Strong",
      location: "Strong",
      competition: "Watch",
      experience: "Strong",
      regulatory_load: "Heavy (health, finance, food)",
    },
    budget: { min: 40_000, max: 55_000 },
    execution: [],
    diagnosisText: {
      idea: "A physiotherapy clinic in Valencia for sports injuries and back pain, booked by phone and online.",
      checks: [
        { key: "concept", why: "Patients already look for physio for sports injuries in this area." },
        { key: "location", why: "The street has foot traffic and parking nearby." },
        { key: "money", why: "The budget covers the first months of a small clinic." },
        { key: "experience", why: "No degree or registration is on file for the clinic's treatments." },
        { key: "competition", why: "Several physio clinics are nearby, and the difference is not yet clear." },
      ],
      risks: ["Licence and registration must be in place before the first patient.", "Insurance and malpractice cover take a large part of the budget.", "Several clinics are nearby."],
    },
    detect: { location: "Valencia", budget: 60_000, start_mode: "scratch", premises: "looking" },
  },
  {
    name: "salon",
    input: { idea: "Taking over a hair salon in Seville, I have premises", budget: 40_000, location: "Seville", start_mode: "takeover", premises: "have" },
    jev: {
      sector: "Retail/Commerce",
      geographic_scope: "Local",
      timeline: "Fast (3-6m)",
      concept: "Watch",
      location: "Strong",
      competition: "Watch",
      experience: "Strong",
      founder_profile: "Sector expert",
    },
    budget: { min: 15_000, max: 25_000 },
    execution: [],
    diagnosisText: {
      idea: "Taking over a hair salon in Seville, in premises the owner already has.",
      checks: [
        { key: "concept", why: "The salon's regulars are the clear base; what is new is still to be shown." },
        { key: "location", why: "The premises are already the owner's, on a street people walk along." },
        { key: "money", why: "The budget covers a takeover of a small salon." },
        { key: "experience", why: "The owner has worked in hairdressing for years." },
        { key: "competition", why: "Other salons are close by, and the difference is not yet clear." },
      ],
      risks: ["The takeover price must match the salon's real takings.", "Staff who leave with the old owner.", "Other salons are close by."],
    },
    detect: { location: "Seville", budget: null, start_mode: "takeover", premises: "have" },
  },
  {
    // A concept at risk and money at watch: "Improve my report" asks about these two first
    name: "improve",
    input: { idea: "A tapas bar in Malasaña, Madrid", budget: 40_000, location: "Malasaña, Madrid", start_mode: "takeover", premises: "looking" },
    jev: {
      sector: "Hospitality/Food service",
      geographic_scope: "Hyper-local",
      timeline: "Fast (3-6m)",
      concept: "Risk",
      location: "Strong",
      competition: "Watch",
      experience: "Strong",
      founder_profile: "Sector expert",
    },
    budget: { min: 45_000, max: 60_000 },
    execution: [],
    diagnosisText: {
      idea: "A neighbourhood tapas bar for locals and after-work crowds in Malasaña.",
      checks: [
        { key: "concept", why: "The offer is not yet clear enough to tell it apart from the other bars." },
        { key: "location", why: "The street is busy after work, though rents are high." },
        { key: "money", why: "€40k is tight against a typical €45–60k takeover, with little cushion." },
        { key: "experience", why: "The owner has run a kitchen for years." },
        { key: "competition", why: "Several tapas bars are nearby." },
      ],
      risks: ["The offer may not stand out.", "High rent in this area.", "Little cushion for the first months."],
    },
    detect: { location: "Malasaña, Madrid", budget: 40_000, start_mode: "takeover", premises: "looking" },
  },
  {
    name: "software",
    input: { idea: "Software to manage bar bookings", budget: 20_000, location: "online", start_mode: "scratch", premises: "not_needed" },
    jev: {
      sector: "Technology/SaaS",
      geographic_scope: "Online",
      timeline: "Fast (3-6m)",
      concept: "Strong",
      location: "Watch",
      competition: "Risk",
      experience: "Watch",
      founder_profile: "Technical",
    },
    budget: { min: 5_000, max: 9_000 },
    execution: [
      { name: "Bar booking software", who: "mando", mando_key: "invented", cost_min: 2_000, cost_max: 4_000, hours_week: null, reason: "The product itself" },
      { name: "Booking page", who: "mando", mando_key: "website", cost_min: null, cost_max: null, hours_week: null, reason: "Built in Mando" },
    ],
    diagnosisText: {
      idea: "Booking software that bars use to take reservations and manage tables online.",
      checks: [
        { key: "concept", why: "Bars already take bookings by phone and by message, so the need is clear." },
        { key: "reach", why: "Bars can be reached online, but each one has to be found and shown the product." },
        { key: "money", why: "The budget covers a first version and its first customers." },
        { key: "experience", why: "The owner builds software, but has not sold to bars yet." },
        { key: "competition", why: "Several booking tools already serve bars, with the same offer." },
      ],
      risks: ["Bars already use free booking tools.", "Sales to bars take time and visits.", "Several booking tools already serve bars."],
    },
    detect: { location: null, budget: 20_000, start_mode: "scratch", premises: "not_needed" },
  },
];

const section = (value: string, source = "stated", confidence = 80) => ({ value, source, confidence });
/** An explanations reply with no reasons, and valid time, cost split and templates */
const REASONLESS = {
  warningReasons: [],
  areaReasons: [],
  timeToOpen: { min: 3, max: 5, unit: "months", confidence: "medium" },
  costBreakdown: [{ label: "Licences", percent: 60 }, { label: "Equipment", percent: 40 }],
  templates: REPORT_TEMPLATES.slice(0, 3).map(({ id }) => id),
};

/** Jev's reply: each question asked gets its answer for this case, or the first option of its list */
function jevReply(caseSpec: Case, questions: Record<string, { criteria?: Record<string, string> }>) {
  const answers: Record<string, { type: "choice"; choice: string }> = {};
  for (const [key, question] of Object.entries(questions)) {
    const options = Object.keys(question.criteria ?? {});
    const wanted = caseSpec.jev[key];
    answers[key] = { type: "choice", choice: wanted ?? (options.includes("Not specified") ? "Not specified" : options[0]) };
  }
  return { model: "fixture", answers, usage: { input_tokens: 1, output_tokens: 1 } };
}

function phase2Reply(caseSpec: Case) {
  return {
    maturity: "developing",
    subsector: section("Tapas bar"),
    location: section(caseSpec.input.location),
    target_customer: section("Locals and visitors", "inferred", 60),
    value_proposition: section(caseSpec.input.idea),
    revenue_model: section("Sales per visit", "unknown", 0),
    stage: section("Idea only"),
    competition: section("Other businesses in the area"),
    constraints: {
      budget: { min: caseSpec.budget.min, max: caseSpec.budget.max, currency: "EUR", fits: "Estimated range for this idea" },
      exclusions: [],
      risks: [],
      assumptions: [],
    },
    questions: [],
    execution: caseSpec.execution,
  };
}

/** Replaces fetch for one case: only the model calls are answered; anything else fails the generation */
function modelFor(caseSpec: Case) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    if (href.includes("typesafe.ai")) return reply(jevReply(caseSpec, body.questions));
    const name = body.response_format?.json_schema?.name;
    const content =
      name === "phase2" ? phase2Reply(caseSpec)
      : name === "explanations" ? REASONLESS
      : name === "diagnosis_text" ? caseSpec.diagnosisText
      : undefined;
    if (content === undefined) throw new Error(`the generator has no answer for ${href}`);
    return reply({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
  }) as typeof fetch;
}

process.env.OPENAI_API_KEY = "fixture";
process.env.OPENAI_MODEL = "fixture";
process.env.TYPESAFE_API_KEY = "fixture";
process.env.JEV_MODEL = "fixture";

/** The sector the report's Jev analysis gave (the customer question's options follow it) */
const sectorOf = (report: { jev: { answers: Record<string, { type: string; choice?: string }> } } | undefined) => {
  const sector = report?.jev.answers.sector;
  return sector?.type === "choice" ? sector.choice : undefined;
};

const out: Record<string, unknown> = {};
for (const caseSpec of CASES) {
  modelFor(caseSpec);
  const reports = new InMemoryReportRepository();
  const options = { reports, owner: USER };
  const input = caseSpec.input as PlannerInput;
  const first = (await runPlanner(input, [], false, {}, options)) as { phase2: unknown; glance?: unknown };
  const claims = claimsFromPhase2(first.phase2 as never);
  const final = (await runPlanner(input, [], true, claims, options, first.glance as never)) as { reportId: string };
  const stored = await reports.get(final.reportId, USER);
  const improve = selectImproveQuestions(stored?.report.diagnosis, [], sectorOf(stored?.report), MAX_ANSWERS);
  out[caseSpec.name] = { input: caseSpec.input, detect: caseSpec.detect, firstRound: first, final, report: stored?.report, improve };
  console.log(`${caseSpec.name}: checks ${(stored?.report.diagnosis?.checks ?? []).map((c) => `${c.key}=${c.status}/${c.decidedBy}`).join(" ")}`);
}

const target = fileURLToPath(new URL("./fixtures/diagnosis-cases.json", import.meta.url));
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`written ${target}`);
