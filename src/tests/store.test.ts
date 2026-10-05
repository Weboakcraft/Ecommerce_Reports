/**
 * The application store against the real Code.gs logic (in-memory spreadsheet),
 * with `fetch` routed to it. Covers the data-integrity paths: failed loads,
 * interrupted imports, overlapping imports and deletion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeTotals } from '../analytics/revenue/totals';
import { planImport } from '../analytics/transactions/duplicates';
import { rowToBatch, rowToCost, rowsToSettings } from '../storage/codec';
import type { ImportBatch, Transaction } from '../types';
import { loadBackend } from './appsScriptMock';
import type { FixtureRow } from './fixtures/synthetic';
import { cost, parseRows, row } from './helpers';

const URL = 'https://script.google.com/macros/s/TEST/exec';

function install() {
  const backend = loadBackend();
  backend.api.setup();
  const token = backend.props.get('API_TOKEN')!;
  const mem = new Map<string, string>();
  const state = { offline: false, failAfterAppends: Infinity, appends: 0 };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    if (state.offline) throw new TypeError('Failed to fetch');
    const req = JSON.parse(init.body) as { action: string };
    if (req.action === 'appendTransactions' && ++state.appends > state.failAfterAppends) throw new TypeError('Failed to fetch');
    const res = backend.api.doPost({ postData: { contents: init.body } });
    return { status: 200, text: async () => res.text };
  });
  mem.set('ecom-analytics.sheets-connection', JSON.stringify({ url: URL, token }));
  return { backend, token, state, call: (action: string, payload?: unknown) => backend.call(token, action, payload) };
}

async function freshStore() {
  vi.resetModules();
  const { useStore } = await import('../storage/store');
  return useStore;
}

const many = (n: number, prefix: string, from = 0): FixtureRow[] =>
  Array.from({ length: n }, (_, i) => row({ orderId: `${prefix}${from + i}`, orderItemId: `${prefix}${from + i}`, taxable: 100 }));

function batchFor(id: string, fileName: string, rows: Transaction[], extra: Partial<ImportBatch> = {}): ImportBatch {
  const t = computeTotals(rows, 'separate');
  return {
    batchId: id, platform: 'flipkart', fileName, fileHash: `hash-${fileName}`, importedAt: `2026-10-03T00:00:0${id.length}Z`, importedBy: 'test',
    sourceRows: rows.length, emptyRows: 0, acceptedRows: rows.length, rejectedRows: 0, duplicateInFile: 0, duplicateExisting: 0,
    unmappedEvents: [], dateFrom: '2026-06-10', dateTo: '2026-06-10', grossSalesValue: t.grossSalesValue, returnValue: 0,
    cancellationValue: 0, grossSoldUnits: t.grossSoldUnits, returnedUnits: 0, status: 'active', dependsOn: [], ...extra,
  };
}

beforeEach(() => vi.unstubAllGlobals());

describe('store + Google Sheets backend', () => {
  it('a failed start-up load refuses every save, so the spreadsheet is never overwritten from an empty screen', async () => {
    const env = install();
    env.call('replaceTable', { table: 'ProductCosts', rows: [cost({ id: 'a' }), cost({ id: 'b', sku: 'B' }), cost({ id: 'c', sku: 'C' })].map((c) => [c.id, '', c.sku, 'all', c.effectiveFrom, '', 400, 50, 0, '', 't', '']) });
    env.call('replaceTable', { table: 'Settings', rows: [['cancellationPolicy', '"reversal"'], ['topN', '15']] });

    env.state.offline = true;
    const useStore = await freshStore();
    await useStore.getState().init();
    expect(useStore.getState().loadFailed).toBe(true);
    expect(useStore.getState().costs).toEqual([]);

    env.state.offline = false; // connection is back, but nothing has been loaded
    await expect(useStore.getState().saveCosts([cost({ id: 'd', sku: 'D' })], 'x')).rejects.toThrow(/not been loaded/);
    await expect(useStore.getState().saveSettings({ ...useStore.getState().settings, topN: 3 })).rejects.toThrow(/not been loaded/);
    expect(env.call('bootstrap').data.costs.map(rowToCost).map((c: { id: string }) => c.id)).toEqual(['a', 'b', 'c']);
    expect(rowsToSettings(env.call('bootstrap').data.settings)).toMatchObject({ cancellationPolicy: 'reversal', topN: 15 });

    await useStore.getState().reload();
    expect(useStore.getState().loadFailed).toBe(false);
    expect(useStore.getState().costs).toHaveLength(3);
    expect(useStore.getState().settings.cancellationPolicy).toBe('reversal');
    await useStore.getState().saveCosts([...useStore.getState().costs, cost({ id: 'd', sku: 'D' })], 'x');
    expect(env.call('bootstrap').data.costs).toHaveLength(4);
  });

  it('an interrupted import is marked incomplete, and importing the file again completes it', async () => {
    const env = install();
    const useStore = await freshStore();
    await useStore.getState().init();
    const parsed = parseRows(many(9000, 'A'), { batchId: 'B1', fileName: 'big.xlsx' }).transactions;

    env.state.failAfterAppends = 1; // 4000 rows saved, then the connection drops
    await expect(useStore.getState().commitImport(batchFor('B1', 'big.xlsx', parsed), parsed, [])).rejects.toThrow(/interrupted/);
    let st = useStore.getState();
    expect(st.txns).toHaveLength(4000);
    expect(st.batches).toHaveLength(1);
    expect(st.batches[0].status).toBe('incomplete');
    expect(env.call('bootstrap').data.batches.map(rowToBatch)[0].status).toBe('incomplete');

    // retry: same file, same batch id; only the missing rows are sent
    env.state.failAfterAppends = Infinity;
    const plan = planImport(parsed, new Set(st.txns.map((t) => t.id)));
    expect(plan.toImport).toHaveLength(5000);
    await useStore.getState().commitImport(batchFor('B1', 'big.xlsx', parsed), plan.toImport, []);
    st = useStore.getState();
    expect(st.txns).toHaveLength(9000);
    expect(st.batches).toHaveLength(1);
    expect(st.batches[0]).toMatchObject({ status: 'active', acceptedRows: 9000, grossSalesValue: 900000 });
    const remote = env.call('bootstrap').data;
    expect(remote.transactionCount).toBe(9000);
    expect(remote.batches.map(rowToBatch)).toMatchObject([{ batchId: 'B1', status: 'active', acceptedRows: 9000 }]);
  });

  it('an import that overlaps an earlier one blocks deletion of the earlier one', async () => {
    const env = install();
    const useStore = await freshStore();
    await useStore.getState().init();
    const f1 = parseRows(many(60, 'R'), { batchId: 'B1' }).transactions;
    await useStore.getState().commitImport(batchFor('B1', 'one.xlsx', f1), f1, []);
    const f2 = parseRows(many(60, 'R', 40), { batchId: 'B22' }).transactions; // rows 40-99: 20 overlap
    const plan = planImport(f2, new Set(useStore.getState().txns.map((t) => t.id)));
    expect(plan.toImport).toHaveLength(40);
    await useStore.getState().commitImport(batchFor('B22', 'two.xlsx', plan.toImport, { duplicateExisting: 20, dependsOn: ['B1'] }), plan.toImport, []);

    await expect(useStore.getState().deleteBatch('B1')).rejects.toThrow(/cannot be deleted yet/);
    expect(useStore.getState().txns).toHaveLength(100);
    expect(env.call('ping').data.transactionCount).toBe(100);

    await useStore.getState().deleteBatch('B22');
    await useStore.getState().deleteBatch('B1');
    expect(useStore.getState().txns).toHaveLength(0);
    expect(env.call('ping').data.transactionCount).toBe(0);
    expect(useStore.getState().batches.map((b) => b.status)).toEqual(['deleted', 'deleted']);
  });

  it('reloading returns exactly what was saved', async () => {
    const env = install();
    let useStore = await freshStore();
    await useStore.getState().init();
    const rows = parseRows([row(), row({ orderItemId: 'I2', event: 'Return', qty: -1, taxable: -1000, date: '2026-06-15', state: 'Jammu & Kashmir' }), row({ orderItemId: 'I3', event: 'Return Cancellation' })], { batchId: 'B1' });
    await useStore.getState().commitImport(batchFor('B1', 'f.xlsx', rows.transactions), rows.transactions, []);
    const before = useStore.getState().txns;
    useStore = await freshStore();
    await useStore.getState().init();
    expect(useStore.getState().txns).toEqual(before);
    expect(useStore.getState().mode).toBe('sheets');
    expect(env.call('bootstrap').data.audit.length).toBeGreaterThan(0);
  });
});

describe('share link', () => {
  it('a browser with no saved connection opens a share link and sees the spreadsheet data', async () => {
    const env = install();
    env.call('replaceTable', { table: 'ProductCosts', rows: [[ 'a', '', 'A', 'all', '2026-01-01', '', 400, 50, 0, '', 't', '' ]] });
    const { buildShareLink } = await import('../storage/sheetsClient');
    const link = buildShareLink({ url: URL, token: env.token }, 'https://example.github.io/Ecommerce_Reports/');
    expect(link).not.toContain(env.token); // token is encoded, not in plain text
    localStorage.removeItem('ecom-analytics.sheets-connection'); // a different user's browser

    const hash = link.slice(link.indexOf('#'));
    const loc = { hash, pathname: '/Ecommerce_Reports/', search: '' };
    vi.stubGlobal('window', {
      location: loc,
      history: { replaceState: (_s: unknown, _t: string, u: string) => { loc.hash = u.slice(u.indexOf('#')); } },
    });

    const useStore = await freshStore();
    await useStore.getState().init();
    const st = useStore.getState();
    expect(st.mode).toBe('sheets');
    expect(st.loadFailed).toBe(false);
    expect(st.costs).toHaveLength(1);
    expect(loc.hash).toBe('#/overview'); // token removed from the address bar
    expect(JSON.parse(localStorage.getItem('ecom-analytics.sheets-connection')!)).toEqual({ url: URL, token: env.token });
  });

  it('a malformed share link is ignored', async () => {
    install();
    localStorage.removeItem('ecom-analytics.sheets-connection');
    vi.stubGlobal('window', { location: { hash: '#/overview?connect=@@bad', pathname: '/', search: '' }, history: { replaceState: () => undefined } });
    const useStore = await freshStore();
    await useStore.getState().init();
    expect(useStore.getState().mode).toBe('local');
  });
});
