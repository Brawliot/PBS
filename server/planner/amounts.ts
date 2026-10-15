/**
 * Amounts written in a text, read the way the browser reads a typed budget ("40,000 €", "10k", "1.5M").
 * Shared by the detection of the fixed answers and by its checks.
 */

const MULTIPLIERS: Record<string, number> = { k: 1e3, mil: 1e3, m: 1e6, million: 1e6, "millón": 1e6, millones: 1e6 };

/** Every amount in the text, in order */
export function readAmounts(text: string): number[] {
  const found: number[] = [];
  for (const match of text.toLowerCase().matchAll(/(\d[\d.,\s]*)\s*(k|mil|m|million|millón|millones)?\b/g)) {
    // A comma or dot followed by exactly three digits groups thousands; any other one is a decimal mark
    const digits = match[1].replace(/\s/g, "").replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number.parseFloat(digits);
    if (!Number.isFinite(n)) continue;
    found.push(n * (match[2] ? MULTIPLIERS[match[2]] : 1));
  }
  return found;
}
