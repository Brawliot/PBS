/**
 * The keys of a project fact and the values each one accepts. A key or value that is not here is
 * free text ("other"). Only product_type has catalog values; every other key takes free text only.
 * PENDING REVIEW by the product owner: the list is short on purpose and it is not final.
 */

import type { FactTerm } from "./plan-model.js";

export const FACT_KEYS = ["product_type", "target_customer", "revenue_model", "launch_channel"] as const;
export type FactKeyId = (typeof FACT_KEYS)[number];

export const PRODUCT_TYPES = ["mobile_game", "mobile_app", "web_app", "saas", "physical_product", "service", "marketplace"] as const;

/** The catalog values each key accepts. A key without an entry accepts free text only. */
const CATALOG_VALUES: Partial<Record<FactKeyId, readonly string[]>> = {
  product_type: PRODUCT_TYPES,
};

export const isFactKeyId = (id: string): id is FactKeyId => (FACT_KEYS as readonly string[]).includes(id);

/**
 * Whether a key and a value can be stored together: a catalog key takes its own catalog values (or
 * free text where it has none), a free-text key takes free text only.
 */
export function isAllowedFact(key: FactTerm, value: FactTerm): boolean {
  if (key.kind === "other") return value.kind === "other";
  if (!isFactKeyId(key.id)) return false;
  const values = CATALOG_VALUES[key.id];
  if (values === undefined) return value.kind === "other";
  return value.kind === "catalog" && values.includes(value.id);
}

/** A readable id for a key: the catalog id, or "other:<text>" for a free-text key (used to group facts) */
export const factKeyId = (key: FactTerm): string => (key.kind === "catalog" ? key.id : `other:${key.text}`);
