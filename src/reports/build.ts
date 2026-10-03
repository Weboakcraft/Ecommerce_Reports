import { timeSeries } from '../analytics/date-ranges';
import { change } from '../analytics/date-ranges';
import { CostIndex } from '../analytics/profitability/costs';
import { PROFIT_UNAVAILABLE } from '../analytics/profitability/profit';
import { reconcile, runQualityChecks } from '../analytics/quality';
import type { GroupTotals } from '../analytics/revenue/totals';
import type { SkuRow } from '../analytics/sku-classification';
import { countActiveFilters } from '../analytics/transactions/filters';
import type { Analytics } from '../app/analytics';
import { buildKpis } from '../modules/overview/kpis';
import {
  PLATFORM_LABEL, SKU_CLASS_LABEL, TXN_TYPE_LABEL, type AuditEntry, type ImportBatch, type Platform, type RejectedRow,
} from '../types';
import { fmtDate, fmtMonth } from '../utils/dates';

export type CellType = 'text' | 'int' | 'money' | 'pct' | 'dec';
export type Cell = string | number | null;

export interface ReportColumn {
  header: string;
  type: CellType;
}

export interface ReportSheet {
  name: string;
  columns: ReportColumn[];
  rows: Cell[][];
  /** Shown above the table, e.g. why it is empty. */
  note?: string;
}

export interface Report {
  id: string;
  title: string;
  sheets: ReportSheet[];
  definitions: [string, string][];
  meta: [string, string][];
}

export interface ReportContext {
  a: Analytics;
  batches: ImportBatch[];
  rejected: RejectedRow[];
  audit: AuditEntry[];
  costs: CostIndex;
  dataSource: string;
}

export interface ReportDef {
  id: string;
  title: string;
  description: string;
  build: (ctx: ReportContext) => ReportSheet[];
  definitions: (ctx: ReportContext) => [string, string][];
}

const c = (header: string, type: CellType = 'text'): ReportColumn => ({ header, type });
const money = (h: string) => c(`${h} (INR)`, 'money');

/** Text description of the applied filters, written into every export. */
export function describeFilters(a: Analytics): [string, string][] {
  const f = a.filters;
  const out: [string, string][] = [];
  out.push(['Reporting period', a.range ? `${fmtDate(a.range.from)} to ${fmtDate(a.range.to)} (both dates included)` : 'All imported data']);
  if (a.coverage) out.push(['Imported data covers', `${fmtDate(a.coverage.from)} to ${fmtDate(a.coverage.to)}`]);
  out.push(['Marketplaces', f.platforms.length ? f.platforms.map((p) => PLATFORM_LABEL[p]).join(', ') : `All (${a.options.platforms.map((p) => PLATFORM_LABEL[p]).join(', ') || 'none imported'})`]);
  out.push(['SKUs', f.skus.length ? f.skus.join(', ') : 'All']);
  out.push(['Transaction types', f.txnTypes.length ? f.txnTypes.map((t) => TXN_TYPE_LABEL[t]).join(', ') : 'All']);
  out.push(['States', f.states.length ? f.states.join(', ') : 'All']);
  if (f.minSalesUnits !== null) out.push(['Minimum sold units per SKU', String(f.minSalesUnits)]);
  if (f.returnRateThresholdPct !== null) out.push(['Return unit rate at least', `${f.returnRateThresholdPct}%`]);
  if (f.profitStatus !== 'all') out.push(['Profitability status', f.profitStatus]);
  if (f.classifications.length) out.push(['SKU classification', f.classifications.map((x) => SKU_CLASS_LABEL[x]).join(', ')]);
  out.push(['Active filters', String(countActiveFilters(f))]);
  return out;
}

const netDef = (a: Analytics): [string, string] => [
  'Net Sales Value',
  a.settings.cancellationPolicy === 'reversal'
    ? 'Gross Sales Value − Return Value − Cancellation Value (cancellation policy: reversal).'
    : 'Gross Sales Value − Return Value. Cancellations are reported separately and not subtracted.',
];
const CORE_DEFS = (a: Analytics): [string, string][] => [
  ['Gross Sales Value', 'Sum of taxable value (invoice amount minus taxes) of transactions classified as Sale.'],
  ['Return Value', 'Sum of the absolute taxable value of transactions classified as Return, shown positive, on the return date.'],
  netDef(a),
  ['Cancellation Value', 'Sum of the absolute taxable value of transactions classified as Cancellation.'],
  ['Return Unit Rate', 'Returned Units ÷ Gross Sold Units × 100. Blank when no units were sold.'],
  ['Return Value Rate', 'Return Value ÷ Gross Sales Value × 100. Blank when gross sales are zero.'],
];
const PROFIT_DEFS: [string, string][] = [
  ['Gross Profit', 'Net Sales Value − Net Cost of Goods Sold, using the cost effective on each transaction date. Blank when cost data is incomplete.'],
  ['Contribution Profit', 'Gross Profit − allocated variable expenses.'],
];

const totalsCols = [money('Gross Sales Value'), money('Return Value'), money('Net Sales Value'), money('Cancellation Value'),
  c('Gross Sold Units', 'int'), c('Returned Units', 'int'), c('Net Units', 'int'), c('Cancelled Units', 'int'),
  c('Unique Orders', 'int'), c('Unique Order Items', 'int'), c('Return Unit Rate %', 'pct'), c('Return Value Rate %', 'pct')];
const totalsCells = (g: GroupTotals | Analytics['totals']): Cell[] => [
  g.grossSalesValue, g.returnValue, g.netSalesValue, g.cancellationValue, g.grossSoldUnits, g.returnedUnits, g.netUnits,
  g.cancelledUnits, g.uniqueOrders, g.uniqueOrderItems, g.returnUnitRatePct, g.returnValueRatePct,
];

const skuSheet = (name: string, rows: SkuRow[], note?: string): ReportSheet => ({
  name,
  note,
  columns: [
    c('SKU'), c('Platform'), c('Canonical Product ID'), money('Gross Sales Value'), money('Return Value'), money('Net Sales Value'),
    c('Gross Sold Units', 'int'), c('Returned Units', 'int'), c('Net Units', 'int'), c('Unique Orders', 'int'),
    c('Unique Order Items', 'int'), c('Return Unit Rate %', 'pct'), c('Return Value Rate %', 'pct'),
    money('Avg Selling Value per Sold Unit'), money('Avg Revenue per Order Item'), money('Gross Profit'),
    money('Contribution Profit'), c('Gross Margin %', 'pct'), c('Profit Status'), c('Last Recorded Sale Date'),
    c('Days Since Last Sale', 'int'), c('Sales Trend %', 'pct'), c('Performance Classification'),
  ],
  rows: rows.map((r) => [
    r.sku, PLATFORM_LABEL[r.platform], r.canonicalProductId, r.grossSalesValue, r.returnValue, r.netSalesValue, r.grossSoldUnits,
    r.returnedUnits, r.netUnits, r.uniqueOrders, r.uniqueOrderItems, r.returnUnitRatePct, r.returnValueRatePct,
    r.avgSellingValuePerUnit, r.avgRevenuePerOrderItem,
    r.profit.available ? r.profit.grossProfit : null,
    r.profit.available ? r.profit.contributionProfit : null,
    r.profit.available ? r.profit.grossMarginPct : null,
    r.profit.available ? ((r.profit.contributionProfit ?? 0) < 0 ? 'Loss-making' : 'Profitable') : 'Unavailable — cost data required',
    r.movement?.lastSaleDate ?? '', r.movement?.daysSinceLastSale ?? null,
    r.movement?.covered.trend ? r.movement.trendPct : null,
    r.classes.map((x) => SKU_CLASS_LABEL[x]).join(', '),
  ]),
});

const bySales = (rows: SkuRow[]) => [...rows].sort((x, y) => y.netSalesValue - x.netSalesValue);

export const REPORTS: ReportDef[] = [
  {
    id: 'executive-summary', title: 'Executive Summary',
    description: 'Headline KPIs with previous-period comparison and formulas.',
    build: ({ a }) => [{
      name: 'KPIs',
      columns: [c('Metric'), c('Value', 'dec'), c('Unit'), c('Previous Period', 'dec'), c('Change', 'dec'), c('Change %', 'pct'), c('Note'), c('Formula')],
      rows: buildKpis(a).map((k) => {
        const ch = k.prev === undefined || k.unavailable ? null : change(k.value, k.prev);
        return [k.label, k.unavailable ? null : k.value, k.kind === 'money' ? 'INR' : k.kind === 'pct' ? '%' : 'count',
          k.prev ?? null, ch?.abs ?? null, k.kind === 'pct' ? null : ch?.pct ?? null,
          [k.unavailable, k.footnote, ch?.pct === null && ch?.note ? ch.note : ''].filter(Boolean).join(' '), k.formula];
      }),
    }],
    definitions: ({ a }) => [...CORE_DEFS(a), ...PROFIT_DEFS],
  },
  {
    id: 'sku-performance', title: 'SKU Performance Report',
    description: 'Every SKU with sales, returns, movement, profit (when costed) and classification.',
    build: ({ a }) => [skuSheet('SKU Performance', bySales(a.skuRows))],
    definitions: ({ a }) => [...CORE_DEFS(a), ...PROFIT_DEFS,
      ['Sales Trend %', `Gross sales value in the last ${a.settings.decliningWindowDays} days vs the ${a.settings.decliningWindowDays} days before, back from the reporting date ${fmtDate(a.asOf)}. Blank when imported data does not cover both windows.`]],
  },
  {
    id: 'loss-making-skus', title: 'Loss-Making SKU Report',
    description: 'SKUs with negative contribution profit. Only SKUs with complete cost data can appear.',
    build: ({ a }) => {
      const rows = a.skuRows.filter((r) => r.classes.includes('LOSS_MAKING')).sort((x, y) => (x.profit.contributionProfit ?? 0) - (y.profit.contributionProfit ?? 0));
      const note = a.profit.costedSkuCount === 0
        ? a.profit.total.reason || PROFIT_UNAVAILABLE
        : `Cost data covers ${a.profit.costedSkuCount} of ${a.profit.skuCount} SKUs. SKUs without complete cost data are not assessed and do not appear here.`;
      return [{
        name: 'Loss-Making SKUs', note,
        columns: [c('SKU'), c('Platform'), money('Net Sales Value'), c('Net Units', 'int'), money('Net Cost of Goods Sold'), money('Gross Profit'),
          c('Gross Margin %', 'pct'), money('Variable Expenses'), money('Contribution Profit'), c('Contribution Margin %', 'pct')],
        rows: rows.map((r) => [r.sku, PLATFORM_LABEL[r.platform], r.netSalesValue, r.netUnits, r.profit.cogs, r.profit.grossProfit,
          r.profit.grossMarginPct, r.profit.allocatedExpenses, r.profit.contributionProfit, r.profit.contributionMarginPct]),
      }];
    },
    definitions: ({ a }) => [netDef(a), ...PROFIT_DEFS, ['Loss-making', 'Contribution Profit below zero with a cost record for every transaction date.']],
  },
  {
    id: 'return-analysis', title: 'Return Analysis Report',
    description: 'Returns by SKU, state, marketplace and month, plus the cohort view when linkage is reliable.',
    build: ({ a }) => {
      const t = a.totals;
      const groupCols = (label: string) => [c(label), money('Return Value'), c('Returned Units', 'int'), c('Gross Sold Units', 'int'), money('Gross Sales Value'), c('Return Unit Rate %', 'pct'), c('Return Value Rate %', 'pct'), c('Share of Return Value %', 'pct')];
      const groupRow = (label: string, g: GroupTotals): Cell[] => [label, g.returnValue, g.returnedUnits, g.grossSoldUnits, g.grossSalesValue, g.returnUnitRatePct, g.returnValueRatePct, t.returnValue ? (g.returnValue / t.returnValue) * 100 : null];
      const sheets: ReportSheet[] = [
        { name: 'Summary', columns: [c('Measure'), c('Value', 'dec'), c('Unit')], rows: [
          ['Total Return Value', t.returnValue, 'INR'], ['Total Returned Units', t.returnedUnits, 'count'],
          ['Return Unit Rate', t.returnUnitRatePct, '%'], ['Return Value Rate', t.returnValueRatePct, '%'],
          ['Gross Sales Value', t.grossSalesValue, 'INR'], ['Gross Sold Units', t.grossSoldUnits, 'count'],
        ] },
        { name: 'By SKU', columns: [c('SKU'), c('Platform'), money('Return Value'), c('Returned Units', 'int'), c('Gross Sold Units', 'int'), c('Return Unit Rate %', 'pct'), c('Return Value Rate %', 'pct'), c('Share of Return Value %', 'pct'), c('Elevated Return Rate')],
          rows: [...a.skuRows].filter((r) => r.returnRows > 0).sort((x, y) => y.returnValue - x.returnValue).map((r) => [r.sku, PLATFORM_LABEL[r.platform], r.returnValue, r.returnedUnits, r.grossSoldUnits, r.returnUnitRatePct, r.returnValueRatePct, r.returnContributionPct, r.classes.includes('HIGH_RETURN') ? 'Yes' : r.grossSoldUnits < a.settings.highReturnMinUnits ? 'Too few sales to judge' : 'No']) },
        { name: 'By State', columns: groupCols('State'), rows: [...a.byState].sort((x, y) => y.returnValue - x.returnValue).map((g) => groupRow(g.key, g)) },
        { name: 'By Marketplace', columns: groupCols('Marketplace'), rows: a.byPlatform.map((g) => groupRow(PLATFORM_LABEL[g.key as Platform], g)) },
        { name: 'Monthly Trend', columns: [c('Month'), money('Return Value'), c('Returned Units', 'int'), c('Return Unit Rate %', 'pct'), c('Return Value Rate %', 'pct')],
          rows: timeSeries(a.period, 'month', a.settings.cancellationPolicy, a.span).map((g) => [fmtMonth(g.key), g.returnValue, g.returnedUnits, g.returnUnitRatePct, g.returnValueRatePct]) },
      ];
      const co = a.cohort;
      sheets.push(co.reliable
        ? { name: 'Cohort by Sale Month', note: `Linkage: ${co.stats.linkedRows} of ${co.stats.returnRows} return rows matched a sale row by Order Item ID.`,
          columns: [c('Sale Month'), money('Gross Sales Value'), c('Gross Sold Units', 'int'), money('Linked Return Value'), c('Linked Returned Units', 'int'), c('Cohort Unit Rate %', 'pct'), c('Cohort Value Rate %', 'pct'), c('Avg Days to Return', 'dec')],
          rows: co.rows.map((r) => [fmtMonth(r.saleMonth), r.grossSalesValue, r.grossSoldUnits, r.returnValue, r.returnedUnits, r.returnUnitRatePct, r.returnValueRatePct, r.avgDaysToReturn]) }
        : { name: 'Cohort by Sale Month', columns: [c('Status')], rows: [],
          note: co.stats.returnRows === 0 ? 'No return rows in this selection.' : `Cohort view not exported: only ${co.stats.linkedRows} of ${co.stats.returnRows} return rows could be linked to a sale row by Order Item ID (minimum ${a.settings.cohortMinLinkagePct}%). The transaction-date sheets remain valid.` });
      return sheets;
    },
    definitions: ({ a }) => [...CORE_DEFS(a), ['Transaction-date view', 'Each sale and return is counted on its own Buyer Invoice Date.'], ['Cohort view', 'Returns attributed to the month of the original sale, matched by Order Item ID. Exported only when the match rate reaches the configured minimum.']],
  },
  {
    id: 'low-movement-skus', title: 'Low-Movement SKU Report',
    description: 'SKUs flagged Low movement or No recent sales, with movement windows.',
    build: ({ a }) => {
      const rows = a.skuRows.filter((r) => r.classes.includes('LOW_MOVEMENT') || r.classes.includes('NO_RECENT_SALES'));
      return [{
        name: 'Low Movement',
        note: a.asOfBeyondCoverage
          ? `The reporting date ${fmtDate(a.asOf)} is after the last imported transaction (${fmtDate(a.coverage!.to)}), so inactivity was not assessed and no SKU is listed. Set the date range to end on or before the last imported date.`
          : `Reporting date ${fmtDate(a.asOf)}. Low movement: ${a.settings.lowMovementMaxUnits} or fewer units in ${a.settings.lowMovementDays} days. No recent sales: no Sale in ${a.settings.noRecentSalesDays} days.`,
        columns: [c('SKU'), c('Platform'), c('Classification'), c('First Recorded Sale Date'), c('Last Recorded Sale Date'), c('Days Since Last Sale', 'int'), c('Units Last 7 Days', 'int'), c('Units Last 30 Days', 'int'), c('Units Last 90 Days', 'int'), money('Revenue Last 30 Days'), money('Revenue Previous 30 Days'), c('Revenue Growth %', 'pct'), c('Avg Daily Units', 'dec')],
        rows: rows.sort((x, y) => (y.movement?.daysSinceLastSale ?? 0) - (x.movement?.daysSinceLastSale ?? 0)).map((r) => {
          const m = r.movement!;
          return [r.sku, PLATFORM_LABEL[r.platform], r.classes.map((x) => SKU_CLASS_LABEL[x]).join(', '), m.firstSaleDate ?? '', m.lastSaleDate ?? '', m.daysSinceLastSale, m.units7, m.units30, m.units90, m.rev30, m.prevRev30, m.covered.prev30 ? m.revGrowthPct : null, m.avgDailyUnits];
        }),
      }];
    },
    definitions: () => [['Revenue', 'Gross Sales Value of Sale transactions inside the window.'], ['Days Since Last Sale', 'Reporting date minus the last Sale date. Not, on its own, evidence of dead stock.']],
  },
  {
    id: 'state-wise-sales', title: 'State-wise Sales Report',
    description: 'Sales, returns and return rates by customer billing state.',
    build: ({ a }) => [{ name: 'States', columns: [c('State'), ...totalsCols, c('Share of Net Sales %', 'pct')],
      rows: [...a.byState].sort((x, y) => y.netSalesValue - x.netSalesValue).map((g) => [g.key, ...totalsCells(g), a.totals.netSalesValue ? (g.netSalesValue / a.totals.netSalesValue) * 100 : null]) }],
    definitions: ({ a }) => [...CORE_DEFS(a), ['State', 'Customer’s billing state. Unrecognised names are listed as written and never merged automatically.']],
  },
  {
    id: 'marketplace-comparison', title: 'Marketplace Comparison Report',
    description: 'The same measures for each marketplace with imported data.',
    build: ({ a }) => [{ name: 'Marketplaces', note: 'Only marketplaces with imported data are listed. Flipkart is the only marketplace whose import is available in this version.',
      columns: [c('Marketplace'), c('Data From'), c('Data To'), ...totalsCols],
      rows: a.byPlatform.map((g) => { const cov = a.coverageByPlatform.get(g.key as Platform); return [PLATFORM_LABEL[g.key as Platform], cov?.from ?? '', cov?.to ?? '', ...totalsCells(g)]; }) }],
    definitions: ({ a }) => CORE_DEFS(a),
  },
  {
    id: 'daily-sales', title: 'Daily Sales Report',
    description: 'One row per day in the selected period.',
    build: ({ a }) => [{ name: 'Daily', columns: [c('Date'), ...totalsCols], rows: timeSeries(a.period, 'day', a.settings.cancellationPolicy, a.span).map((g) => [g.key, ...totalsCells(g)]) }],
    definitions: ({ a }) => [...CORE_DEFS(a), ['Date', 'Buyer Invoice Date in the reporting timezone. Every day of the reporting period that imported reports reach is listed, including days with no transactions.']],
  },
  {
    id: 'monthly-sales', title: 'Monthly Sales Report',
    description: 'One row per calendar month in the selected period.',
    build: ({ a }) => [{ name: 'Monthly', columns: [c('Month'), ...totalsCols], rows: timeSeries(a.period, 'month', a.settings.cancellationPolicy, a.span).map((g) => [fmtMonth(g.key), ...totalsCells(g)]) }],
    definitions: ({ a }) => CORE_DEFS(a),
  },
  {
    id: 'data-quality', title: 'Data Quality Report',
    description: 'Validation findings, reconciliation checks and rejected rows for the filtered data.',
    build: ({ a, rejected, costs }) => {
      const q = runQualityChecks(a.period, a.settings, costs, rejected.length, a.today);
      const r = reconcile(a.period, a.settings.cancellationPolicy);
      return [
        { name: 'Findings', columns: [c('Severity'), c('Check'), c('Count', 'int'), c('Detail'), c('Examples')], rows: q.map((i) => [i.severity, i.title, i.count, i.detail, i.examples.join(' | ')]), note: q.length ? undefined : 'No data-quality findings for this selection.' },
        { name: 'Reconciliation', columns: [c('Check'), c('Expected', 'dec'), c('Actual', 'dec'), c('Result')], rows: r.checks.map((x) => [x.name, x.expected, x.actual, x.ok ? 'OK' : 'MISMATCH']) },
        { name: 'Rejected Rows', columns: [c('Source File'), c('Source Row', 'int'), c('Reasons'), c('Order ID'), c('Order Item ID'), c('SKU'), c('Event Sub Type'), c('Item Quantity'), c('Taxable Value'), c('Buyer Invoice Date'), c("Customer's Billing State")],
          note: 'Rejected rows are listed for all active imports; date and SKU filters cannot be applied to rows that failed validation.',
          rows: rejected.map((x) => [x.sourceFile, x.sourceRow, x.reasons.join('; '), x.raw['Order ID'] ?? '', x.raw['Order Item ID'] ?? '', x.raw.SKU ?? '', x.raw['Event Sub Type'] ?? '', x.raw['Item Quantity'] ?? '', x.raw['Taxable Value'] ?? '', x.raw['Buyer Invoice Date'] ?? '', x.raw["Customer's Billing State"] ?? '']) },
      ];
    },
    definitions: () => [['Findings', 'Checks only report; source values are never changed.'], ['Reconciliation', 'Each headline figure is recomputed by independent routes and compared.']],
  },
  {
    id: 'import-history', title: 'Import History Report',
    description: 'Every import batch with its summary, and the audit log. Not affected by filters.',
    build: ({ batches, audit }) => [
      { name: 'Import Batches', columns: [c('Batch ID'), c('Marketplace'), c('File Name'), c('Imported At'), c('Imported By'), c('Status'), c('Source Rows', 'int'), c('Accepted Rows', 'int'), c('Rejected Rows', 'int'), c('Empty Rows', 'int'), c('Duplicate Candidates in File', 'int'), c('Already Imported', 'int'), c('Unmapped Event Types'), c('Date From'), c('Date To'), money('Sales Value'), money('Return Value'), money('Cancellation Value'), c('Gross Sold Units', 'int'), c('Returned Units', 'int'), c('File SHA-256')],
        rows: batches.map((b) => [b.batchId, PLATFORM_LABEL[b.platform], b.fileName, b.importedAt, b.importedBy, b.status, b.sourceRows, b.acceptedRows, b.rejectedRows, b.emptyRows, b.duplicateInFile, b.duplicateExisting, b.unmappedEvents.join(', '), b.dateFrom, b.dateTo, b.grossSalesValue, b.returnValue, b.cancellationValue, b.grossSoldUnits, b.returnedUnits, b.fileHash]) },
      { name: 'Audit Log', columns: [c('Time (UTC)'), c('User'), c('Action'), c('Detail')], rows: audit.map((x) => [x.at, x.user, x.action, x.detail]) },
    ],
    definitions: () => [['Batch totals', 'Figures recorded at import time using the mapping in force then. Current dashboard figures use the current mapping.']],
  },
];

export function buildReport(def: ReportDef, ctx: ReportContext): Report {
  const a = ctx.a;
  const meta: [string, string][] = [
    ['Report', def.title],
    ['Generated', `${new Date().toISOString()} (UTC)`],
    ...(def.id === 'import-history' ? ([['Filters', 'Not applicable to this report']] as [string, string][]) : describeFilters(a)),
    ['Source marketplaces', a.options.platforms.map((p) => PLATFORM_LABEL[p]).join(', ') || 'None'],
    ['Reporting timezone', a.settings.reportingTimezone],
    ['Financial units', 'Indian Rupees (INR). Values are taxable value: invoice amount excluding taxes.'],
    ['Cancellation policy', a.settings.cancellationPolicy === 'reversal' ? 'Reversal: subtracted from Net Sales' : 'Separate: reported on its own, not subtracted'],
    ['Data stored in', ctx.dataSource],
  ];
  return { id: def.id, title: def.title, sheets: def.build(ctx), definitions: def.definitions(ctx), meta };
}
