import type { Transaction } from '../../types';

/**
 * Raw -> reporting conversion (documented in docs/CALCULATIONS.md).
 *
 *  SALE          value = raw taxable value (signed)      qty = raw quantity (signed)
 *  RETURN        value = |raw taxable value|             qty = |raw quantity|
 *  CANCELLATION  value = |raw taxable value|             qty = |raw quantity|
 *  EXCLUDE / UNMAPPED contribute to no business metric.
 *
 * Returns and cancellations are normalised per row with an absolute value, so
 * a source that writes returns as negative numbers and a source that writes
 * them as positive numbers produce the same positive Return Value / Returned
 * Units, and a negative return quantity is never subtracted twice.
 * Sale rows keep their sign; a negative sale row is surfaced as a data-quality
 * warning rather than silently flipped.
 */
export function reportingValue(t: Transaction): number {
  switch (t.txnType) {
    case 'SALE':
      return t.rawTaxable;
    case 'RETURN':
    case 'CANCELLATION':
      return Math.abs(t.rawTaxable);
    default:
      return 0;
  }
}

export function reportingQty(t: Transaction): number {
  switch (t.txnType) {
    case 'SALE':
      return t.rawQty;
    case 'RETURN':
    case 'CANCELLATION':
      return Math.abs(t.rawQty);
    default:
      return 0;
  }
}
