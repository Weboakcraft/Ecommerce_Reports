import { create } from 'zustand';
import { reclassify } from '../analytics/transactions/classify';
import { DEFAULT_EVENT_MAPPINGS, DEFAULT_SETTINGS, EMPTY_FILTERS } from '../schemas/defaults';
import type {
  AuditEntry, EventMapping, Expense, Filters, ImportBatch, ProductCost, RejectedRow, Settings, SkuAlias, Transaction,
} from '../types';
import { normalizeState } from '../utils/states';
import {
  aliasToRow, auditToRow, batchToRow, costToRow, expenseToRow, mappingToRow, rejectedToRow, rowsToSettings,
  rowToAlias, rowToAudit, rowToBatch, rowToCost, rowToExpense, rowToMapping, rowToRejected, rowToTxn,
  settingsToRows, txnToRow,
} from './codec';
import { idbDel, idbGet, idbSet } from './localDb';
import { loadConnection, saveConnection, SheetsClient, type SheetsConnection } from './sheetsClient';

const LOCAL_KEY = 'local-state';
const CACHE_KEY = 'sheets-cache';
const FILTER_KEY = 'ecom-analytics.filters';
const THEME_KEY = 'ecom-analytics.theme';
const CHUNK = 4000;
const PAGE = 20000;

interface Persisted {
  txns: Transaction[];
  batches: ImportBatch[];
  rejected: RejectedRow[];
  mappings: EventMapping[];
  costs: ProductCost[];
  expenses: Expense[];
  aliases: SkuAlias[];
  settings: Settings;
  audit: AuditEntry[];
}

interface SheetsCache {
  url: string;
  dataVersion: number;
  transactionCount: number;
  txns: Transaction[];
}

export interface Busy {
  label: string;
  /** 0..1, or null for indeterminate. */
  progress: number | null;
}

export interface AppState extends Persisted {
  status: 'loading' | 'ready';
  mode: 'local' | 'sheets';
  connection: SheetsConnection | null;
  spreadsheetName: string;
  busy: Busy | null;
  error: string | null;
  notice: string | null;
  localSaveFailed: boolean;
  /**
   * True when the last attempt to load from Google Sheets failed. The screen then
   * shows nothing, and every save is refused: saving from an empty screen would
   * overwrite the spreadsheet's real contents.
   */
  loadFailed: boolean;
  draft: Filters;
  applied: Filters;
  theme: 'light' | 'dark';

  init(): Promise<void>;
  reload(): Promise<void>;
  connect(conn: SheetsConnection, uploadLocal: boolean): Promise<void>;
  disconnect(): Promise<void>;
  commitImport(batch: ImportBatch, txns: Transaction[], rejected: RejectedRow[]): Promise<void>;
  deleteBatch(batchId: string): Promise<void>;
  saveMappings(mappings: EventMapping[]): Promise<void>;
  saveCosts(costs: ProductCost[], auditDetail: string): Promise<void>;
  saveExpenses(expenses: Expense[], auditDetail: string): Promise<void>;
  saveAliases(aliases: SkuAlias[]): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  clearLocalData(): Promise<void>;
  setDraft(patch: Partial<Filters>): void;
  applyFilters(patch?: Partial<Filters>): void;
  clearFilters(): void;
  dismissError(): void;
  dismissNotice(): void;
  toggleTheme(): void;
}

function loadFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (raw) return { ...EMPTY_FILTERS, ...(JSON.parse(raw) as Filters) };
  } catch {
    /* ignore */
  }
  return EMPTY_FILTERS;
}

function loadTheme(): 'light' | 'dark' {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* ignore */
  }
  return 'light';
}

const EMPTY: Persisted = {
  txns: [], batches: [], rejected: [], mappings: DEFAULT_EVENT_MAPPINGS, costs: [], expenses: [], aliases: [],
  settings: DEFAULT_SETTINGS, audit: [],
};

/** State names are derived from the raw value + approved aliases, so re-derive after loading or an alias change. */
function renormaliseStates(txns: Transaction[], settings: Settings): Transaction[] {
  const cache = new Map<string, string>();
  let changed = false;
  const out = txns.map((t) => {
    let st = cache.get(t.rawState);
    if (st === undefined) {
      st = normalizeState(t.rawState, settings.stateAliases).state;
      cache.set(t.rawState, st);
    }
    if (st === t.state) return t;
    changed = true;
    return { ...t, state: st };
  });
  return changed ? out : txns;
}

export const useStore = create<AppState>((set, get) => {
  const client = () => {
    const c = get().connection;
    return c ? new SheetsClient(c) : null;
  };

  const persistLocal = async () => {
    const s = get();
    if (s.mode !== 'local') return;
    const data: Persisted = {
      txns: s.txns, batches: s.batches, rejected: s.rejected, mappings: s.mappings, costs: s.costs,
      expenses: s.expenses, aliases: s.aliases, settings: s.settings, audit: s.audit.slice(-500),
    };
    const ok = await idbSet(LOCAL_KEY, data);
    if (!ok) set({ localSaveFailed: true });
  };

  const saveCache = async (dataVersion: number | undefined) => {
    const s = get();
    if (!s.connection) return;
    if (typeof dataVersion !== 'number' || !Number.isFinite(dataVersion)) {
      await idbDel(CACHE_KEY); // unknown version: drop the cache so the next visit re-downloads
      return;
    }
    const cache: SheetsCache = { url: s.connection.url, dataVersion, transactionCount: s.txns.length, txns: s.txns };
    await idbSet(CACHE_KEY, cache);
  };

  const audit = async (action: string, detail: string) => {
    const s = get();
    const entry: AuditEntry = { at: new Date().toISOString(), user: s.settings.userName || 'unknown', action, detail };
    set({ audit: [...s.audit, entry] });
    const c = client();
    if (c) {
      try {
        await c.appendAudit([auditToRow(entry)]);
      } catch {
        /* the action itself succeeded; a failed audit write is surfaced on next load */
      }
    } else await persistLocal();
  };

  /** Run a write. In Sheets mode the remote write must succeed before local state changes. */
  const guarded = async (label: string, fn: () => Promise<void>, opts: { allowWhenNotLoaded?: boolean } = {}) => {
    if (get().loadFailed && !opts.allowWhenNotLoaded) {
      const message = 'Nothing was saved. Your data has not been loaded from Google Sheets yet, so saving now could overwrite it. Reload first (button at the top right).';
      set({ error: message });
      throw new Error(message);
    }
    set({ busy: { label, progress: null }, error: null });
    try {
      await fn();
    } catch (e) {
      set({ error: (e as Error).message || String(e) });
      throw e;
    } finally {
      set({ busy: null });
    }
  };

  const loadLocal = async () => {
    const data = (await idbGet<Persisted>(LOCAL_KEY)) ?? EMPTY;
    const settings = { ...DEFAULT_SETTINGS, ...data.settings };
    const mappings = data.mappings?.length ? data.mappings : DEFAULT_EVENT_MAPPINGS;
    const batches = (data.batches ?? []).map((b) => ({ ...b, dependsOn: b.dependsOn ?? [] }));
    set({
      ...EMPTY, ...data, batches, settings, mappings,
      txns: renormaliseStates(reclassify(data.txns ?? [], mappings), settings),
      mode: 'local', connection: null, spreadsheetName: '', status: 'ready', loadFailed: false,
    });
  };

  const loadSheets = async (conn: SheetsConnection) => {
    const c = new SheetsClient(conn);
    set({ busy: { label: 'Data Loading', progress: null } });
    const boot = await c.bootstrap();
    let mappings = boot.mappings.map(rowToMapping);
    if (!mappings.length) {
      mappings = DEFAULT_EVENT_MAPPINGS.map((m) => ({ ...m, updatedAt: new Date().toISOString() }));
      await c.replaceTable('EventMappings', mappings.map(mappingToRow));
    }
    const settings = rowsToSettings(boot.settings);
    if (!boot.settings.length) await c.replaceTable('Settings', settingsToRows(settings));

    let txns: Transaction[] | null = null;
    const cache = await idbGet<SheetsCache>(CACHE_KEY);
    if (cache && cache.url === conn.url && cache.dataVersion === boot.dataVersion && cache.transactionCount === boot.transactionCount) {
      txns = cache.txns;
    }
    let dataVersion = boot.dataVersion;
    if (!txns) {
      txns = [];
      let total = boot.transactionCount;
      for (let offset = 0; offset < total; offset += PAGE) {
        set({ busy: { label: `Data Loading (${txns.length.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')})`, progress: total ? offset / total : null } });
        const page = await c.getTransactions(offset, PAGE);
        total = page.total;
        dataVersion = page.dataVersion;
        for (const r of page.rows) txns.push(rowToTxn(r));
      }
    }
    set({
      mode: 'sheets', connection: conn, spreadsheetName: boot.spreadsheetName, status: 'ready', loadFailed: false,
      txns: renormaliseStates(reclassify(txns, mappings), settings),
      batches: boot.batches.map(rowToBatch),
      rejected: boot.rejected.map(rowToRejected),
      mappings,
      costs: boot.costs.map(rowToCost),
      expenses: boot.expenses.map(rowToExpense),
      aliases: boot.aliases.map(rowToAlias),
      settings,
      audit: boot.audit.map(rowToAudit),
      busy: null,
    });
    await saveCache(dataVersion);
  };

  const appendRemote = async (c: SheetsClient, txns: Transaction[], label: string): Promise<number | undefined> => {
    let version: number | undefined;
    for (let i = 0; i < txns.length; i += CHUNK) {
      set({ busy: { label: `${label} (${Math.min(i + CHUNK, txns.length).toLocaleString('en-IN')} of ${txns.length.toLocaleString('en-IN')} rows)`, progress: i / txns.length } });
      const res = await c.appendTransactions(txns.slice(i, i + CHUNK).map(txnToRow));
      version = res.dataVersion;
    }
    return version;
  };

  return {
    ...EMPTY,
    status: 'loading',
    mode: 'local',
    connection: null,
    spreadsheetName: '',
    busy: null,
    error: null,
    notice: null,
    localSaveFailed: false,
    loadFailed: false,
    draft: loadFilters(),
    applied: loadFilters(),
    theme: loadTheme(),

    async init() {
      const conn = loadConnection();
      if (!conn) {
        await loadLocal();
        return;
      }
      try {
        await loadSheets(conn);
      } catch (e) {
        set({
          ...EMPTY, status: 'ready', mode: 'sheets', connection: conn, busy: null, loadFailed: true,
          error: `Could not load data from Google Sheets: ${(e as Error).message}`,
        });
      }
    },

    async reload() {
      const conn = get().connection;
      set({ error: null });
      if (!conn) return loadLocal();
      try {
        await idbDel(CACHE_KEY);
        await loadSheets(conn);
      } catch (e) {
        set({ ...EMPTY, busy: null, loadFailed: true, error: `Could not load data from Google Sheets: ${(e as Error).message}` });
      }
    },

    async connect(conn, uploadLocal) {
      await guarded('Connecting to Google Sheets', async () => {
        const c = new SheetsClient(conn);
        const boot = await c.bootstrap();
        const local = get();
        if (uploadLocal && local.mode === 'local') {
          for (const b of local.batches) await c.upsertBatch(batchToRow(b));
          if (local.txns.length) await appendRemote(c, local.txns, 'Uploading browser data to Google Sheets');
          for (const b of local.batches) {
            const rej = local.rejected.filter((r) => r.batchId === b.batchId);
            if (rej.length) await c.setRejected(b.batchId, rej.map(rejectedToRow));
          }
          // Configuration tables: the spreadsheet wins if it already has content.
          if (!boot.mappings.length) await c.replaceTable('EventMappings', local.mappings.map(mappingToRow));
          if (!boot.costs.length && local.costs.length) await c.replaceTable('ProductCosts', local.costs.map(costToRow));
          if (!boot.expenses.length && local.expenses.length) await c.replaceTable('Expenses', local.expenses.map(expenseToRow));
          if (!boot.aliases.length && local.aliases.length) await c.replaceTable('SkuAliases', local.aliases.map(aliasToRow));
          if (!boot.settings.length) await c.replaceTable('Settings', settingsToRows(local.settings));
          if (local.audit.length) await c.appendAudit(local.audit.slice(-500).map(auditToRow));
          await c.reclassify();
          await idbDel(LOCAL_KEY);
        }
        // Check on Google's own servers that awkward values survive a round trip unchanged.
        let fidelity = '';
        try {
          const test = await c.selfTest();
          if (!test.ok) {
            fidelity = `The spreadsheet did not return these test values unchanged: ${test.results.filter((r) => !r.ok).map((r) => `${JSON.stringify(r.wrote)} came back as ${JSON.stringify(r.read)}`).join('; ')}. Values of that shape (SKUs, order ids) may be altered when stored — please report this before relying on the data.`;
          }
        } catch (e) {
          fidelity = `The storage self-test could not run (${(e as Error).message}). Make sure the latest Code.gs is deployed.`;
        }
        saveConnection(conn);
        await idbDel(CACHE_KEY);
        await loadSheets(conn);
        if (fidelity) set({ error: fidelity });
      }, { allowWhenNotLoaded: true });
      await audit('CONNECT_SHEETS', `Connected to spreadsheet "${get().spreadsheetName}"`);
    },

    async disconnect() {
      saveConnection(null);
      await idbDel(CACHE_KEY);
      await loadLocal();
      set({ notice: 'Disconnected from Google Sheets. The spreadsheet keeps all its data; this browser now uses local storage.' });
    },

    async commitImport(batch, txns, rejected) {
      const merge = (st: AppState, final: ImportBatch) => ({
        txns: [...st.txns, ...txns],
        batches: [...st.batches.filter((b) => b.batchId !== final.batchId), final],
        rejected: [...st.rejected.filter((r) => r.batchId !== final.batchId), ...rejected],
      });
      await guarded('Saving import', async () => {
        const c = client();
        if (c) {
          try {
            // The batch is first recorded as INCOMPLETE and only marked active once every
            // row is stored, so an interrupted import can never pass for a finished one.
            await c.upsertBatch(batchToRow({ ...batch, status: 'incomplete' }));
            const version = await appendRemote(c, txns, 'Saving to Google Sheets');
            await c.setRejected(batch.batchId, rejected.map(rejectedToRow));
            await c.upsertBatch(batchToRow(batch));
            set((st) => merge(st, batch));
            await saveCache(version);
          } catch (e) {
            await get().reload();
            throw new Error(
              `The import was interrupted before every row was saved (${(e as Error).message}). ` +
                'It is marked “Incomplete” in Import History. Import the same file again to finish it — rows already saved are skipped — or delete it.',
            );
          }
        } else {
          set((st) => merge(st, batch));
          await persistLocal();
        }
      });
      await audit('IMPORT', `${batch.fileName}: ${txns.length} rows stored, ${rejected.length} rejected, batch ${batch.batchId}`);
    },

    async deleteBatch(batchId) {
      const b = get().batches.find((x) => x.batchId === batchId);
      // Rows that a later file also contained were stored once, under this batch. Deleting
      // it would silently take them away from the later import, so that is refused.
      const dependants = get().batches.filter((x) => x.status !== 'deleted' && x.batchId !== batchId && x.dependsOn.includes(batchId));
      if (dependants.length) {
        const message = `This import cannot be deleted yet: ${dependants.map((x) => `“${x.fileName}”`).join(', ')} overlap${dependants.length === 1 ? 's' : ''} with it, and the shared rows are stored under this import. Delete ${dependants.length === 1 ? 'that import' : 'those imports'} first, then this one, and import the later file(s) again.`;
        set({ error: message });
        throw new Error(message);
      }
      await guarded('Deleting import batch', async () => {
        const c = client();
        let version: number | undefined;
        if (c) version = (await c.deleteBatch(batchId)).dataVersion;
        set((s) => ({
          txns: s.txns.filter((t) => t.batchId !== batchId),
          rejected: s.rejected.filter((r) => r.batchId !== batchId),
          batches: s.batches.map((x) => (x.batchId === batchId ? { ...x, status: 'deleted' as const } : x)),
        }));
        if (c) await saveCache(version);
        else await persistLocal();
      });
      await audit('DELETE_BATCH', `${b?.fileName ?? ''} batch ${batchId} deleted`);
    },

    async saveMappings(mappings) {
      await guarded('Saving transaction mapping', async () => {
        const c = client();
        let version: number | undefined;
        if (c) {
          await c.replaceTable('EventMappings', mappings.map(mappingToRow));
          version = (await c.reclassify()).dataVersion;
        }
        set((s) => ({ mappings, txns: reclassify(s.txns, mappings) }));
        if (c) await saveCache(version);
        else await persistLocal();
      });
      await audit('SAVE_MAPPINGS', mappings.map((m) => `${m.platform}:${m.eventValue}→${m.txnType}`).join('; '));
    },

    async saveCosts(costs, auditDetail) {
      await guarded('Saving product costs', async () => {
        const c = client();
        if (c) await c.replaceTable('ProductCosts', costs.map(costToRow));
        set({ costs });
        if (!c) await persistLocal();
      });
      await audit('SAVE_COSTS', auditDetail);
    },

    async saveExpenses(expenses, auditDetail) {
      await guarded('Saving expenses', async () => {
        const c = client();
        if (c) await c.replaceTable('Expenses', expenses.map(expenseToRow));
        set({ expenses });
        if (!c) await persistLocal();
      });
      await audit('SAVE_EXPENSES', auditDetail);
    },

    async saveAliases(aliases) {
      await guarded('Saving SKU mapping', async () => {
        const c = client();
        if (c) await c.replaceTable('SkuAliases', aliases.map(aliasToRow));
        set({ aliases });
        if (!c) await persistLocal();
      });
      await audit('SAVE_SKU_ALIASES', `${aliases.length} alias(es)`);
    },

    async saveSettings(settings) {
      const before = get().settings;
      await guarded('Saving settings', async () => {
        const c = client();
        if (c) await c.replaceTable('Settings', settingsToRows(settings));
        const aliasesChanged = JSON.stringify(before.stateAliases) !== JSON.stringify(settings.stateAliases);
        let txns = get().txns;
        let version: number | undefined;
        if (aliasesChanged) {
          txns = renormaliseStates(txns, settings);
          if (c) {
            const map: Record<string, string> = {};
            for (const t of txns) map[t.rawState] = t.state;
            version = (await c.remapStates(map)).dataVersion;
          }
        }
        set({ settings, txns });
        if (c) {
          if (aliasesChanged) await saveCache(version);
        } else await persistLocal();
      });
      const changed = (Object.keys(settings) as (keyof Settings)[]).filter(
        (k) => JSON.stringify(settings[k]) !== JSON.stringify(before[k]),
      );
      if (changed.length) {
        await audit('SAVE_SETTINGS', changed.map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(settings[k])}`).join('; '));
      }
    },

    async clearLocalData() {
      await idbDel(LOCAL_KEY);
      await idbDel(CACHE_KEY);
      if (get().mode === 'local') await loadLocal();
      set({ notice: 'Data stored in this browser was deleted.' });
    },

    setDraft(patch) {
      set((s) => ({ draft: { ...s.draft, ...patch } }));
    },

    applyFilters(patch) {
      set((s) => {
        const next = { ...s.draft, ...(patch ?? {}) };
        try {
          sessionStorage.setItem(FILTER_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return { draft: next, applied: next };
      });
    },

    clearFilters() {
      try {
        sessionStorage.removeItem(FILTER_KEY);
      } catch {
        /* ignore */
      }
      set({ draft: EMPTY_FILTERS, applied: EMPTY_FILTERS });
    },

    dismissError: () => set({ error: null }),
    dismissNotice: () => set({ notice: null }),

    toggleTheme() {
      const theme = get().theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* ignore */
      }
      set({ theme });
    },
  };
});
