import type { Filters, Transaction } from '../../types';

/**
 * Transaction-level filters. Date bounds are inclusive on both ends and compare
 * reporting dates (already in the reporting timezone).
 * `ignore` lets callers build the "scope" set, e.g. everything except the date
 * range, which movement windows and previous-period comparisons need.
 */
export function applyTxnFilters(
  txns: Transaction[],
  f: Filters,
  ignore: { date?: boolean; txnType?: boolean } = {},
): Transaction[] {
  const platforms = f.platforms.length ? new Set<string>(f.platforms) : null;
  const skus = f.skus.length ? new Set(f.skus) : null;
  const types = !ignore.txnType && f.txnTypes.length ? new Set<string>(f.txnTypes) : null;
  const states = f.states.length ? new Set(f.states) : null;
  const from = ignore.date ? '' : f.dateFrom;
  const to = ignore.date ? '' : f.dateTo;
  if (!platforms && !skus && !types && !states && !from && !to) return txns;
  return txns.filter(
    (t) =>
      (!from || t.txnDate >= from) &&
      (!to || t.txnDate <= to) &&
      (!platforms || platforms.has(t.platform)) &&
      (!skus || skus.has(t.sku)) &&
      (!types || types.has(t.txnType)) &&
      (!states || states.has(t.state)),
  );
}

export function countActiveFilters(f: Filters): number {
  let n = 0;
  if (f.dateFrom || f.dateTo) n++;
  if (f.platforms.length) n++;
  if (f.skus.length) n++;
  if (f.txnTypes.length) n++;
  if (f.states.length) n++;
  if (f.minSalesUnits !== null) n++;
  if (f.returnRateThresholdPct !== null) n++;
  if (f.profitStatus !== 'all') n++;
  if (f.classifications.length) n++;
  return n;
}
