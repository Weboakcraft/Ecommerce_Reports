/**
 * Regression tests for defects found by an independent review of the engine.
 */
import { describe, expect, it } from 'vitest';
import { timeSeries } from '../analytics/date-ranges';
import { computeAnalytics } from '../app/analytics';
import { REPORTS, type ReportContext } from '../reports/build';
import { CostIndex } from '../analytics/profitability/costs';
import { DEFAULT_SETTINGS, EMPTY_FILTERS } from '../schemas/defaults';
import type { Expense, Filters } from '../types';
import { excelSerialToISO } from '../utils/dates';
import { parseNumber } from '../utils/numbers';
import { normalizeState, stateKey } from '../utils/states';
import type { FixtureRow } from './fixtures/synthetic';
import { cost, parseRows, row, txns } from './helpers';

const analyse = (t: ReturnType<typeof txns>, filters: Partial<Filters> = {}, extra: { expenses?: Expense[]; costs?: ReturnType<typeof cost>[]; today?: string } = {}) =>
  computeAnalytics({
    txns: t, filters: { ...EMPTY_FILTERS, ...filters }, settings: DEFAULT_SETTINGS, costs: extra.costs ?? [], expenses: extra.expenses ?? [],
    aliases: [], today: extra.today ?? '2026-07-01',
  });

const expense = (o: Partial<Expense> = {}): Expense => ({
  id: 'e1', platform: 'all', sku: '', type: 'advertising', periodFrom: '2026-06-01', periodTo: '2026-06-30', amount: 3000, notes: '', updatedBy: '', updatedAt: '', ...o,
});

describe('number parsing', () => {
  it('rejects ambiguous or mis-grouped numbers instead of guessing', () => {
    expect(parseNumber('(-5)').value).toBeNull();
    expect(parseNumber('1,50').value).toBeNull();
    expect(parseNumber('12,34').value).toBeNull();
    expect(parseNumber('1,2345').value).toBeNull();
    expect(parseNumber('1e5').value).toBeNull();
    expect(parseNumber('12,34,567.5').value).toBe(1234567.5);
    expect(parseNumber('1,234,567').value).toBe(1234567);
    expect(parseNumber('(5)').value).toBe(-5);
    expect(parseNumber('.5').value).toBe(0.5);
  });
});

describe('dates that are not dates', () => {
  it('rejects an out-of-range numeric cell instead of storing NaN-NaN-NaN', () => {
    expect(excelSerialToISO(1709596800).iso).toBeNull();
    expect(excelSerialToISO(1e12).iso).toBeNull();
    expect(excelSerialToISO(-5).iso).toBeNull();
    const p = parseRows([row(), row({ orderItemId: 'I2', date: 1709596800 })]);
    expect(p.transactions).toHaveLength(1);
    expect(p.rejected[0].reasons[0]).toMatch(/outside 2000-2100/);
  });
  it('a time series over a corrupt span returns instead of looping forever', () => {
    const t = txns([row()]);
    const bad = [{ ...t[0], txnDate: 'NaN-NaN-NaN' }, t[0]];
    expect(timeSeries(bad, 'day', 'separate').length).toBeGreaterThan(0);
    expect(timeSeries(t, 'day', 'separate', { from: '2026-06-10', to: 'NaN-NaN-NaN' }).length).toBeGreaterThan(0);
  });
});

describe('state aliases', () => {
  it('an empty key can never match, and non-Latin names keep their own key', () => {
    expect(normalizeState('---', { '': 'Delhi' })).toMatchObject({ recognised: false });
    expect(stateKey('दिल्ली')).not.toBe('');
    expect(stateKey('दिल्ली')).not.toBe(stateKey('मुंबई'));
    expect(normalizeState('मुंबई', { [stateKey('दिल्ली')]: 'Delhi' }).recognised).toBe(false);
  });
});

describe('expense allocation is independent of SKU and state filters', () => {
  const t = txns([
    row({ sku: 'SKU:A', orderItemId: 'I1', taxable: 1000, date: '2026-06-10', state: 'Goa' }),
    row({ sku: 'SKU:B', orderItemId: 'I2', taxable: 9000, date: '2026-06-20', state: 'Delhi' }),
  ]);
  const costs = [cost({ sku: 'A', unitCost: 100, packagingCost: 0 }), cost({ sku: 'B', unitCost: 100, packagingCost: 0 })];
  const june = { dateFrom: '2026-06-01', dateTo: '2026-06-30' };
  it('a SKU filter does not move the shared expense onto the remaining SKU', () => {
    const all = analyse(t, june, { expenses: [expense()], costs });
    const onlyA = analyse(t, { ...june, skus: ['A'] }, { expenses: [expense()], costs });
    const share = all.profitAnalysis.bySku.get('flipkart|A')!.allocatedExpenses;
    expect(share).toBeCloseTo(300, 6);
    expect(onlyA.profitAnalysis.bySku.get('flipkart|A')!.allocatedExpenses).toBeCloseTo(300, 6);
    expect(onlyA.profit.total.contributionProfit).toBeCloseTo(1000 - 100 - 300, 6);
    expect(onlyA.skuRows.find((r) => r.sku === 'A')!.classes).not.toContain('LOSS_MAKING');
  });
  it('a state filter applies no expenses at all', () => {
    const goa = analyse(t, { ...june, states: ['Goa'] }, { expenses: [expense({ sku: 'A' })], costs });
    expect(goa.profitAnalysis.bySku.get('flipkart|A')!.allocatedExpenses).toBe(0);
    expect(goa.profit.total.contributionProfit).toBe(goa.profit.total.grossProfit);
  });
  it('"all time" counts each expense in full, the same as selecting its whole period', () => {
    const allTime = analyse(t, {}, { expenses: [expense()], costs });
    const month = analyse(t, june, { expenses: [expense()], costs });
    expect(allTime.profit.total.allocatedExpenses).toBeCloseTo(3000, 6);
    expect(allTime.profit.total.contributionProfit).toBeCloseTo(month.profit.total.contributionProfit!, 6);
  });
  it('a period covering half the expense month carries half of it', () => {
    const half = analyse(t, { dateFrom: '2026-06-01', dateTo: '2026-06-15' }, { expenses: [expense()], costs });
    expect(half.profit.total.allocatedExpenses).toBeCloseTo(1500, 6);
  });
});

describe('movement coverage', () => {
  const rows: FixtureRow[] = [];
  for (let d = 1; d <= 31; d++) rows.push(row({ sku: 'SKU:A', orderId: `J${d}`, orderItemId: `J${d}`, date: `2026-01-${String(d).padStart(2, '0')}` }));
  for (let d = 1; d <= 5; d++) rows.push(row({ sku: 'SKU:B', orderId: `N${d}`, orderItemId: `N${d}`, date: `2026-06-0${d}` }));
  it('does not call a SKU inactive across months that were never imported', () => {
    const a = analyse(txns(rows), { dateFrom: '2026-01-01', dateTo: '2026-06-05' }, { today: '2026-06-10' });
    const skuA = a.skuRows.find((r) => r.sku === 'A')!;
    expect(skuA.classes).not.toContain('NO_RECENT_SALES');
    expect(skuA.classes).toContain('INSUFFICIENT_DATA');
    expect([...a.coverageHoles.values()].flat()).toMatchObject([{ from: '2026-02-01', to: '2026-05-31' }]);
  });
  it('a stray future-dated row does not make today look covered', () => {
    const withStray = txns([...rows, row({ sku: 'SKU:C', orderItemId: 'F1', date: '2062-01-01' })]);
    const a = analyse(withStray, {}, { today: '2026-06-10' });
    expect(a.coverage!.to).toBe('2026-06-05');
    expect(a.asOfBeyondCoverage).toBe(true);
    expect(a.skuRows.find((r) => r.sku === 'A')!.classes).not.toContain('NO_RECENT_SALES');
  });
});

describe('daily and monthly reports list the whole selected period', () => {
  it('includes days without transactions', () => {
    const t = txns([row({ date: '2026-06-10' }), row({ orderItemId: 'I2', date: '2026-06-12' }), row({ orderItemId: 'I3', date: '2026-05-01' }), row({ orderItemId: 'I4', date: '2026-07-31' })]);
    const a = analyse(t, { dateFrom: '2026-06-01', dateTo: '2026-06-30' }, { today: '2026-08-01' });
    const ctx: ReportContext = { a, batches: [], rejected: [], audit: [], costs: new CostIndex([]), dataSource: 'test' };
    const daily = REPORTS.find((r) => r.id === 'daily-sales')!.build(ctx)[0];
    expect(daily.rows).toHaveLength(30);
    expect(daily.rows[0][0]).toBe('2026-06-01');
    expect(daily.rows[29][0]).toBe('2026-06-30');
    expect(daily.rows.reduce((s, r) => s + (r[1] as number), 0)).toBe(2000);
    expect(REPORTS.find((r) => r.id === 'monthly-sales')!.build(ctx)[0].rows).toHaveLength(1);
  });
});
