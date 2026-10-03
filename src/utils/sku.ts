export const BLANK_SKU = '(blank SKU)';

/**
 * Normalize a source SKU.
 *  - trim leading/trailing whitespace
 *  - remove exactly one leading "SKU:" prefix, case-insensitive
 *  - keep every remaining character (hyphens, inner spaces, quotes ...)
 * Returns '' for a blank SKU so the caller can flag it.
 */
export function normalizeSku(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  if (/^sku:/i.test(s)) s = s.slice(4).trim();
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
