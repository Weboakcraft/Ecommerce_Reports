import { ADAPTERS, openSource } from '../adapters';
import type { ParseResult } from '../adapters';
import { DEFAULT_EVENT_MAPPINGS, DEFAULT_SETTINGS } from '../schemas/defaults';
import type { EventMapping, ProductCost, Settings, Transaction } from '../types';
import { toWorkbookBuffer, type FixtureRow } from './fixtures/synthetic';

export const S: Settings = { ...DEFAULT_SETTINGS };

export function parseRows(
  rows: FixtureRow[],
  opts: { settings?: Partial<Settings>; mappings?: EventMapping[]; fileName?: string; batchId?: string } = {},
): ParseResult {
  const buf = toWorkbookBuffer(rows);
  const src = openSource(buf, opts.fileName ?? 'test.xlsx');
  return ADAPTERS.flipkart.parse(src, {
    settings: { ...S, ...opts.settings },
    mappings: opts.mappings ?? DEFAULT_EVENT_MAPPINGS,
    fileName: opts.fileName ?? 'test.xlsx',
    batchId: opts.batchId ?? 'batch1',
  });
}

export const txns = (rows: FixtureRow[], opts: Parameters<typeof parseRows>[1] = {}): Transaction[] =>
  parseRows(rows, opts).transactions;

export const row = (o: Partial<FixtureRow> = {}): FixtureRow => ({
  orderId: 'OD1', orderItemId: 'I1', sku: 'SKU:A-1', event: 'Sale', qty: 1, taxable: 1000, date: '2026-06-10', state: 'Delhi', ...o,
});

export const cost = (o: Partial<ProductCost> = {}): ProductCost => ({
  id: 'c' + Math.random(), canonicalProductId: '', sku: 'A-1', platform: 'all', effectiveFrom: '2026-01-01', effectiveTo: '',
  unitCost: 400, packagingCost: 50, otherCost: 0, notes: '', updatedBy: 't', updatedAt: '', ...o,
});
