/**
 * The fixed test ideas of the evaluation. Each one has its report (built without calling phase 1), the facts the
 * person confirms, and the expectations the agents' task titles should meet. The data is here and nowhere else: a
 * new case is a new entry, and the chain (chain.ts) does not change.
 *
 * The reports come from reportWith (test/plan/report-fixtures.ts). That fixture is a development tool: it builds a
 * valid report from a few values, so the cases do not depend on the planner running. It is not part of the server.
 *
 * The expectations are HEURISTICS: a regular expression on the titles of the tasks the agents proposed, and the
 * department that proposed them. They catch a missing topic, not a bad plan. A person still reads the report.
 */

import { reportWith, type ReportOptions } from "../test/plan/report-fixtures.js";
import { FUNDS_HELD } from "../plan/plan-skeleton.js";
import type { FactTerm } from "../plan/plan-model.js";
import type { Report } from "../plan/report.js";

export interface Expectation {
  id: string;
  /** Read aloud in the report: what the title should be about */
  description: string;
  /** The department ids that may propose it. null: any department */
  departments: string[] | null;
  /** Matched against the title. No g flag: the test is stateless */
  pattern: RegExp;
}

export interface CaseFact {
  key: FactTerm;
  value: FactTerm;
}

export interface EvalCase {
  id: string;
  label: string;
  report: () => Report;
  /** Confirmed by the script as the person would (actor "user"), before any agent runs */
  facts: CaseFact[];
  expectations: Expectation[];
}

/** A report for one idea: the fixture's values, with the idea of the case */
function reportFor(idea: string, options: ReportOptions = {}): Report {
  const base = reportWith(options);
  return { ...base, input: { ...base.input, idea } };
}

const catalog = (id: string): FactTerm => ({ kind: "catalog", id });
const text = (value: string): FactTerm => ({ kind: "other", text: value });

export const CASES: EvalCase[] = [
  {
    id: "restaurant",
    label: "Restaurante japonés en Madrid (regulación pesada)",
    // The fixture's defaults: a Japanese restaurant in Madrid, heavy regulation, a budget warning
    report: () => reportFor("Restaurante japonés en Madrid"),
    facts: [
      { key: catalog("product_type"), value: catalog("service") },
      { key: catalog("target_customer"), value: text("Vecinos del barrio") },
    ],
    expectations: [
      {
        id: "legal-licences",
        description: "Un departamento Legal propone una tarea sobre licencias o permisos",
        departments: ["legal"],
        pattern: /licen|permis|sanit|autoriz/i,
      },
    ],
  },
  {
    id: "saas",
    label: "SaaS para gestión de restaurantes (aplicación web)",
    report: () =>
      reportFor("Software web para que los restaurantes gestionen reservas, pedidos y facturación desde el navegador", {
        values: {
          customer_segment: "Small businesses (1-50)",
          revenue_model: "Subscription",
          offering_type: "Software",
          regulatory_load: "Moderate (licenses, data protection)",
          money_handling: "Collects through a payment provider",
          capital_intensity: "Low (digital, near-zero marginal cost)",
        },
        unsupported: [],
        warnings: [],
      }),
    facts: [
      { key: catalog("product_type"), value: catalog("web_app") },
      { key: catalog("target_customer"), value: text("Restaurantes pequeños") },
    ],
    expectations: [
      {
        id: "product-build",
        description: "Technology o Product proponen tareas de construcción o diseño del producto",
        departments: ["technology", "product"],
        pattern: /dise|construi|desarroll|build|design|prototipo|interfaz|plataforma|software|aplicaci/i,
      },
    ],
  },
  {
    id: "physio",
    label: "Fisioterapia a domicilio (sanitario)",
    report: () =>
      reportFor("Fisioterapia a domicilio: un fisioterapeuta acude a casa del paciente con cita previa y cobra por sesión", {
        values: {
          customer_segment: "Consumers",
          revenue_model: "Services by hours or projects",
          offering_type: "People-delivered service",
          regulatory_load: "Heavy (health, finance, food)",
          money_handling: "Collects through a payment provider",
          third_party_dependency: "Autonomous",
        },
        unsupported: [],
        warnings: [],
      }),
    facts: [
      { key: catalog("product_type"), value: catalog("service") },
      { key: catalog("target_customer"), value: text("Personas con movilidad reducida") },
    ],
    expectations: [
      {
        id: "credentials-insurance",
        description: "Alguna tarea trata de la titulación, el registro profesional o los seguros",
        departments: null,
        pattern: /titul|colegi|registro|seguro|póliza|poliza|acredit|licen/i,
      },
    ],
  },
  {
    id: "marketplace",
    label: "Marketplace donde la plataforma gestiona los pagos",
    report: () =>
      reportFor("Marketplace de reparaciones a domicilio: la plataforma cobra al cliente y paga al profesional", {
        values: {
          customer_segment: "Two-sided marketplace",
          revenue_model: "Transaction commission",
          offering_type: "Platform or marketplace",
          regulatory_load: "Moderate (licenses, data protection)",
          money_handling: FUNDS_HELD,
        },
        unsupported: [],
        warnings: [],
      }),
    facts: [
      { key: catalog("product_type"), value: catalog("marketplace") },
      { key: catalog("target_customer"), value: text("Hogares que necesitan reparaciones") },
    ],
    expectations: [
      {
        id: "payments-compliance",
        description: "Legal o Finance proponen tareas sobre el cumplimiento de los pagos (fondos, cobros, dinero)",
        departments: ["legal", "finance"],
        pattern: /pago|cobro|fondos|dinero|escrow|cumplimiento|blanqueo|kyc|psd|intermedi|tesorer/i,
      },
    ],
  },
];

export const caseById = (id: string): EvalCase | undefined => CASES.find((item) => item.id === id);
