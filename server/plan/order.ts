/**
 * The order that a relation means, as [before, after], for any level: "A blocks B" puts A before B, and
 * "A follows B" puts B before A (a follows only sets the order: it never blocks). Every rule that reads
 * the order of two records goes through here, so the convention is written once.
 */
export function orderOf(relation: { from: string; to: string; type: string }): [string, string] {
  return relation.type === "follows" ? [relation.to, relation.from] : [relation.from, relation.to];
}
