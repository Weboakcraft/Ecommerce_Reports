import type { CancellationPolicy, Settings, Totals, Transaction } from '../../types';
import { PLATFORM_LABEL } from '../../types';
import { fmtDate } from '../../utils/dates';
import { BLANK_SKU } from '../../utils/sku';
import { BLANK_STATE, normalizeState } from '../../utils/states';
import type { CostIndex } from '../profitability/costs';
import { aggregateBy, computeTotals } from '../revenue/totals';
import { bucketKey } from '../date-ranges';
import { dateGaps } from '../movement';
import { BLANK_EVENT } from '../transactions/classify';

export type Severity = 'error' | 'warning' | 'info';

export interface QualityIssue {
  code: string;
  severity: Severity;
  title: string;
  count: number;
  detail: string;
  examples: string[];
}

const ex = (t: Transaction) => `${t.sourceFile} row ${t.sourceRow}`;

function push(list: QualityIssue[], issue: QualityIssue) {
  if (issue.count > 0) list.push({ ...issue, examples: issue.examples.slice(0, 8) });
}

/** Automated data-quality checks. They only REPORT; source values are never changed. */
export function runQualityChecks(
  txns: Transaction[],
  settings: Settings,
  costs: CostIndex,
  rejectedCount: number,
  today?: string,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const blankSku: Transaction[] = [];
  const blankOrder: Transaction[] = [];
  const blankItem: Transaction[] = [];
  const blankEvent: Transaction[] = [];
  const dup: Transaction[] = [];
  const negSale: Transaction[] = [];
  const zeroSale: Transaction[] = [];
  const fractional: Transaction[] = [];
  const unmapped = new Map<string, number>();
  const badState = new Map<string, number>();
  const retSign = { neg: 0, pos: 0, zero: 0 };
  const missingCost = new Map<string, number>();
  const future: Transaction[] = [];

  for (const t of txns) {
    if (t.sku === BLANK_SKU) blankSku.push(t);
    if (!t.orderId) blankOrder.push(t);
    if (!t.orderItemId) blankItem.push(t);
    if (t.eventSubType === BLANK_EVENT) blankEvent.push(t);
    if (t.occurrence > 1) dup.push(t);
    if (today && t.txnDate > today) future.push(t);
    if (!Number.isInteger(t.rawQty)) fractional.push(t);
    if (t.txnType === 'UNMAPPED') {
      const k = `${PLATFORM_LABEL[t.platform]}: ${t.eventSubType}`;
      unmapped.set(k, (unmapped.get(k) ?? 0) + 1);
    }
    if (t.txnType === 'SALE') {
      if (t.rawQty < 0 || t.rawTaxable < 0) negSale.push(t);
      if (t.rawQty === 0 || t.rawTaxable === 0) zeroSale.push(t);
      if (costs.size > 0 && !costs.lookup(t.platform, t.sku, t.txnDate)) {
        missingCost.set(t.sku, (missingCost.get(t.sku) ?? 0) + 1);
      }
    }
    if (t.txnType === 'RETURN') {
      if (t.rawTaxable < 0) retSign.neg++;
      else if (t.rawTaxable > 0) retSign.pos++;
      else retSign.zero++;
    }
    if (t.state === BLANK_STATE || !normalizeState(t.rawState, settings.stateAliases).recognised) {
      const k = t.rawState.trim() || '(blank)';
      badState.set(k, (badState.get(k) ?? 0) + 1);
    }
  }

  push(issues, {
    code: 'REJECTED_ROWS', severity: 'error', title: 'Rejected source rows', count: rejectedCount,
    detail: 'Rows with an invalid or missing date, quantity or amount were not imported. Download the validation error report from Import History for row numbers and reasons.',
    examples: [],
  });
  push(issues, {
    code: 'UNMAPPED_EVENTS', severity: 'error', title: 'Unmapped event types',
    count: [...unmapped.values()].reduce((a, b) => a + b, 0),
    detail: 'These rows are excluded from every business metric until their Event Sub Type is mapped to Sale, Return, Cancellation or Exclude (Settings → Transaction mapping).',
    examples: [...unmapped].map(([k, n]) => `${k} — ${n} row(s)`),
  });
  push(issues, {
    code: 'MISSING_SKU', severity: 'warning', title: 'Missing SKUs', count: blankSku.length,
    detail: `Rows with a blank SKU are kept under "${BLANK_SKU}" so their value still reconciles.`,
    examples: blankSku.map(ex),
  });
  push(issues, {
    code: 'BLANK_ORDER_ID', severity: 'warning', title: 'Blank Order ID', count: blankOrder.length,
    detail: 'These rows cannot be counted in Unique Orders.', examples: blankOrder.map(ex),
  });
  push(issues, {
    code: 'BLANK_ORDER_ITEM_ID', severity: 'warning', title: 'Blank Order Item ID', count: blankItem.length,
    detail: 'These rows cannot be counted in Unique Order Items or linked to a sale in the cohort view.',
    examples: blankItem.map(ex),
  });
  push(issues, {
    code: 'BLANK_EVENT', severity: 'warning', title: 'Blank Event Sub Type', count: blankEvent.length,
    detail: 'A blank event value cannot be classified and stays Unmapped.', examples: blankEvent.map(ex),
  });
  push(issues, {
    code: 'DUPLICATE_CANDIDATES', severity: 'warning', title: 'Duplicate candidates', count: dup.length,
    detail: 'Rows identical to an earlier row of the same file on every field the application reads (order, item, event, date, SKU, quantity, value). They were kept; review whether they are genuine.',
    examples: dup.map((t) => `${ex(t)} — ${t.orderItemId || t.orderId} ${t.eventSubType}`),
  });
  push(issues, {
    code: 'NEGATIVE_SALE', severity: 'warning', title: 'Unexpected negative values on Sale rows', count: negSale.length,
    detail: 'Sale rows with a negative quantity or taxable value reduce Gross Sales as they stand. If these events are really reversals, map that event value to Return or Cancellation.',
    examples: negSale.map((t) => `${ex(t)} — qty ${t.rawQty}, value ${t.rawTaxable}`),
  });
  push(issues, {
    code: 'ZERO_SALE', severity: 'info', title: 'Sale rows with zero quantity or zero value', count: zeroSale.length,
    detail: 'Counted as sales with no quantity or value.', examples: zeroSale.map(ex),
  });
  push(issues, {
    code: 'FRACTIONAL_QTY', severity: 'warning', title: 'Non-integer quantities', count: fractional.length,
    detail: 'Quantities are used as given.', examples: fractional.map((t) => `${ex(t)} — qty ${t.rawQty}`),
  });
  if (retSign.neg > 0 && retSign.pos > 0) {
    push(issues, {
      code: 'MIXED_RETURN_SIGN', severity: 'warning', title: 'Return rows use mixed signs',
      count: Math.min(retSign.neg, retSign.pos),
      detail: `${retSign.neg} return row(s) have a negative taxable value and ${retSign.pos} a positive one. Each row is reported as a positive return value; confirm the minority rows are genuine returns.`,
      examples: [],
    });
  }
  push(issues, {
    code: 'STATE_REVIEW', severity: 'warning', title: 'State names needing review',
    count: [...badState.values()].reduce((a, b) => a + b, 0),
    detail: 'Not recognised as an Indian state / UT after harmless formatting clean-up. Nothing was merged automatically; add an alias in Settings → State names if these are known variants.',
    examples: [...badState].sort((a, b) => b[1] - a[1]).map(([k, n]) => `"${k}" — ${n} row(s)`),
  });

  // ---- unusually high return rates ----
  const high = aggregateBy(txns, (t) => `${t.platform}|${t.sku}`, settings.cancellationPolicy)
    .filter((g) => g.returnUnitRatePct !== null && g.grossSoldUnits >= settings.highReturnMinUnits && g.returnUnitRatePct > settings.unusualReturnRatePct)
    .sort((a, b) => (b.returnUnitRatePct ?? 0) - (a.returnUnitRatePct ?? 0));
  push(issues, {
    code: 'UNUSUAL_RETURN_RATE', severity: 'warning', title: 'Unusually high return rates', count: high.length,
    detail: `SKUs whose unit return rate exceeds ${settings.unusualReturnRatePct}% with at least ${settings.highReturnMinUnits} sold units. May be genuine, or a sign that sales rows are missing from the imported reports.`,
    examples: high.map((g) => `${g.key.split('|').slice(1).join('|')} — ${g.returnUnitRatePct!.toFixed(1)}% (${g.returnedUnits}/${g.grossSoldUnits} units)`),
  });

  // ---- date coverage gaps ----
  push(issues, {
    code: 'FUTURE_DATES', severity: 'warning', title: 'Transactions dated in the future', count: future.length,
    detail: 'Dated after today in the reporting timezone. They are counted in totals as dated, but are ignored when judging how far the imported reports reach. Usually a sign of a wrong day/month order setting or a typo in the source.',
    examples: future.map((t) => `${ex(t)} — ${t.txnDate}`),
  });

  for (const [platform, gaps] of dateGaps(txns, today)) {
    const days = gaps.reduce((a, g) => a + g.days, 0);
    push(issues, {
      code: `COVERAGE_GAP_${platform}`, severity: 'info', title: `${PLATFORM_LABEL[platform]}: dates with no transactions`,
      count: days,
      detail: `Days inside the imported date span that have no transactions at all. Short gaps can be normal; a long gap usually means a report for that period has not been imported. Gaps of ${settings.coverageGapDays} days or more are treated as not covered when judging SKU inactivity.`,
      examples: gaps.sort((a, b) => b.days - a.days).map((g) => (g.days === 1 ? fmtDate(g.from) : `${fmtDate(g.from)} – ${fmtDate(g.to)} (${g.days} days)`)),
    });
  }

  push(issues, {
    code: 'INCOMPLETE_COSTS', severity: 'warning', title: 'Incomplete cost data',
    count: missingCost.size,
    detail: 'SKUs with Sale rows on dates not covered by any cost record. Profit for these SKUs stays unavailable.',
    examples: [...missingCost].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} — ${n} sale row(s) without a cost`),
  });

  return issues;
}

export interface ReconCheck {
  name: string;
  expected: number;
  actual: number;
  ok: boolean;
}

export interface Reconciliation {
  totals: Totals;
  totalRows: number;
  duplicateCandidates: number;
  checks: ReconCheck[];
  allOk: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Reconciliation: recompute every headline figure by independent routes
 * (row-level raw sums, SKU groups, state groups, daily buckets) and compare.
 */
export function reconcile(txns: Transaction[], policy: CancellationPolicy): Reconciliation {
  const totals = computeTotals(txns, policy);
  const checks: ReconCheck[] = [];
  const add = (name: string, expected: number, actual: number) =>
    checks.push({ name, expected, actual, ok: near(expected, actual) });

  let rawSale = 0;
  let rawRet = 0;
  let rawCanc = 0;
  let rawSaleQty = 0;
  let dup = 0;
  for (const t of txns) {
    if (t.txnType === 'SALE') {
      rawSale += t.rawTaxable;
      rawSaleQty += t.rawQty;
    } else if (t.txnType === 'RETURN') rawRet += Math.abs(t.rawTaxable);
    else if (t.txnType === 'CANCELLATION') rawCanc += Math.abs(t.rawTaxable);
    if (t.occurrence > 1) dup++;
  }
  add('Rows by type add up to total rows', txns.length,
    totals.saleRows + totals.returnRows + totals.cancellationRows + totals.excludedRows + totals.unmappedRows);
  add('Gross Sales Value = Σ raw taxable value of Sale rows', rawSale, totals.grossSalesValue);
  add('Return Value = Σ |raw taxable value| of Return rows', rawRet, totals.returnValue);
  add('Cancellation Value = Σ |raw taxable value| of Cancellation rows', rawCanc, totals.cancellationValue);
  add('Gross Sold Units = Σ raw quantity of Sale rows', rawSaleQty, totals.grossSoldUnits);
  add(
    policy === 'reversal'
      ? 'Net Sales = Gross − Returns − Cancellations (reversal policy)'
      : 'Net Sales = Gross − Returns (cancellations reported separately)',
    totals.grossSalesValue - totals.returnValue - (policy === 'reversal' ? totals.cancellationValue : 0),
    totals.netSalesValue,
  );
  add(
    'Net Units = Gross Sold − Returned' + (policy === 'reversal' ? ' − Cancelled' : ''),
    totals.grossSoldUnits - totals.returnedUnits - (policy === 'reversal' ? totals.cancelledUnits : 0),
    totals.netUnits,
  );
  const routes: [string, (t: Transaction) => string][] = [
    ['SKU', (t) => `${t.platform}|${t.sku}`],
    ['state', (t) => t.state],
    ['day', (t) => bucketKey(t.txnDate, 'day')],
    ['marketplace', (t) => t.platform],
  ];
  for (const [label, keyOf] of routes) {
    const groups = aggregateBy(txns, keyOf, policy);
    const sum = (f: (g: Totals) => number) => groups.reduce((a, g) => a + f(g), 0);
    add(`Σ by ${label}: Net Sales Value`, totals.netSalesValue, sum((g) => g.netSalesValue));
    add(`Σ by ${label}: Net Units`, totals.netUnits, sum((g) => g.netUnits));
  }
  return { totals, totalRows: txns.length, duplicateCandidates: dup, checks, allOk: checks.every((c) => c.ok) };
}
