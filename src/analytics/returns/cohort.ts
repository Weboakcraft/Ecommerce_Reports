import type { Transaction } from '../../types';
import { diffDays, monthKey } from '../../utils/dates';
import { pct } from '../../utils/numbers';
import { reportingQty, reportingValue } from '../quantities';

export interface LinkageStats {
  returnRows: number;
  linkedRows: number;
  /** Returns whose only candidate sale is dated AFTER the return (not usable as an origin). */
  saleAfterReturnRows: number;
  linkagePct: number | null;
  cancellationRows: number;
  cancellationLinkedRows: number;
  cancellationLinkagePct: number | null;
}

export interface CohortRow {
  /** Month of the ORIGINAL sale. */
  saleMonth: string;
  grossSalesValue: number;
  grossSoldUnits: number;
  /** Returns (any return date) linked to sales made in this month. */
  returnValue: number;
  returnedUnits: number;
  returnUnitRatePct: number | null;
  returnValueRatePct: number | null;
  avgDaysToReturn: number | null;
}

export interface CohortResult {
  stats: LinkageStats;
  /** True when linkage reaches the configured minimum; otherwise only `stats` should be shown. */
  reliable: boolean;
  rows: CohortRow[];
  unlinkedReturnValue: number;
  unlinkedReturnedUnits: number;
}

/**
 * Cohort view of returns.
 *
 * A return row is linked to a sale row when both share platform + Order Item ID
 * (falling back to platform + Order ID + SKU when the item id is blank) and the
 * sale is dated on or before the return. The earliest such sale is used.
 * This linkage is INVESTIGATED, not assumed: the share of return rows that link
 * is reported, and the cohort table is only marked reliable when that share
 * reaches `minLinkagePct`.
 *
 * `scopeTxns` is every transaction under the non-date filters, so a return can
 * find its sale (and a sale can find its later return) across the date filter.
 * `range` selects which SALE dates form the cohorts; null = all.
 * Linked returns follow their sale's date; unlinked returns can only be placed
 * by their own date and are reported separately, never mixed into a cohort.
 */
export function buildCohort(
  scopeTxns: Transaction[],
  range: { from: string; to: string } | null,
  minLinkagePct: number,
): CohortResult {
  const inRange = (d: string) => !range || (d >= range.from && d <= range.to);
  const keyOf = (t: Transaction) =>
    t.orderItemId ? `${t.platform}|I|${t.orderItemId}` : t.orderId ? `${t.platform}|O|${t.orderId}|${t.sku}` : '';

  const earliestSale = new Map<string, string>();
  for (const t of scopeTxns) {
    if (t.txnType !== 'SALE') continue;
    const k = keyOf(t);
    if (!k) continue;
    const prev = earliestSale.get(k);
    if (!prev || t.txnDate < prev) earliestSale.set(k, t.txnDate);
  }

  type Row = CohortRow & { daysSum: number; daysN: number };
  const rows = new Map<string, Row>();
  const row = (m: string): Row => {
    let r = rows.get(m);
    if (!r) {
      r = {
        saleMonth: m, grossSalesValue: 0, grossSoldUnits: 0, returnValue: 0, returnedUnits: 0,
        returnUnitRatePct: null, returnValueRatePct: null, avgDaysToReturn: null, daysSum: 0, daysN: 0,
      };
      rows.set(m, r);
    }
    return r;
  };

  const stats: LinkageStats = {
    returnRows: 0, linkedRows: 0, saleAfterReturnRows: 0, linkagePct: null,
    cancellationRows: 0, cancellationLinkedRows: 0, cancellationLinkagePct: null,
  };
  let unlinkedValue = 0;
  let unlinkedUnits = 0;

  for (const t of scopeTxns) {
    if (t.txnType === 'SALE') {
      if (!inRange(t.txnDate)) continue;
      const r = row(monthKey(t.txnDate));
      r.grossSalesValue += reportingValue(t);
      r.grossSoldUnits += reportingQty(t);
    } else if (t.txnType === 'CANCELLATION') {
      if (!inRange(t.txnDate)) continue;
      stats.cancellationRows++;
      const k = keyOf(t);
      if (k && earliestSale.has(k)) stats.cancellationLinkedRows++;
    } else if (t.txnType === 'RETURN') {
      const k = keyOf(t);
      const saleDate = k ? earliestSale.get(k) : undefined;
      if (saleDate && saleDate <= t.txnDate) {
        if (!inRange(saleDate)) continue;
        stats.returnRows++;
        stats.linkedRows++;
        const r = row(monthKey(saleDate));
        r.returnValue += reportingValue(t);
        r.returnedUnits += reportingQty(t);
        r.daysSum += diffDays(saleDate, t.txnDate);
        r.daysN++;
      } else {
        if (!inRange(t.txnDate)) continue;
        stats.returnRows++;
        if (saleDate) stats.saleAfterReturnRows++;
        unlinkedValue += reportingValue(t);
        unlinkedUnits += reportingQty(t);
      }
    }
  }

  stats.linkagePct = pct(stats.linkedRows, stats.returnRows);
  stats.cancellationLinkagePct = pct(stats.cancellationLinkedRows, stats.cancellationRows);

  const out: CohortRow[] = [...rows.values()]
    .sort((a, b) => a.saleMonth.localeCompare(b.saleMonth))
    .map(({ daysSum, daysN, ...r }) => ({
      ...r,
      returnUnitRatePct: r.grossSoldUnits > 0 ? pct(r.returnedUnits, r.grossSoldUnits) : null,
      returnValueRatePct: r.grossSalesValue > 0 ? pct(r.returnValue, r.grossSalesValue) : null,
      avgDaysToReturn: daysN ? daysSum / daysN : null,
    }));

  return {
    stats,
    reliable: stats.returnRows > 0 && (stats.linkagePct ?? 0) >= minLinkagePct,
    rows: out,
    unlinkedReturnValue: unlinkedValue,
    unlinkedReturnedUnits: unlinkedUnits,
  };
}
