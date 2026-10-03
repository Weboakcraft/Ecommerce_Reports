import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_MAPPINGS, DEFAULT_SETTINGS } from '../schemas/defaults';
import {
  batchToRow, costToRow, mappingToRow, rejectedToRow, rowsToSettings, rowToBatch, rowToCost, rowToRejected,
  rowToTxn, settingsToRows, txnToRow,
} from '../storage/codec';
import type { ImportBatch } from '../types';
import { loadBackend } from './appsScriptMock';
import { cost, parseRows, row } from './helpers';

function ready() {
  const b = loadBackend();
  b.api.setup();
  const token = b.props.get('API_TOKEN')!;
  return { ...b, token, call: (action: string, payload?: unknown) => b.call(token, action, payload) };
}

const batch = (id: string): ImportBatch => ({
  batchId: id, platform: 'flipkart', fileName: 'f.xlsx', fileHash: 'h', importedAt: '2026-10-03T00:00:00Z', importedBy: 'me',
  sourceRows: 3, emptyRows: 0, acceptedRows: 3, rejectedRows: 0, duplicateInFile: 0, duplicateExisting: 0,
  unmappedEvents: ['Return Cancellation'], dateFrom: '2026-06-10', dateTo: '2026-06-12', grossSalesValue: 2000,
  returnValue: 1000, cancellationValue: 0, grossSoldUnits: 2, returnedUnits: 1, status: 'active', dependsOn: ['Z9'],
});

describe('Google Sheets backend (Apps Script logic against a mock)', () => {
  it('refuses requests without the right token', () => {
    const b = loadBackend();
    expect(b.call('x', 'ping').error).toMatch(/not set up/);
    b.api.setup();
    expect(b.call('wrong', 'ping')).toMatchObject({ ok: false, error: 'Invalid access token.' });
    expect(b.call(b.props.get('API_TOKEN')!, 'ping').ok).toBe(true);
    expect(JSON.parse(b.api.doGet().text).data.spreadsheetName).toBeUndefined();
  });

  it('creates every data sheet with headers', () => {
    const b = ready();
    expect([...b.sheets.keys()].sort()).toEqual(
      ['AuditLog', 'EventMappings', 'Expenses', 'ImportBatches', 'ProductCosts', 'RejectedRows', 'Settings', 'SkuAliases', 'Transactions'],
    );
    expect(b.sheets.get('Transactions')!.cells[0]).toHaveLength(18);
  });

  it('round-trips transactions exactly and skips ids already stored', () => {
    const b = ready();
    const txns = parseRows([
      row({ sku: 'SKU:=1+1', orderId: '+123', taxable: 1234.56 }),
      row({ orderItemId: 'I2', event: 'Return', qty: -1, taxable: -1000, date: '2026-06-12', state: 'Goa' }),
    ]).transactions;
    const r1 = b.call('appendTransactions', { rows: txns.map(txnToRow) });
    expect(r1.data).toMatchObject({ appended: 2, skipped: 0, transactionCount: 2 });
    const r2 = b.call('appendTransactions', { rows: txns.map(txnToRow) });
    expect(r2.data).toMatchObject({ appended: 0, skipped: 2, transactionCount: 2 });
    const page = b.call('getTransactions', { offset: 0, limit: 100 }).data;
    const back = page.rows.map(rowToTxn);
    expect(back).toEqual(txns);
    expect(back[0].sku).toBe('=1+1'); // stored as text, never evaluated
    expect(back[1].rawQty).toBe(-1);
  });

  it('pages transactions', () => {
    const b = ready();
    const rows = [];
    for (let i = 0; i < 25; i++) rows.push(row({ orderId: `O${i}`, orderItemId: `I${i}` }));
    b.call('appendTransactions', { rows: parseRows(rows).transactions.map(txnToRow) });
    const p1 = b.call('getTransactions', { offset: 0, limit: 10 }).data;
    const p3 = b.call('getTransactions', { offset: 20, limit: 10 }).data;
    expect(p1.rows).toHaveLength(10);
    expect(p3.rows).toHaveLength(5);
    expect(p3.total).toBe(25);
    expect(b.call('getTransactions', { offset: 30, limit: 10 }).data.rows).toHaveLength(0);
  });

  it('deletes a batch without touching other batches and keeps the batch record', () => {
    const b = ready();
    const a = parseRows([row(), row({ orderItemId: 'I2' })], { batchId: 'A' }).transactions;
    const c = parseRows([row({ orderItemId: 'I3' })], { batchId: 'B' }).transactions;
    b.call('upsertBatch', { row: batchToRow(batch('A')) });
    b.call('upsertBatch', { row: batchToRow(batch('B')) });
    b.call('appendTransactions', { rows: [...a, ...c].map(txnToRow) });
    b.call('setRejected', { batchId: 'A', rows: [rejectedToRow({ batchId: 'A', sourceFile: 'f', sourceRow: 9, reasons: ['bad date', 'bad qty'], raw: { SKU: 'x' } })] });
    const v0 = b.call('ping').data.dataVersion;
    expect(b.call('deleteBatch', { batchId: 'A' }).data.removed).toBe(2);
    const left = b.call('getTransactions', { offset: 0, limit: 100 }).data.rows.map(rowToTxn);
    expect(left.map((t: { batchId: string }) => t.batchId)).toEqual(['B']);
    const boot = b.call('bootstrap').data;
    expect(boot.batches.map(rowToBatch).map((x: ImportBatch) => [x.batchId, x.status])).toEqual([['A', 'deleted'], ['B', 'active']]);
    expect(boot.batches.map(rowToBatch)[0].unmappedEvents).toEqual(['Return Cancellation']);
    expect(boot.batches.map(rowToBatch)[0].dependsOn).toEqual(['Z9']);
    expect(boot.rejected).toHaveLength(0);
    expect(boot.dataVersion).toBeGreaterThan(v0);
    // a deleted batch can be imported again
    expect(b.call('appendTransactions', { rows: a.map(txnToRow) }).data.appended).toBe(2);
  });

  it('upserts a batch in place', () => {
    const b = ready();
    b.call('upsertBatch', { row: batchToRow(batch('A')) });
    expect(b.call('upsertBatch', { row: batchToRow({ ...batch('A'), acceptedRows: 99 }) }).data.updated).toBe(true);
    const rows = b.call('bootstrap').data.batches.map(rowToBatch);
    expect(rows).toHaveLength(1);
    expect(rows[0].acceptedRows).toBe(99);
  });

  it('replaces configuration tables and reclassifies stored transactions', () => {
    const b = ready();
    const txns = parseRows([row(), row({ orderItemId: 'I2', event: 'Return Cancellation' })]).transactions;
    b.call('appendTransactions', { rows: txns.map(txnToRow) });
    b.call('replaceTable', { table: 'EventMappings', rows: DEFAULT_EVENT_MAPPINGS.map(mappingToRow) });
    expect(b.call('reclassify').data.changed).toBe(0);
    const maps = [...DEFAULT_EVENT_MAPPINGS, { platform: 'flipkart' as const, eventValue: 'return cancellation', txnType: 'EXCLUDE' as const, source: 'user' as const, updatedAt: '' }];
    b.call('replaceTable', { table: 'EventMappings', rows: maps.map(mappingToRow) });
    expect(b.call('reclassify').data.changed).toBe(1);
    const back = b.call('getTransactions', { offset: 0, limit: 10 }).data.rows.map(rowToTxn);
    expect(back.map((t: { txnType: string }) => t.txnType)).toEqual(['SALE', 'EXCLUDE']);

    const costs = [cost({ id: 'c1', notes: '@note' }), cost({ id: 'c2', sku: 'B-2', unitCost: 12.5 })];
    b.call('replaceTable', { table: 'ProductCosts', rows: costs.map(costToRow) });
    b.call('replaceTable', { table: 'ProductCosts', rows: [costs[1]].map(costToRow) });
    expect(b.call('bootstrap').data.costs.map(rowToCost)).toEqual([costs[1]]);
    expect(b.call('replaceTable', { table: 'Transactions', rows: [] }).ok).toBe(false);
    expect(b.call('replaceTable', { table: 'ProductCosts', rows: [['too', 'short']] }).ok).toBe(false);
  });

  it('round-trips settings and rejected rows', () => {
    const b = ready();
    const st = { ...DEFAULT_SETTINGS, cancellationPolicy: 'reversal' as const, topN: 15, stateAliases: { 'BANGALORE REGION': 'Karnataka' } };
    b.call('replaceTable', { table: 'Settings', rows: settingsToRows(st) });
    expect(rowsToSettings(b.call('bootstrap').data.settings)).toEqual(st);
    const rej = { batchId: 'A', sourceFile: 'f.xlsx', sourceRow: 7, reasons: ['Buyer Invoice Date (AT): blank date'], raw: { SKU: 'SKU:X', 'Item Quantity': 'two' } };
    b.call('setRejected', { batchId: 'A', rows: [rejectedToRow(rej)] });
    // retrying an import replaces a batch's rejected rows instead of duplicating them
    b.call('setRejected', { batchId: 'A', rows: [rejectedToRow(rej)] });
    b.call('setRejected', { batchId: 'B', rows: [rejectedToRow({ ...rej, batchId: 'B' })] });
    expect(b.call('bootstrap').data.rejected.map(rowToRejected)).toEqual([rej, { ...rej, batchId: 'B' }]);
    expect(b.call('setRejected', { batchId: 'A', rows: [rejectedToRow({ ...rej, batchId: 'B' })] }).ok).toBe(false);
  });

  it('remaps stored state names after an alias is approved', () => {
    const b = ready();
    const txns = parseRows([row({ state: 'Bangalore Region' }), row({ orderItemId: 'I2', state: 'Delhi' })]).transactions;
    b.call('appendTransactions', { rows: txns.map(txnToRow) });
    expect(b.call('remapStates', { map: { 'Bangalore Region': 'Karnataka', Delhi: 'Delhi' } }).data.changed).toBe(1);
    const back = b.call('getTransactions', { offset: 0, limit: 10 }).data.rows.map(rowToTxn);
    expect(back.map((t: { state: string }) => t.state)).toEqual(['Karnataka', 'Delhi']);
  });

  it('keeps awkward text exactly: leading apostrophes, zeros, exponents, long ids', () => {
    const b = ready();
    const txns = parseRows([
      row({ sku: "'Q-1'", orderId: '0012', orderItemId: '12345678901234567890' }),
      row({ sku: 'SKU:1e5', orderId: '+91-99', orderItemId: 'I2', state: '@home' }),
    ]).transactions;
    b.call('appendTransactions', { rows: txns.map(txnToRow) });
    const back = b.call('getTransactions', { offset: 0, limit: 10 }).data.rows.map(rowToTxn);
    expect(back).toEqual(txns);
    expect(back[0]).toMatchObject({ sku: "'Q-1'", orderId: '0012', orderItemId: '12345678901234567890' });
    expect(back[1].sku).toBe('1e5');
    // and it survives the rewrite that deleting another batch performs
    const other = parseRows([row({ orderItemId: 'X1' })], { batchId: 'OTHER' }).transactions;
    b.call('appendTransactions', { rows: other.map(txnToRow) });
    b.call('deleteBatch', { batchId: 'OTHER' });
    expect(b.call('getTransactions', { offset: 0, limit: 10 }).data.rows.map(rowToTxn)).toEqual(txns);
  });

  it('the storage self-test passes and leaves no sheet behind', () => {
    const b = ready();
    const res = b.call('selfTest');
    expect(res.ok).toBe(true);
    expect(res.data.results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
    expect(res.data.ok).toBe(true);
    expect(b.sheets.has('_SelfTest')).toBe(false);
  });

  it('a rejected write never empties a table', () => {
    const b = ready();
    const costs = [cost({ id: 'c1' }), cost({ id: 'c2', sku: 'B-2' }), cost({ id: 'c3', sku: 'C-3' })];
    b.call('replaceTable', { table: 'ProductCosts', rows: costs.map(costToRow) });
    const tooLong = cost({ id: 'c4', notes: 'x'.repeat(60000) });
    const res = b.call('replaceTable', { table: 'ProductCosts', rows: [tooLong].map(costToRow) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at most/);
    expect(b.call('bootstrap').data.costs.map(rowToCost)).toEqual(costs);
    // shrinking a table clears the tail
    b.call('replaceTable', { table: 'ProductCosts', rows: [costs[2]].map(costToRow) });
    expect(b.call('bootstrap').data.costs.map(rowToCost)).toEqual([costs[2]]);
    b.call('replaceTable', { table: 'ProductCosts', rows: [] });
    expect(b.call('bootstrap').data.costs).toEqual([]);
  });

  it('reclassify and remapStates report a data version even on an empty sheet', () => {
    const b = ready();
    expect(typeof b.call('reclassify').data.dataVersion).toBe('number');
    expect(typeof b.call('remapStates', { map: {} }).data.dataVersion).toBe('number');
  });

  it('rotating the token locks out the old one', () => {
    const b = ready();
    b.api.rotateToken();
    expect(b.call('ping').ok).toBe(false);
    expect(b.call('unknownAction').ok).toBe(false);
  });
});
