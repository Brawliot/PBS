/**
 * What Mando does for a business, written by hand: the models never decide it. Every estimate of the report reads
 * from here (planner-phase2-handler.ts puts mandoContext() in its prompt, plan/execution.ts checks the model's
 * reply against MANDO_BUILDS), so when Mando learns to build something new, it is added here and nothing else.
 *
 * Only what Mando does TODAY belongs in MANDO_BUILDS: the report tells the person that these cost them nothing
 * extra, so a promise here is a promise to the person.
 */

/** What Mando builds or does itself, inside the product. The key is what the model names (execution items). */
export const MANDO_BUILDS = [
  { key: "business_plan", label: "Business plan, phases and task planning" },
  { key: "landing", label: "Landing page" },
  { key: "website", label: "Website" },
  { key: "online_store", label: "Online store" },
  { key: "crm", label: "CRM (customers and sales)" },
  { key: "erp", label: "ERP (operations, stock, invoicing back office)" },
  { key: "internal_tools", label: "Internal tools and dashboards" },
  { key: "documents", label: "Business documents and templates" },
] as const;

export type MandoKey = (typeof MANDO_BUILDS)[number]["key"];
export const MANDO_KEYS = MANDO_BUILDS.map(({ key }) => key) as [MandoKey, ...MandoKey[]];

/** What the person should hire out, and that Mando recommends hiring out, whatever their skills */
export const ALWAYS_OUTSOURCE = [
  "Tax and accounting advice",
  "Legal advice and contracts",
  "Licences and permits in regulated sectors (health, food, finance)",
  "Building or fitting out premises",
];

/** Costs Mando never covers: money the person pays whoever does the work */
export const NEVER_COVERED = [
  "Rent of premises",
  "Stock and raw materials",
  "Physical equipment and vehicles",
  "Fees, taxes and insurance",
  "Salaries",
  "Paid advertising",
];

/**
 * The short version, for the prompts that classify and check (profile, validation, explanations): what Mando
 * covers, so software, those tools and planning are never counted as a cost, a team need or a delay.
 */
export function mandoNote(): string {
  return `Execution context: the person runs this business with Mando, which builds and covers at no extra cost: ${MANDO_BUILDS.map(({ label }) => label).join("; ")}. Do not count developing that software, paying for those tools or planning the business as a cost, a team need, a skill gap or a delay. Mando does not cover: ${NEVER_COVERED.join("; ")}; nor what must be hired out: ${ALWAYS_OUTSOURCE.join("; ")}.`;
}

/** The block every estimating prompt carries: who can do each part of the business, and when to hire out */
export function mandoContext(): string {
  const list = (items: readonly string[]) => items.map((item) => `  - ${item}`).join("\n");
  return `The person will run this business with Mando, the product you are part of. Each part of the
business is done by one of three:
- "mando": Mando builds or does it inside the product, at no extra cost. ONLY these (use the key):
${MANDO_BUILDS.map(({ key, label }) => `  - ${key}: ${label}`).join("\n")}
- "you": the person does it, guided by Mando's plan and tasks. It costs their hours, and money only
  when they buy something (stock, rent, equipment).
- "outsource": the person hires someone. Recommend it when the part is a legal or tax obligation,
  needs a physical or specialised skill, when the person's hours cannot cover it, or when paying is
  cheaper than doing it. Always outsource:
${list(ALWAYS_OUTSOURCE)}
Mando never covers these costs (they are "you" or "outsource", with their money):
${list(NEVER_COVERED)}`;
}
