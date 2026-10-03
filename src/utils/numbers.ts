export interface ParsedNumber {
  value: number | null;
  error?: string;
}

/**
 * Parse a numeric Excel cell or a numeric string. The sign is always preserved.
 * Accepted text: optional sign, digits with optional Western or Indian comma
 * grouping, optional decimals, and accounting-style parentheses for negatives,
 * e.g. "(1,234.50)". A sign inside parentheses is rejected as ambiguous.
 * Anything else is reported as invalid; nothing is coerced to zero.
 */
export function parseNumber(input: unknown): ParsedNumber {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? { value: input } : { value: null, error: 'not a finite number' };
  }
  if (input === null || input === undefined) return { value: null, error: 'blank' };
  if (typeof input === 'boolean') return { value: null, error: 'boolean is not a number' };
  let s = String(input).trim();
  if (s === '') return { value: null, error: 'blank' };
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  // Plain digits, Western grouping (1,234,567) or Indian grouping (12,34,567); optional decimals.
  // A comma is only ever a thousands separator: "1,50" is rejected rather than read as 150.
  const body = String.raw`(\d+|\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})+,\d{3})`;
  const ok = new RegExp(`^${negative ? '' : '[+-]?'}(${body}(\\.\\d+)?|\\.\\d+)$`).test(s);
  if (!ok) return { value: null, error: `"${String(input).slice(0, 40)}" is not numeric` };
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return { value: null, error: 'not a finite number' };
  return { value: negative ? -n : n };
}

/** Sum with compensation so large files do not accumulate float drift. */
export class KahanSum {
  private sum = 0;
  private c = 0;
  add(v: number): void {
    const y = v - this.c;
    const t = this.sum + y;
    this.c = t - this.sum - y;
    this.sum = t;
  }
  get value(): number {
    return this.sum;
  }
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Safe percentage: null when the denominator is zero, so no misleading figure is shown. */
export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}
