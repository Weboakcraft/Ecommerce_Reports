/**
 * Row codecs between the app's typed records and the spreadsheet's column
 * order. The column order here must match TABLES in apps-script/Code.gs.
 */
import { fingerprintOf } from '../analytics/transactions/duplicates';
import { DEFAULT_SETTINGS } from '../schemas/defaults';
import type {
  AuditEntry, EventMapping, Expense, ImportBatch, Platform, ProductCost, RejectedRow, Settings, SkuAlias,
  Transaction, TxnType,
} from '../types';

type Cell = string | number;
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown): number => (v === '' || v === null || v === undefined ? 0 : Number(v));

export const txnToRow = (t: Transaction): Cell[] => [
  t.id, t.platform, t.txnDate, t.rawDate, t.orderId, t.orderItemId, t.sku, t.rawSku, t.eventSubType, t.txnType,
  t.rawQty, t.rawTaxable, t.state, t.rawState, t.batchId, t.sourceFile, t.sourceRow, t.occurrence,
];

export function rowToTxn(r: unknown[]): Transaction {
  const t: Transaction = {
    id: s(r[0]), platform: s(r[1]) as Platform, txnDate: s(r[2]), rawDate: s(r[3]), orderId: s(r[4]),
    orderItemId: s(r[5]), sku: s(r[6]), rawSku: s(r[7]), eventSubType: s(r[8]), txnType: s(r[9]) as TxnType,
    rawQty: n(r[10]), rawTaxable: n(r[11]), state: s(r[12]), rawState: s(r[13]), batchId: s(r[14]),
    sourceFile: s(r[15]), sourceRow: n(r[16]), occurrence: n(r[17]) || 1, fingerprint: '',
  };
  t.fingerprint = fingerprintOf(t);
  return t;
}

export const batchToRow = (b: ImportBatch): Cell[] => [
  b.batchId, b.platform, b.fileName, b.fileHash, b.importedAt, b.importedBy, b.sourceRows, b.emptyRows,
  b.acceptedRows, b.rejectedRows, b.duplicateInFile, b.duplicateExisting, JSON.stringify(b.unmappedEvents),
  b.dateFrom, b.dateTo, b.grossSalesValue, b.returnValue, b.cancellationValue, b.grossSoldUnits, b.returnedUnits,
  b.status, JSON.stringify(b.dependsOn ?? []),
];

function parseJson<T>(text: unknown, fallback: T): T {
  try {
    const v = JSON.parse(s(text));
    return v === null || v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export const rowToBatch = (r: unknown[]): ImportBatch => ({
  batchId: s(r[0]), platform: s(r[1]) as Platform, fileName: s(r[2]), fileHash: s(r[3]), importedAt: s(r[4]),
  importedBy: s(r[5]), sourceRows: n(r[6]), emptyRows: n(r[7]), acceptedRows: n(r[8]), rejectedRows: n(r[9]),
  duplicateInFile: n(r[10]), duplicateExisting: n(r[11]), unmappedEvents: parseJson<string[]>(r[12], []),
  dateFrom: s(r[13]), dateTo: s(r[14]), grossSalesValue: n(r[15]), returnValue: n(r[16]),
  cancellationValue: n(r[17]), grossSoldUnits: n(r[18]), returnedUnits: n(r[19]),
  status: s(r[20]) === 'deleted' ? 'deleted' : s(r[20]) === 'incomplete' ? 'incomplete' : 'active',
  dependsOn: parseJson<string[]>(r[21], []),
});

/** Long free text is shortened for storage: a spreadsheet cell holds at most 50,000 characters. */
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters not stored]` : text);

export const rejectedToRow = (x: RejectedRow): Cell[] => [
  x.batchId, x.sourceFile, x.sourceRow, clip(x.reasons.join(' | '), 2000),
  JSON.stringify(Object.fromEntries(Object.entries(x.raw).map(([k, v]) => [k, clip(v, 300)]))),
];
export const rowToRejected = (r: unknown[]): RejectedRow => ({
  batchId: s(r[0]), sourceFile: s(r[1]), sourceRow: n(r[2]), reasons: s(r[3]).split(' | ').filter(Boolean),
  raw: parseJson<Record<string, string>>(r[4], {}),
});

export const mappingToRow = (m: EventMapping): Cell[] => [m.platform, m.eventValue, m.txnType, m.source, m.updatedAt];
export const rowToMapping = (r: unknown[]): EventMapping => ({
  platform: s(r[0]) as Platform, eventValue: s(r[1]), txnType: s(r[2]) as EventMapping['txnType'],
  source: s(r[3]) === 'user' ? 'user' : 'default', updatedAt: s(r[4]),
});

export const costToRow = (c: ProductCost): Cell[] => [
  c.id, c.canonicalProductId, c.sku, c.platform, c.effectiveFrom, c.effectiveTo, c.unitCost, c.packagingCost,
  c.otherCost, c.notes, c.updatedBy, c.updatedAt,
];
export const rowToCost = (r: unknown[]): ProductCost => ({
  id: s(r[0]), canonicalProductId: s(r[1]), sku: s(r[2]), platform: s(r[3]) as ProductCost['platform'],
  effectiveFrom: s(r[4]), effectiveTo: s(r[5]), unitCost: n(r[6]), packagingCost: n(r[7]), otherCost: n(r[8]),
  notes: s(r[9]), updatedBy: s(r[10]), updatedAt: s(r[11]),
});

export const expenseToRow = (e: Expense): Cell[] => [
  e.id, e.platform, e.sku, e.type, e.periodFrom, e.periodTo, e.amount, e.notes, e.updatedBy, e.updatedAt,
];
export const rowToExpense = (r: unknown[]): Expense => ({
  id: s(r[0]), platform: s(r[1]) as Expense['platform'], sku: s(r[2]), type: s(r[3]) as Expense['type'],
  periodFrom: s(r[4]), periodTo: s(r[5]), amount: n(r[6]), notes: s(r[7]), updatedBy: s(r[8]), updatedAt: s(r[9]),
});

export const aliasToRow = (a: SkuAlias): Cell[] => [a.platform, a.platformSku, a.canonicalProductId];
export const rowToAlias = (r: unknown[]): SkuAlias => ({
  platform: s(r[0]) as Platform, platformSku: s(r[1]), canonicalProductId: s(r[2]),
});

export const auditToRow = (a: AuditEntry): Cell[] => [a.at, a.user, a.action, clip(a.detail, 8000)];
export const rowToAudit = (r: unknown[]): AuditEntry => ({ at: s(r[0]), user: s(r[1]), action: s(r[2]), detail: s(r[3]) });

export const settingsToRows = (st: Settings): Cell[][] =>
  Object.entries(st).map(([k, v]) => [k, JSON.stringify(v)]);

/** Unknown keys are ignored and missing keys fall back to defaults, so old sheets keep working. */
export function rowsToSettings(rows: unknown[][]): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const k = s(r[0]);
    if (!(k in DEFAULT_SETTINGS)) continue;
    const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k];
    const v = parseJson<unknown>(r[1], def);
    if (typeof v === typeof def) out[k] = v;
  }
  return out as unknown as Settings;
}
