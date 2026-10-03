import type { CancellationPolicy, Transaction } from '../../types';
import { addDays, monthEnd, monthKey, monthStart, rangeDays, weekStart } from '../../utils/dates';
import { aggregateBy, type GroupTotals } from '../revenue/totals';

export interface DateRange {
  from: string;
  to: string;
}

export type Grain = 'day' | 'week' | 'month';

export interface Preset {
  id: string;
  label: string;
  range: (today: string) => DateRange | null;
}

/** All ranges are inclusive of both the start date and the end date. */
export const DATE_PRESETS: Preset[] = [
  { id: 'all', label: 'All time', range: () => null },
  { id: 'today', label: 'Today', range: (t) => ({ from: t, to: t }) },
  { id: 'yesterday', label: 'Yesterday', range: (t) => ({ from: addDays(t, -1), to: addDays(t, -1) }) },
  { id: 'last7', label: 'Last 7 days', range: (t) => ({ from: addDays(t, -6), to: t }) },
  { id: 'last30', label: 'Last 30 days', range: (t) => ({ from: addDays(t, -29), to: t }) },
  { id: 'last90', label: 'Last 90 days', range: (t) => ({ from: addDays(t, -89), to: t }) },
  { id: 'thisMonth', label: 'This month', range: (t) => ({ from: monthStart(t), to: t }) },
  {
    id: 'lastMonth',
    label: 'Last month',
    range: (t) => {
      const lastOfPrev = addDays(monthStart(t), -1);
      return { from: monthStart(lastOfPrev), to: lastOfPrev };
    },
  },
  {
    id: 'thisFY',
    label: 'This financial year',
    range: (t) => {
      const y = +t.slice(0, 4);
      const fy = +t.slice(5, 7) >= 4 ? y : y - 1;
      return { from: `${fy}-04-01`, to: t };
    },
  },
];

/**
 * Previous equivalent period: the same number of days immediately before the
 * selected range. When the range is exactly one or more whole calendar months,
 * the previous period is the same number of whole months, so 1-31 Mar compares
 * with 1-29 Feb rather than with a 31-day window that straddles two months.
 */
export function previousPeriod(range: DateRange): DateRange {
  const wholeMonths = range.from === monthStart(range.from) && range.to === monthEnd(range.to);
  if (wholeMonths) {
    const months =
      (+range.to.slice(0, 4) - +range.from.slice(0, 4)) * 12 + (+range.to.slice(5, 7) - +range.from.slice(5, 7)) + 1;
    const prevTo = addDays(range.from, -1);
    let from = monthStart(prevTo);
    for (let i = 1; i < months; i++) from = monthStart(addDays(from, -1));
    return { from, to: prevTo };
  }
  const n = rangeDays(range.from, range.to);
  return { from: addDays(range.from, -n), to: addDays(range.from, -1) };
}

export const inRange = (iso: string, r: DateRange): boolean => iso >= r.from && iso <= r.to;

export function bucketKey(iso: string, grain: Grain): string {
  if (grain === 'day') return iso;
  if (grain === 'week') return weekStart(iso);
  return monthKey(iso);
}

/** Pick a readable default grain for a span of days. */
export function defaultGrain(days: number): Grain {
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}

/** Time series with every bucket in the span present (gaps show as zero, not as missing points). */
export function timeSeries(
  txns: Transaction[],
  grain: Grain,
  policy: CancellationPolicy,
  span?: DateRange | null,
): GroupTotals[] {
  const groups = aggregateBy(txns, (t) => bucketKey(t.txnDate, grain), policy);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  let from = span?.from;
  let to = span?.to;
  if (!from || !to) {
    for (const t of txns) {
      if (!from || t.txnDate < from) from = t.txnDate;
      if (!to || t.txnDate > to) to = t.txnDate;
    }
  }
  if (!from || !to) return [];
  const out: GroupTotals[] = [];
  const seen = new Set<string>();
  const total = rangeDays(from, to);
  // Guard against absurd spans (e.g. a mistyped year) creating hundreds of thousands of buckets.
  if (!Number.isFinite(total) || total < 1 || total > 366 * 6) return groups.sort((a, b) => a.key.localeCompare(b.key));
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketKey(d, grain);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(byKey.get(k) ?? { key: k, ...ZERO });
  }
  return out;
}

const ZERO = {
  grossSalesValue: 0, returnValue: 0, cancellationValue: 0, netSalesValue: 0, grossSoldUnits: 0,
  returnedUnits: 0, cancelledUnits: 0, netUnits: 0, uniqueOrders: 0, uniqueOrderItems: 0, saleRows: 0,
  returnRows: 0, cancellationRows: 0, excludedRows: 0, unmappedRows: 0, unmappedValue: 0,
  returnUnitRatePct: null, returnValueRatePct: null,
};

export interface Change {
  /** current - previous; null when there is no previous period. */
  abs: number | null;
  /** Percentage change; null when the previous value is zero or missing (no misleading %). */
  pct: number | null;
  note?: string;
}

export function change(current: number | null, previous: number | null | undefined): Change {
  if (current === null || previous === null || previous === undefined) {
    return { abs: null, pct: null, note: 'No previous-period data' };
  }
  const abs = current - previous;
  if (previous === 0) {
    return { abs, pct: null, note: current === 0 ? 'No change' : 'Previous period was zero' };
  }
  return { abs, pct: (abs / Math.abs(previous)) * 100 };
}
