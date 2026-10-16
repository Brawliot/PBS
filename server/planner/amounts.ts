/**
 * Amounts written in a text, read the way the browser reads a typed budget ("40,000 €", "10k", "1.5M").
 * Shared by the detection of the fixed answers and by its checks.
 */

const MULTIPLIERS: Record<string, number> = { k: 1e3, mil: 1e3, m: 1e6, million: 1e6, "millón": 1e6, millones: 1e6 };

/** The number a run of digits and its multiplier write, or null */
function amountOf(digitsText: string, multiplier: string | undefined): number | null {
  // A comma or dot followed by exactly three digits groups thousands; any other one is a decimal mark
  const digits = digitsText.replace(/\s/g, "").replace(/[.,](?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? n * (multiplier ? MULTIPLIERS[multiplier] : 1) : null;
}

/** Every amount in the text, in order */
export function readAmounts(text: string): number[] {
  const found: number[] = [];
  for (const match of text.toLowerCase().matchAll(/(\d[\d.,\s]*)\s*(k|mil|m|million|millón|millones)?\b/g)) {
    const n = amountOf(match[1], match[2]);
    if (n !== null) found.push(n);
  }
  return found;
}

/**
 * The amounts written as euros ("30.000 €", "€30,000", "40k euros"), in order. Without the currency a number
 * can be anything ("24 horas", "3 mil habitantes"), so it is left out.
 */
export function readEuroAmounts(text: string): number[] {
  const found: number[] = [];
  const pattern = /€\s*(\d[\d.,]*)\s*(k|mil|m|million|millón|millones)?(?![\p{L}\d])|(\d[\d.,\s]*?)\s*(k|mil|m|million|millón|millones)?\s*(?:€|eur(?:os?)?(?![\p{L}]))/gu;
  for (const match of text.toLowerCase().matchAll(pattern)) {
    const n = match[1] !== undefined ? amountOf(match[1], match[2]) : amountOf(match[3], match[4]);
    if (n !== null) found.push(n);
  }
  return found;
}
