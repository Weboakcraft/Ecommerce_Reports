export const BLANK_SKU = '(blank SKU)';

/**
 * Normalize a source SKU.
 *  - trim leading/trailing whitespace
 *  - remove double quotes that wrap the WHOLE value, as Flipkart writes it:
 *    """SKU:OC-07-BLACK""" -> SKU:OC-07-BLACK (only matching layers at both ends)
 *  - remove exactly one leading "SKU:" prefix, case-insensitive
 *  - keep every remaining character (hyphens, inner spaces, inner quotes ...)
 * Returns '' for a blank SKU so the caller can flag it.
 */
export function normalizeSku(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  s = stripWrappingQuotes(s);
  if (/^sku:/i.test(s)) s = s.slice(4).trim();
  return s;
}

/** Remove the same number of double quotes from both ends (never more than either end has). */
export function stripWrappingQuotes(value: string): string {
  let s = value;
  let lead = 0;
  while (lead < s.length && s.charAt(lead) === '"') lead++;
  let trail = 0;
  while (trail < s.length - lead && s.charAt(s.length - 1 - trail) === '"') trail++;
  const n = Math.min(lead, trail);
  if (n > 0) s = s.slice(n, s.length - n).trim();
  return s;
}

/**
 * True when a normalized SKU still looks like it carries decoration the rule
 * did not remove (e.g. the cell was wrapped in quotes). Reported as a warning;
 * the value itself is never altered beyond the documented rule.
 */
export function skuLooksDecorated(normalized: string): boolean {
  return /sku:/i.test(normalized) || /^["']/.test(normalized);
}
