/**
 * Derives everything the pages show from the stored data + applied filters.
 * One memoised computation is shared by all pages, so switching pages does not
 * recalculate, and a KPI, a chart and an export can never disagree.
 */
import { useMemo } from 'react';
import { previousPeriod, type DateRange } from '../analytics/date-ranges';
import { computeMovement, coverageByPlatform, coverageHoles, overallCoverage, type Coverage, type Gap, type MovementRow } from '../analytics/movement';
import { CostIndex } from '../analytics/profitability/costs';
import { analyseProfit, summariseProfit, type ProfitAnalysis, type ProfitSummary } from '../analytics/profitability/profit';
import { buildCohort, type CohortResult } from '../analytics/returns/cohort';
import { aggregateBy, computeTotals, type GroupTotals } from '../analytics/revenue/totals';
import { buildSkuRows, filterSkuRows, hasSkuLevelFilter, type SkuRow } from '../analytics/sku-classification';
import { applyTxnFilters } from '../analytics/transactions/filters';
import { EMPTY_FILTERS } from '../schemas/defaults';
import { useStore } from '../storage/store';
import type { Expense, Filters, Platform, ProductCost, Settings, SkuAlias, Totals, Transaction } from '../types';
import { todayInTz } from '../utils/dates';

export interface Analytics {
  hasData: boolean;
  today: string;
  /** Reporting date for movement windows: the end of the selected range, or today. */
  asOf: string;
  range: DateRange | null;
  coverage: Coverage | null;
  coverageByPlatform: Map<Platform, Coverage>;
  /** True when the reporting date lies after the last imported transaction. */
  asOfBeyondCoverage: boolean;
  /**
   * Dates to draw on time charts and list in daily / monthly reports: the selected
   * range limited to the dates imported reports reach. null = derive from the data.
   */
  span: DateRange | null;
  /** Stretches with no transactions at all, long enough to be treated as a missing report. */
  coverageHoles: Map<Platform, Gap[]>;
  /** Filtered transactions inside the date range. */
  period: Transaction[];
  /** Filtered transactions ignoring the date range. */
  scope: Transaction[];
  totals: Totals;
  prevRange: DateRange | null;
  /** null = no imported data reaches the previous period, so no comparison is shown. */
  prevTotals: Totals | null;
  prevPartial: boolean;
  profitAnalysis: ProfitAnalysis;
  profit: ProfitSummary;
  prevProfit: ProfitSummary | null;
  skuRows: SkuRow[];
  allSkuRows: SkuRow[];
  movement: Map<string, MovementRow>;
  byState: GroupTotals[];
  byPlatform: GroupTotals[];
  cohort: CohortResult;
  costIndex: CostIndex;
  options: { skus: string[]; states: string[]; platforms: Platform[] };
  filters: Filters;
  settings: Settings;
}

interface Inputs {
  txns: Transaction[];
  filters: Filters;
  settings: Settings;
  costs: ProductCost[];
  expenses: Expense[];
  aliases: SkuAlias[];
  today: string;
}

export function computeAnalytics(i: Inputs): Analytics {
  const { txns, filters: f, settings } = i;
  const coverage = overallCoverage(txns, i.today);
  const covByPlatform = coverageByPlatform(txns, i.today);
  const holes = coverageHoles(txns, settings.coverageGapDays, i.today);
  const range: DateRange | null =
    f.dateFrom || f.dateTo
      ? { from: f.dateFrom || coverage?.from || f.dateTo, to: f.dateTo || i.today }
      : null;
  const asOf = range ? range.to : i.today;
  const dated: Filters = range ? { ...f, dateFrom: range.from, dateTo: range.to } : f;

  const scope0 = applyTxnFilters(txns, f, { date: true });
  const scopeAllTypes = applyTxnFilters(txns, f, { date: true, txnType: true });
  const period0 = applyTxnFilters(txns, dated);
  const periodAllTypes = applyTxnFilters(txns, dated, { txnType: true });

  const costIndex = new CostIndex(i.costs);
  const policy = { cancellationPolicy: settings.cancellationPolicy, returnCostPolicy: settings.returnCostPolicy };
  const blockedReason = f.txnTypes.length
    ? 'Profitability is not shown while a transaction-type filter is active. Clear that filter to see profit.'
    : undefined;
  // Expense shares are decided on the date + marketplace selection only, so a SKU or
  // state filter never changes how much expense a SKU carries.
  const allocFilter: Filters = { ...EMPTY_FILTERS, platforms: f.platforms };
  const allocScope = applyTxnFilters(txns, allocFilter);
  const inRange = (r: DateRange | null) => (t: Transaction) => !r || (t.txnDate >= r.from && t.txnDate <= r.to);
  const skipExpenses = f.states.length > 0;
  const profitAnalysis = analyseProfit({
    txns: periodAllTypes, allocationTxns: range ? allocScope.filter(inRange(range)) : allocScope,
    costs: costIndex, expenses: i.expenses, policy, range, blockedReason, skipExpenses,
  });
  const movement = computeMovement(scopeAllTypes, asOf, covByPlatform, settings, holes);
  const allSkuRows = buildSkuRows({
    periodTxns: period0, movement, profitBySku: profitAnalysis.bySku, settings, aliases: i.aliases,
  });

  const skuFiltered = hasSkuLevelFilter(f);
  const skuRows = filterSkuRows(allSkuRows, f);
  let period = period0;
  let scope = scope0;
  let scopeForCohort = scopeAllTypes;
  let keys: Set<string> | undefined;
  if (skuFiltered) {
    keys = new Set(skuRows.map((r) => r.key));
    const keep = (t: Transaction) => keys!.has(`${t.platform}|${t.sku}`);
    period = period0.filter(keep);
    scope = scope0.filter(keep);
    scopeForCohort = scopeAllTypes.filter(keep);
  }

  const totals = computeTotals(period, settings.cancellationPolicy);
  const profit = summariseProfit(profitAnalysis, keys);

  let prevRange: DateRange | null = null;
  let prevTotals: Totals | null = null;
  let prevProfit: ProfitSummary | null = null;
  let prevPartial = false;
  if (range && coverage) {
    prevRange = previousPeriod(range);
    if (coverage.from <= prevRange.to) {
      prevPartial = coverage.from > prevRange.from;
      const pr = prevRange;
      const inPrev = (t: Transaction) => t.txnDate >= pr.from && t.txnDate <= pr.to;
      prevTotals = computeTotals(scope.filter(inPrev), settings.cancellationPolicy);
      const prevAnalysis = analyseProfit({
        txns: scopeAllTypes.filter(inPrev), allocationTxns: allocScope.filter(inPrev), costs: costIndex,
        expenses: i.expenses, policy, range: prevRange, blockedReason, skipExpenses,
      });
      prevProfit = summariseProfit(prevAnalysis, keys);
    }
  }

  let span: DateRange | null = range;
  if (range && coverage) {
    const clipped = { from: range.from < coverage.from ? coverage.from : range.from, to: range.to > coverage.to ? coverage.to : range.to };
    span = clipped.from <= clipped.to ? clipped : null;
  }

  const skuSet = new Set<string>();
  const stateSet = new Set<string>();
  for (const t of txns) {
    skuSet.add(t.sku);
    stateSet.add(t.state);
  }

  return {
    hasData: txns.length > 0,
    today: i.today,
    asOf,
    range,
    coverage,
    coverageByPlatform: covByPlatform,
    asOfBeyondCoverage: !!coverage && asOf > coverage.to,
    span,
    coverageHoles: holes,
    period,
    scope,
    totals,
    prevRange,
    prevTotals,
    prevPartial,
    profitAnalysis,
    profit,
    prevProfit,
    skuRows,
    allSkuRows,
    movement,
    byState: aggregateBy(period, (t) => t.state, settings.cancellationPolicy),
    byPlatform: aggregateBy(period, (t) => t.platform, settings.cancellationPolicy),
    cohort: buildCohort(scopeForCohort, range, settings.cohortMinLinkagePct),
    costIndex,
    options: {
      skus: [...skuSet].sort(),
      states: [...stateSet].sort(),
      platforms: [...covByPlatform.keys()],
    },
    filters: f,
    settings,
  };
}

let last: { inputs: Inputs; result: Analytics } | null = null;

/** Shared, memoised analytics for the applied filters. */
export function useAnalytics(): Analytics {
  const txns = useStore((s) => s.txns);
  const filters = useStore((s) => s.applied);
  const settings = useStore((s) => s.settings);
  const costs = useStore((s) => s.costs);
  const expenses = useStore((s) => s.expenses);
  const aliases = useStore((s) => s.aliases);
  const today = todayInTz(settings.reportingTimezone);
  return useMemo(() => {
    const inputs: Inputs = { txns, filters, settings, costs, expenses, aliases, today };
    if (last && (Object.keys(inputs) as (keyof Inputs)[]).every((k) => last!.inputs[k] === inputs[k])) {
      return last.result;
    }
    const result = computeAnalytics(inputs);
    last = { inputs, result };
    return result;
  }, [txns, filters, settings, costs, expenses, aliases, today]);
}
