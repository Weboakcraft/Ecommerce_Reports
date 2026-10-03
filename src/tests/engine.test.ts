import { describe, expect, it } from 'vitest';
import { ADAPTERS, FileValidationError, openSource } from '../adapters';
import { change, previousPeriod } from '../analytics/date-ranges';
import { computeMovement, coverageByPlatform } from '../analytics/movement';
import { CostIndex, validateCosts } from '../analytics/profitability/costs';
import { analyseProfit, PROFIT_UNAVAILABLE, summariseProfit } from '../analytics/profitability/profit';
import { reconcile, runQualityChecks } from '../analytics/quality';
import { buildCohort } from '../analytics/returns/cohort';
import { aggregateBy, computeTotals } from '../analytics/revenue/totals';
import { buildSkuRows } from '../analytics/sku-classification';
import { reclassify, summarizeEvents } from '../analytics/transactions/classify';
import { planImport } from '../analytics/transactions/duplicates';
import { applyTxnFilters } from '../analytics/transactions/filters';
import { DEFAULT_EVENT_MAPPINGS, EMPTY_FILTERS } from '../schemas/defaults';
import type { EventMapping } from '../types';
import { excelSerialToISO, parseTextDate } from '../utils/dates';
import { parseNumber } from '../utils/numbers';
import { safeCell } from '../utils/sanitize';
import { normalizeSku } from '../utils/sku';
import { normalizeState } from '../utils/states';
import { demoRows, serial, toAoa, toCsvBuffer, toWorkbookBuffer } from './fixtures/synthetic';
import { cost, parseRows, row, S, txns } from './helpers';
import * as XLSX from 'xlsx';

const policy = { cancellationPolicy: 'separate', returnCostPolicy: 'resalable_full' } as const;

describe('1-2, 10. orders, order items and SKUs', () => {
  const t = txns([
    row({ orderId: 'OD1', orderItemId: 'I1', sku: 'SKU:A-1' }),
    row({ orderId: 'OD1', orderItemId: 'I2', sku: 'SKU:B-2', taxable: 500 }),
    row({ orderId: 'OD1', orderItemId: 'I3', sku: 'SKU:A-1', taxable: 1000 }),
    row({ orderId: 'OD2', orderItemId: 'I4', sku: 'SKU:A-1', qty: 2, taxable: 2000 }),
  ]);
  const tot = computeTotals(t, 'separate');
  it('counts an order once however many items it has', () => {
    expect(tot.uniqueOrders).toBe(2);
    expect(tot.uniqueOrderItems).toBe(4);
  });
  it('keeps every legitimate item row of the same order', () => {
    expect(t).toHaveLength(4);
    expect(new Set(t.map((x) => x.id)).size).toBe(4);
    expect(t.every((x) => x.occurrence === 1)).toBe(true);
    expect(tot.grossSalesValue).toBe(4500);
    expect(tot.grossSoldUnits).toBe(5);
  });
  it('splits one order across its SKUs', () => {
    const by = aggregateBy(t, (x) => x.sku, 'separate');
    expect(by.find((g) => g.key === 'A-1')!.uniqueOrders).toBe(2);
    expect(by.find((g) => g.key === 'B-2')!.grossSalesValue).toBe(500);
  });
});

describe('3-6. sales, returns and signs', () => {
  it('sums positive sale amounts', () => {
    const tot = computeTotals(txns([row({ taxable: 1200.5 }), row({ orderItemId: 'I2', taxable: 799.5 })]), 'separate');
    expect(tot.grossSalesValue).toBe(2000);
    expect(tot.netSalesValue).toBe(2000);
  });
  it('reports a negative-amount return as a positive Return Value', () => {
    const tot = computeTotals(txns([row(), row({ event: 'Return', qty: -1, taxable: -1000, date: '2026-06-15' })]), 'separate');
    expect(tot.returnValue).toBe(1000);
    expect(tot.netSalesValue).toBe(0);
  });
  it('reports a positive-amount return identically', () => {
    const tot = computeTotals(txns([row(), row({ event: 'Return', qty: 1, taxable: 1000, date: '2026-06-15' })]), 'separate');
    expect(tot.returnValue).toBe(1000);
    expect(tot.returnedUnits).toBe(1);
    expect(tot.netSalesValue).toBe(0);
  });
  it('does not subtract a negative return quantity twice', () => {
    const tot = computeTotals(
      txns([row({ qty: 3, taxable: 3000 }), row({ event: 'Return', qty: -1, taxable: -1000, date: '2026-06-15' })]),
      'separate',
    );
    expect(tot.grossSoldUnits).toBe(3);
    expect(tot.returnedUnits).toBe(1);
    expect(tot.netUnits).toBe(2); // not 3 - (-1) = 4, and not 3 - 1 - 1 = 1
  });
  it('keeps the raw sign on the stored record', () => {
    const t = txns([row({ event: 'Return', qty: -2, taxable: -500 })]);
    expect(t[0].rawQty).toBe(-2);
    expect(t[0].rawTaxable).toBe(-500);
  });
  it('does not treat a negative amount alone as a return', () => {
    const t = txns([row({ event: 'Sale', qty: -1, taxable: -1000 })]);
    expect(t[0].txnType).toBe('SALE');
    const tot = computeTotals(t, 'separate');
    expect(tot.returnValue).toBe(0);
    expect(tot.grossSalesValue).toBe(-1000);
    const q = runQualityChecks(t, S, new CostIndex([]), 0);
    expect(q.find((i) => i.code === 'NEGATIVE_SALE')!.count).toBe(1);
  });
});

describe('7. cancellations', () => {
  const t = txns([
    row({ orderItemId: 'I1', taxable: 1000 }),
    row({ orderItemId: 'I2', taxable: 800 }),
    row({ orderItemId: 'I2', event: 'Cancellation', qty: -1, taxable: -800 }),
    row({ orderItemId: 'I3', event: 'Cancellation', qty: 0, taxable: 0 }),
  ]);
  it('"separate" policy: reported on its own, never subtracted from Net Sales', () => {
    const tot = computeTotals(t, 'separate');
    expect(tot.cancellationValue).toBe(800);
    expect(tot.cancelledUnits).toBe(1);
    expect(tot.cancellationRows).toBe(2);
    expect(tot.grossSalesValue).toBe(1800);
    expect(tot.netSalesValue).toBe(1800);
  });
  it('"reversal" policy: subtracted exactly once', () => {
    const tot = computeTotals(t, 'reversal');
    expect(tot.netSalesValue).toBe(1000);
    expect(tot.netUnits).toBe(1);
    expect(tot.cancellationValue).toBe(800);
  });
  it('a cancellation with no financial value changes nothing', () => {
    const only = t.filter((x) => x.orderItemId !== 'I2');
    expect(computeTotals(only, 'reversal').netSalesValue).toBe(1000);
  });
});

describe('8. unmapped event values', () => {
  const rows = [row(), row({ orderItemId: 'I2', event: 'Return Cancellation', taxable: 700 }), row({ orderItemId: 'I3', event: 'sale return thing' })];
  const t = txns(rows);
  it('are never guessed from substrings', () => {
    expect(t.map((x) => x.txnType)).toEqual(['SALE', 'UNMAPPED', 'UNMAPPED']);
  });
  it('are visible with counts and excluded from metrics until mapped', () => {
    const ev = summarizeEvents(t);
    expect(ev.find((e) => e.eventValue === 'Return Cancellation')).toMatchObject({ rows: 1, rawTaxable: 700, txnType: 'UNMAPPED' });
    const tot = computeTotals(t, 'separate');
    expect(tot.unmappedRows).toBe(2);
    expect(tot.grossSalesValue).toBe(1000);
  });
  it('can be reprocessed after an administrator maps them', () => {
    const m: EventMapping[] = [...DEFAULT_EVENT_MAPPINGS, { platform: 'flipkart', eventValue: 'Return Cancellation', txnType: 'EXCLUDE', source: 'user', updatedAt: '' }];
    const re = reclassify(t, m);
    expect(re[1].txnType).toBe('EXCLUDE');
    expect(computeTotals(re, 'separate').unmappedRows).toBe(1);
  });
  it('matching is case- and whitespace-insensitive but exact', () => {
    const t2 = txns([row({ event: '  SALE ' }), row({ orderItemId: 'I2', event: 'Sales' })]);
    expect(t2.map((x) => x.txnType)).toEqual(['SALE', 'UNMAPPED']);
  });
});

describe('9. duplicate file imports', () => {
  const rows = [row(), row({ orderItemId: 'I2' }), row({ orderItemId: 'I2' })];
  it('re-importing the same file is idempotent', () => {
    const first = parseRows(rows, { batchId: 'b1' });
    const plan1 = planImport(first.transactions, new Set());
    expect(plan1.toImport).toHaveLength(3);
    const stored = new Set(plan1.toImport.map((t) => t.id));
    const second = parseRows(rows, { batchId: 'b2' });
    const plan2 = planImport(second.transactions, stored);
    expect(plan2.toImport).toHaveLength(0);
    expect(plan2.duplicateExisting).toHaveLength(3);
    expect(plan2.skipped).toHaveLength(3);
  });
  it('flags identical rows inside a file but keeps them by default', () => {
    const p = planImport(parseRows(rows).transactions, new Set());
    expect(p.duplicateInFile).toHaveLength(1);
    expect(p.toImport).toHaveLength(3);
    const p2 = planImport(parseRows(rows).transactions, new Set(), { inFileDuplicates: 'keep_first', existingDuplicates: 'skip' });
    expect(p2.toImport).toHaveLength(2);
    expect(p2.skipped).toHaveLength(1);
  });
  it('an overlapping file only adds its new rows', () => {
    const a = parseRows([row(), row({ orderItemId: 'I2' })], { batchId: 'b1' });
    const stored = new Set(a.transactions.map((t) => t.id));
    const b = parseRows([row({ orderItemId: 'I2' }), row({ orderItemId: 'I9' })], { batchId: 'b2' });
    const plan = planImport(b.transactions, stored);
    expect(plan.toImport.map((t) => t.orderItemId)).toEqual(['I9']);
  });
  it('a sale and its return on the same item are not duplicates', () => {
    const p = planImport(txns([row(), row({ event: 'Return', qty: -1, taxable: -1000 })]), new Set());
    expect(p.duplicateInFile).toHaveLength(0);
  });
});

describe('11-12. SKU normalisation', () => {
  it('removes only an exact leading SKU: prefix, case-insensitively', () => {
    expect(normalizeSku('SKU:OC-07-BLACK')).toBe('OC-07-BLACK');
    expect(normalizeSku('  sku:OC-07-BLACK  ')).toBe('OC-07-BLACK');
    expect(normalizeSku('Sku: OC-07-BLACK')).toBe('OC-07-BLACK');
    expect(normalizeSku('OC-07-BLACK')).toBe('OC-07-BLACK');
    expect(normalizeSku('MY-SKU:07')).toBe('MY-SKU:07');
    expect(normalizeSku('SKU:SKU:X')).toBe('SKU:X');
    expect(normalizeSku('SKUOC-07')).toBe('SKUOC-07');
    expect(normalizeSku('A - B_c/1')).toBe('A - B_c/1');
    // Flipkart wraps the cell in triple quotes: """SKU:OC-HURRICANE-GREY-1"""
    expect(normalizeSku('"""SKU:OC-HURRICANE-GREY-1"""')).toBe('OC-HURRICANE-GREY-1');
    expect(normalizeSku('"SKU:2-15-BROWN"')).toBe('2-15-BROWN');
    expect(normalizeSku('""OC-07')).toBe('""OC-07'); // unbalanced quotes are kept
    expect(normalizeSku('A"B')).toBe('A"B');
  });
  it('flags blank SKUs for review and keeps the row', () => {
    const p = parseRows([row({ sku: '' }), row({ orderItemId: 'I2', sku: '   ' }), row({ orderItemId: 'I3', sku: 'SKU:' })]);
    expect(p.transactions).toHaveLength(3);
    expect(p.warnings.filter((w) => w.code === 'BLANK_SKU')).toHaveLength(3);
    expect(computeTotals(p.transactions, 'separate').grossSalesValue).toBe(3000);
  });
});

describe('13-14. dates', () => {
  it('parses Excel serial dates', () => {
    expect(excelSerialToISO(45000).iso).toBe('2023-03-15');
    expect(excelSerialToISO(serial(2026, 6, 10)).iso).toBe('2026-06-10');
    expect(excelSerialToISO(46183.99).iso).toBe(excelSerialToISO(46183).iso);
    expect(txns([row({ date: serial(2026, 2, 28) })])[0].txnDate).toBe('2026-02-28');
  });
  it('parses supported text formats', () => {
    const tz = 'Asia/Kolkata';
    expect(parseTextDate('2026-06-10', tz).iso).toBe('2026-06-10');
    expect(parseTextDate('2026-06-10 23:59:59', tz).iso).toBe('2026-06-10');
    expect(parseTextDate('10-06-2026', tz).iso).toBe('2026-06-10');
    expect(parseTextDate('10/06/2026', tz, 'MDY').iso).toBe('2026-10-06');
    expect(parseTextDate('10-Jun-2026', tz).iso).toBe('2026-06-10');
    expect(parseTextDate('Jun 10, 2026', tz).iso).toBe('2026-06-10');
    expect(parseTextDate('10/06/2026', tz).ambiguous).toBe(true);
    expect(parseTextDate('25/06/2026', tz).ambiguous).toBeUndefined();
  });
  it('applies the reporting timezone to values that carry an offset', () => {
    expect(parseTextDate('2026-06-10T20:00:00Z', 'Asia/Kolkata').iso).toBe('2026-06-11');
    expect(parseTextDate('2026-06-10T20:00:00Z', 'UTC').iso).toBe('2026-06-10');
    expect(parseTextDate('2026-06-10T01:00:00+05:30', 'UTC').iso).toBe('2026-06-09');
  });
  it('rejects invalid dates instead of substituting today', () => {
    for (const bad of ['31-02-2026', 'yesterday', '2026-13-01', '25/25/2026', '']) {
      expect(parseTextDate(bad, 'Asia/Kolkata').iso).toBeNull();
    }
    const p = parseRows([row(), row({ orderItemId: 'I2', date: 'not a date' }), row({ orderItemId: 'I3', date: null }), row({ orderItemId: 'I4', date: 5 })]);
    expect(p.transactions).toHaveLength(1);
    expect(p.rejected).toHaveLength(3);
    expect(p.rejected[0]).toMatchObject({ sourceRow: 3 });
    expect(p.rejected[0].reasons[0]).toMatch(/Buyer Invoice Date/);
  });
  it('keeps the original date value for traceability', () => {
    expect(txns([row({ date: '10-Jun-2026' })])[0].rawDate).toBe('10-Jun-2026');
  });
});

describe('15-16. zero denominators', () => {
  it('zero revenue yields null rates, not NaN or Infinity', () => {
    const tot = computeTotals(txns([row({ event: 'Return', qty: -1, taxable: -500 })]), 'separate');
    expect(tot.grossSalesValue).toBe(0);
    expect(tot.returnUnitRatePct).toBeNull();
    expect(tot.returnValueRatePct).toBeNull();
    expect(computeTotals([], 'separate').netSalesValue).toBe(0);
  });
  it('distinguishes unit rate from value rate', () => {
    const tot = computeTotals(
      txns([
        row({ orderItemId: 'I1', qty: 1, taxable: 3000 }),
        row({ orderItemId: 'I2', qty: 3, taxable: 1000 }),
        row({ orderItemId: 'I1', event: 'Return', qty: -1, taxable: -3000, date: '2026-06-12' }),
      ]),
      'separate',
    );
    expect(tot.returnUnitRatePct).toBe(25);
    expect(tot.returnValueRatePct).toBe(75);
  });
  it('percentage change is withheld when the previous period is zero', () => {
    expect(change(100, 0)).toMatchObject({ abs: 100, pct: null });
    expect(change(100, null)).toMatchObject({ abs: null, pct: null });
    expect(change(150, 100)).toMatchObject({ abs: 50, pct: 50 });
    expect(change(50, -100).pct).toBe(150);
  });
});

describe('17-19. profitability', () => {
  const sale = row({ qty: 2, taxable: 2000, date: '2026-06-10' });
  it('is unavailable without cost data and never fabricated', () => {
    const a = analyseProfit({ txns: txns([sale]), costs: new CostIndex([]), expenses: [], policy, range: null });
    const s = summariseProfit(a);
    expect(s.total.available).toBe(false);
    expect(s.total.reason).toBe(PROFIT_UNAVAILABLE);
    expect(s.total.grossProfit).toBeNull();
    expect(s.lossMakingSkuCount).toBe(0);
  });
  it('is unavailable for a SKU when any sale date lacks a cost record', () => {
    const t = txns([sale, row({ orderItemId: 'I2', date: '2025-12-31' })]);
    const a = analyseProfit({ txns: t, costs: new CostIndex([cost()]), expenses: [], policy, range: null });
    expect(a.bySku.get('flipkart|A-1')!.available).toBe(false);
    expect(a.bySku.get('flipkart|A-1')!.missingCostRows).toBe(1);
  });
  it('computes gross profit and margin with full cost data', () => {
    const a = analyseProfit({ txns: txns([sale]), costs: new CostIndex([cost()]), expenses: [], policy, range: null });
    const r = a.bySku.get('flipkart|A-1')!;
    expect(r.cogs).toBe(900);
    expect(r.grossProfit).toBe(1100);
    expect(r.grossMarginPct).toBeCloseTo(55, 9);
  });
  it('applies the cost effective on each transaction date (historical changes)', () => {
    const costs = new CostIndex([
      cost({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-14', unitCost: 400, packagingCost: 0 }),
      cost({ effectiveFrom: '2026-06-15', effectiveTo: '', unitCost: 600, packagingCost: 0 }),
    ]);
    const t = txns([row({ date: '2026-06-14' }), row({ orderItemId: 'I2', date: '2026-06-15' })]);
    const r = analyseProfit({ txns: t, costs, expenses: [], policy, range: null }).bySku.get('flipkart|A-1')!;
    expect(r.cogs).toBe(1000);
    expect(r.grossProfit).toBe(1000);
  });
  it('prefers a platform-specific cost over a general one', () => {
    const idx = new CostIndex([cost({ unitCost: 400, packagingCost: 0 }), cost({ platform: 'flipkart', unitCost: 450, packagingCost: 0 })]);
    expect(idx.lookup('flipkart', 'A-1', '2026-06-01')!.unitCost).toBe(450);
    expect(idx.lookup('amazon', 'A-1', '2026-06-01')!.unitCost).toBe(400);
  });
  it('reverses sales and cost for returns according to the return policy, once', () => {
    const t = txns([sale, row({ event: 'Return', qty: -1, taxable: -1000, date: '2026-06-20' })]);
    const costs = new CostIndex([cost()]); // 400 unit + 50 packaging
    const run = (returnCostPolicy: 'resalable_full' | 'resalable_packaging_lost' | 'written_off') =>
      analyseProfit({ txns: t, costs, expenses: [], policy: { cancellationPolicy: 'separate', returnCostPolicy }, range: null }).bySku.get('flipkart|A-1')!;
    expect(run('resalable_full')).toMatchObject({ netSalesValue: 1000, cogs: 450, grossProfit: 550 });
    expect(run('resalable_packaging_lost')).toMatchObject({ cogs: 500, grossProfit: 500 });
    expect(run('written_off')).toMatchObject({ cogs: 900, grossProfit: 100 });
  });
  it('flags loss-making SKUs only with complete costs', () => {
    const t = txns([row({ taxable: 300 })]);
    const s = summariseProfit(analyseProfit({ txns: t, costs: new CostIndex([cost()]), expenses: [], policy, range: null }));
    expect(s.lossMakingSkuCount).toBe(1);
    expect(s.total.grossProfit).toBe(-150);
  });
  it('allocates shared expenses by gross sales and pro-rates by days', () => {
    const t = txns([row({ taxable: 3000, date: '2026-06-10' }), row({ orderItemId: 'I2', sku: 'SKU:B-2', taxable: 1000, date: '2026-06-11' })]);
    const costs = new CostIndex([cost(), cost({ sku: 'B-2' })]);
    const expenses = [{ id: 'e', platform: 'all' as const, sku: '', type: 'advertising' as const, periodFrom: '2026-06-01', periodTo: '2026-06-30', amount: 600, notes: '', updatedBy: '', updatedAt: '' }];
    const a = analyseProfit({ txns: t, costs, expenses, policy, range: { from: '2026-06-01', to: '2026-06-15' } });
    expect(a.bySku.get('flipkart|A-1')!.allocatedExpenses).toBeCloseTo(225, 6); // 600 * 15/30 * 3000/4000
    expect(a.bySku.get('flipkart|B-2')!.allocatedExpenses).toBeCloseTo(75, 6);
    expect(a.bySku.get('flipkart|A-1')!.contributionProfit).toBeCloseTo(3000 - 450 - 225, 6);
  });
  it('validates duplicate and overlapping cost periods', () => {
    const issues = validateCosts([
      cost({ id: 'a', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
      cost({ id: 'b', effectiveFrom: '2026-06-01', effectiveTo: '' }),
      cost({ id: 'c', sku: 'Z', effectiveFrom: '2026-02-01', effectiveTo: '2026-01-01' }),
      cost({ id: 'd', sku: 'Y', unitCost: -1 }),
    ]);
    expect(issues.find((i) => i.id === 'b')!.type).toBe('overlap');
    expect(issues.find((i) => i.id === 'c')!.type).toBe('range');
    expect(issues.find((i) => i.id === 'd')!.type).toBe('value');
  });
});

describe('20. date-range filtering and previous period', () => {
  const t = txns([
    row({ orderItemId: 'I1', date: '2026-05-31' }),
    row({ orderItemId: 'I2', date: '2026-06-01' }),
    row({ orderItemId: 'I3', date: '2026-06-30' }),
    row({ orderItemId: 'I4', date: '2026-07-01' }),
  ]);
  it('includes both the start and the end date', () => {
    const f = { ...EMPTY_FILTERS, dateFrom: '2026-06-01', dateTo: '2026-06-30' };
    expect(applyTxnFilters(t, f).map((x) => x.orderItemId)).toEqual(['I2', 'I3']);
  });
  it('previous period has the same length immediately before', () => {
    expect(previousPeriod({ from: '2026-06-10', to: '2026-06-16' })).toEqual({ from: '2026-06-03', to: '2026-06-09' });
  });
  it('whole calendar months compare with whole calendar months', () => {
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ from: '2026-04-01', to: '2026-06-30' })).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
  it('filters by SKU, state, platform and type', () => {
    const mixed = txns([row(), row({ orderItemId: 'I2', sku: 'SKU:B-2', state: 'Goa' }), row({ orderItemId: 'I3', event: 'Return', qty: -1, taxable: -1000 })]);
    expect(applyTxnFilters(mixed, { ...EMPTY_FILTERS, skus: ['B-2'] })).toHaveLength(1);
    expect(applyTxnFilters(mixed, { ...EMPTY_FILTERS, states: ['Delhi'] })).toHaveLength(2);
    expect(applyTxnFilters(mixed, { ...EMPTY_FILTERS, txnTypes: ['RETURN'] })).toHaveLength(1);
    expect(applyTxnFilters(mixed, { ...EMPTY_FILTERS, platforms: ['amazon'] })).toHaveLength(0);
  });
});

describe('importer: structure, columns and validation', () => {
  it('requires a sheet named exactly "Sales Report"', () => {
    const src = openSource(toWorkbookBuffer([row()], 'Sales report'), 'x.xlsx');
    const check = ADAPTERS.flipkart.checkStructure(src);
    expect(check.ok).toBe(false);
    expect(check.errors[0]).toMatch(/no sheet named exactly "Sales Report"/);
  });
  it('picks the right sheet among several', () => {
    const src = openSource(toWorkbookBuffer([row()], 'Sales Report', ['Summary', 'Help']), 'x.xlsx');
    expect(ADAPTERS.flipkart.checkStructure(src)).toMatchObject({ ok: true, sheetName: 'Sales Report' });
  });
  it('reads only the eight positional columns, ignoring decoy data and header text', () => {
    const p = parseRows([row({ taxable: 1234.56, qty: 2 })]);
    expect(p.transactions[0]).toMatchObject({ rawTaxable: 1234.56, rawQty: 2, orderId: 'OD1', orderItemId: 'I1', sku: 'A-1', state: 'Delhi' });
    // same data under completely different header names
    const aoa = toAoa([row({ taxable: 1234.56, qty: 2 })]);
    aoa[0] = aoa[0].map((_, i) => `H${i}`);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sales Report');
    const src = openSource(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'x.xlsx');
    const p2 = ADAPTERS.flipkart.parse(src, { settings: S, mappings: DEFAULT_EVENT_MAPPINGS, fileName: 'x.xlsx', batchId: 'b' });
    expect(p2.transactions[0].rawTaxable).toBe(1234.56);
  });
  it('reports a sheet that is too narrow', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b', 'c'], [1, 2, 3]]), 'Sales Report');
    const src = openSource(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'x.xlsx');
    expect(() => ADAPTERS.flipkart.parse(src, { settings: S, mappings: [], fileName: 'x.xlsx', batchId: 'b' })).toThrow(/only 3 column/);
  });
  it('rejects empty and mislabelled files', () => {
    expect(() => openSource(new ArrayBuffer(0), 'x.xlsx')).toThrow(FileValidationError);
    expect(() => openSource(new TextEncoder().encode('a,b,c').buffer as ArrayBuffer, 'x.xlsx')).toThrow(/not a valid Excel workbook/);
    expect(() => openSource(new TextEncoder().encode('hello').buffer as ArrayBuffer, 'x.pdf')).toThrow(/Unsupported file type/);
  });
  it('rejects invalid quantities and amounts with row numbers and reasons', () => {
    const p = parseRows([row({ qty: 'two' }), row({ orderItemId: 'I2', taxable: 'N/A' }), row({ orderItemId: 'I3', qty: null }), row({ orderItemId: 'I4', qty: '2', taxable: '1,250.50' })]);
    expect(p.sourceRows).toBe(4);
    expect(p.rejected.map((r) => r.sourceRow)).toEqual([2, 3, 4]);
    expect(p.rejected[0].reasons[0]).toMatch(/Item Quantity/);
    expect(p.rejected[1].reasons[0]).toMatch(/Taxable Value/);
    expect(p.transactions[0]).toMatchObject({ rawQty: 2, rawTaxable: 1250.5 });
    expect(p.transactions.length + p.rejected.length + p.emptyRows).toBe(p.sourceRows);
  });
  it('parses numbers strictly', () => {
    expect(parseNumber('(1,234.50)').value).toBe(-1234.5);
    expect(parseNumber('-12').value).toBe(-12);
    expect(parseNumber('1,00,000').value).toBe(100000);
    expect(parseNumber('12abc').value).toBeNull();
    expect(parseNumber('').value).toBeNull();
    expect(parseNumber('.').value).toBeNull();
  });
  it('reads a CSV with the same positions', () => {
    const src = openSource(toCsvBuffer([row({ date: '2026-06-10' }), row({ orderItemId: 'I2', event: 'Return', qty: -1, taxable: -1000, date: '12-06-2026' })]), 'x.csv');
    const p = ADAPTERS.flipkart.parse(src, { settings: S, mappings: DEFAULT_EVENT_MAPPINGS, fileName: 'x.csv', batchId: 'b' });
    expect(p.transactions.map((t) => t.txnDate)).toEqual(['2026-06-10', '2026-06-12']);
    expect(computeTotals(p.transactions, 'separate')).toMatchObject({ grossSalesValue: 1000, returnValue: 1000 });
  });
  it('prepared adapters refuse to import', () => {
    for (const p of ['amazon', 'myntra', 'shopify'] as const) {
      expect(ADAPTERS[p].implemented).toBe(false);
      expect(ADAPTERS[p].checkStructure(openSource(toWorkbookBuffer([row()]), 'x.xlsx')).ok).toBe(false);
    }
  });
});

describe('state normalisation', () => {
  it('reconciles harmless formatting only', () => {
    expect(normalizeState('  maharashtra ').state).toBe('Maharashtra');
    expect(normalizeState('TAMIL  NADU').state).toBe('Tamil Nadu');
    expect(normalizeState('Jammu & Kashmir').state).toBe('Jammu and Kashmir');
    expect(normalizeState('Orissa').state).toBe('Odisha');
  });
  it('never merges unknown text into a state', () => {
    expect(normalizeState('Uttar')).toMatchObject({ recognised: false, state: 'Uttar' });
    expect(normalizeState('Bangalore Region').recognised).toBe(false);
    expect(normalizeState('Pradesh').recognised).toBe(false);
    expect(normalizeState('').recognised).toBe(false);
  });
  it('honours user-approved aliases', () => {
    expect(normalizeState('Bangalore Region', { 'BANGALORE REGION': 'Karnataka' })).toMatchObject({ state: 'Karnataka', recognised: true });
  });
});

describe('movement, coverage and classification', () => {
  const rows = [];
  for (let d = 1; d <= 30; d++) {
    const date = `2026-06-${String(d).padStart(2, '0')}`;
    rows.push(row({ orderId: `A${d}`, orderItemId: `A${d}`, sku: 'SKU:FAST', date, taxable: 1000 }));
    if (d <= 6) rows.push(row({ orderId: `B${d}`, orderItemId: `B${d}`, sku: 'SKU:STOPPED', date }));
    if (d % 2 === 0) rows.push(row({ orderId: `R${d}`, orderItemId: `A${d}`, sku: 'SKU:FAST', event: 'Return', qty: -1, taxable: -1000, date }));
  }
  for (let d = 1; d <= 31; d++) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    rows.push(row({ orderId: `C${d}`, orderItemId: `C${d}`, sku: 'SKU:FAST', date, taxable: d <= 5 ? 1000 : 0.01, qty: 1 }));
  }
  const all = txns(rows);
  const cov = coverageByPlatform(all);
  it('measures windows back from the reporting date', () => {
    const m = computeMovement(all, '2026-07-31', cov, S).get('flipkart|STOPPED')!;
    expect(m.lastSaleDate).toBe('2026-06-06');
    expect(m.daysSinceLastSale).toBe(55);
    expect(m.units30).toBe(0);
    expect(m.covered.noRecent).toBe(true);
  });
  it('classifies no-recent-sales, high-return and declining with transparent notes', () => {
    const movement = computeMovement(all, '2026-07-31', cov, S);
    const skuRows = buildSkuRows({ periodTxns: all, movement, profitBySku: new Map(), settings: S, aliases: [] });
    const stopped = skuRows.find((r) => r.sku === 'STOPPED')!;
    const fast = skuRows.find((r) => r.sku === 'FAST')!;
    expect(stopped.classes).toContain('NO_RECENT_SALES');
    expect(fast.classes).toContain('HIGH_RETURN');
    expect(fast.classes).toContain('DECLINING');
    expect(fast.classes).not.toContain('LOSS_MAKING');
    expect(fast.classNotes.join(' ')).toMatch(/High return: unit return rate/);
  });
  it('does not call a SKU inactive when the reporting date is beyond report coverage', () => {
    const movement = computeMovement(all, '2026-10-03', cov, S);
    const skuRows = buildSkuRows({ periodTxns: all, movement, profitBySku: new Map(), settings: S, aliases: [] });
    const stopped = skuRows.find((r) => r.sku === 'STOPPED')!;
    expect(stopped.classes).not.toContain('NO_RECENT_SALES');
    expect(stopped.classes).toContain('INSUFFICIENT_DATA');
  });
});

describe('return cohort linkage', () => {
  it('links returns to the original sale month and reports linkage honestly', () => {
    const t = txns([
      row({ orderItemId: 'I1', date: '2026-05-28' }),
      row({ orderItemId: 'I1', event: 'Return', qty: -1, taxable: -1000, date: '2026-06-04' }),
      row({ orderItemId: 'I2', date: '2026-06-02' }),
      row({ orderItemId: 'I9', event: 'Return', qty: -1, taxable: -400, date: '2026-06-09' }),
    ]);
    const c = buildCohort(t, null, 90);
    expect(c.stats).toMatchObject({ returnRows: 2, linkedRows: 1, linkagePct: 50 });
    expect(c.reliable).toBe(false);
    expect(c.rows.find((r) => r.saleMonth === '2026-05')).toMatchObject({ returnValue: 1000, returnUnitRatePct: 100, avgDaysToReturn: 7 });
    expect(c.rows.find((r) => r.saleMonth === '2026-06')!.returnValue).toBe(0);
    expect(c.unlinkedReturnValue).toBe(400);
    expect(buildCohort(t.slice(0, 3), null, 90).reliable).toBe(true);
  });
});

describe('exports', () => {
  it('neutralises formula injection in text cells and leaves numbers alone', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(safeCell('+1')).toBe(`'+1`);
    expect(safeCell('@cmd')).toBe(`'@cmd`);
    expect(safeCell('-ABC')).toBe(`'-ABC`);
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell('OC-07-BLACK')).toBe('OC-07-BLACK');
  });
});

describe('reconciliation on the synthetic dataset', () => {
  const parsed = parseRows(demoRows());
  const all = parsed.transactions;
  it('accounts for every source row', () => {
    expect(parsed.rejected).toHaveLength(4);
    expect(parsed.transactions.length + parsed.rejected.length + parsed.emptyRows).toBe(parsed.sourceRows);
  });
  it('every route to each headline figure agrees', () => {
    for (const p of ['separate', 'reversal'] as const) {
      const r = reconcile(all, p);
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.allOk).toBe(true);
    }
  });
  it('matches an independent calculation straight from the fixture rows', () => {
    let gross = 0;
    let ret = 0;
    let units = 0;
    for (const r of demoRows()) {
      if (typeof r.qty !== 'number' || typeof r.taxable !== 'number' || r.date === null || r.date === 'not a date') continue;
      if (r.event === 'Sale') {
        gross += r.taxable;
        units += r.qty;
      }
      if (r.event === 'Return') ret += Math.abs(r.taxable);
    }
    const tot = computeTotals(all, 'separate');
    expect(tot.grossSalesValue).toBeCloseTo(gross, 2);
    expect(tot.returnValue).toBeCloseTo(ret, 2);
    expect(tot.grossSoldUnits).toBe(units);
    expect(tot.unmappedRows).toBeGreaterThan(0);
  });
  it('surfaces duplicates, unmapped events and state review items', () => {
    const q = runQualityChecks(all, S, new CostIndex([]), parsed.rejected.length);
    const codes = q.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['REJECTED_ROWS', 'UNMAPPED_EVENTS', 'MISSING_SKU', 'DUPLICATE_CANDIDATES', 'STATE_REVIEW']));
    expect(q.find((i) => i.code === 'DUPLICATE_CANDIDATES')!.count).toBe(2);
    expect(parsed.statesForReview.map((s) => s.raw)).toContain('Bangalore Region');
  });
});
