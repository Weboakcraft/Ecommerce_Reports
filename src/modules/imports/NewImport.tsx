import { CheckCircle2, Download, FileUp, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ADAPTERS, type ParseResult } from '../../adapters';
import { buildCohort } from '../../analytics/returns/cohort';
import { reportingQty, reportingValue } from '../../analytics/quantities';
import { computeTotals } from '../../analytics/revenue/totals';
import { reclassify, summarizeEvents } from '../../analytics/transactions/classify';
import { DEFAULT_IMPORT_OPTIONS, planImport, type ImportOptions } from '../../analytics/transactions/duplicates';
import { go } from '../../app/router';
import { Badge, Button, cx, Notice, Panel, ProgressBar, Tabs } from '../../components/ui';
import { download } from '../../reports/export';
import { FLIPKART_COLUMNS } from '../../schemas/flipkart';
import { useStore } from '../../storage/store';
import {
  PLATFORM_LABEL, PLATFORMS, TXN_TYPE_LABEL, type EventMapping, type ImportBatch, type Platform, type RejectedRow,
  type RowWarning, type Transaction, type TxnType,
} from '../../types';
import { fmtDate } from '../../utils/dates';
import { fmtDateTime, fmtINR, fmtINR2, fmtInt, fmtPct } from '../../utils/format';
import { newId } from '../../utils/hash';
import { safeCell } from '../../utils/sanitize';
import type { ImportMessage, ImportRequest } from '../../workers/import.worker';
import Papa from 'papaparse';

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing'; label: string; progress: number | null }
  | { kind: 'review' }
  | { kind: 'done'; batch: ImportBatch };

interface Parsed {
  result: ParseResult;
  fileHash: string;
  fileName: string;
  batchId: string;
  platform: Platform;
}

const WARNING_TITLE: Record<RowWarning['code'], string> = {
  BLANK_SKU: 'Blank SKU', BLANK_ORDER_ID: 'Blank Order ID', BLANK_ORDER_ITEM_ID: 'Blank Order Item ID',
  BLANK_EVENT: 'Blank Event Sub Type', BLANK_STATE: 'Blank state', NON_INTEGER_QTY: 'Quantity is not a whole number',
  UNEXPECTED_NEGATIVE: 'Unexpected negative value', UNMAPPED_STATE: 'Unrecognised state', AMBIGUOUS_DATE: 'Ambiguous date',
  ID_PRECISION: 'ID stored as a very large number', SKU_FORMAT: 'SKU still contains quotes or an inner "SKU:"',
};

export function rejectedCsv(rows: RejectedRow[], warnings: RowWarning[] = []): string {
  const out: (string | number)[][] = [
    ['Source File', 'Source Row', 'Result', 'Reasons', 'Order ID', 'Order Item ID', 'SKU', 'Event Sub Type', 'Item Quantity', 'Taxable Value', 'Buyer Invoice Date', "Customer's Billing State"],
  ];
  const cell = (v: string | undefined) => safeCell(v ?? '');
  for (const r of rows) {
    out.push([cell(r.sourceFile), r.sourceRow, 'REJECTED', cell(r.reasons.join('; ')), cell(r.raw['Order ID']), cell(r.raw['Order Item ID']), cell(r.raw.SKU), cell(r.raw['Event Sub Type']), cell(r.raw['Item Quantity']), cell(r.raw['Taxable Value']), cell(r.raw['Buyer Invoice Date']), cell(r.raw["Customer's Billing State"])]);
  }
  for (const w of warnings) out.push(['', w.sourceRow, 'WARNING (row imported)', cell(w.message)]);
  return '﻿' + Papa.unparse(out);
}

export default function NewImport() {
  const store = useStore();
  const [platform, setPlatform] = useState<Platform>('flipkart');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mappings, setMappings] = useState<EventMapping[]>(store.mappings);
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [tab, setTab] = useState<'preview' | 'mapping' | 'warnings' | 'rejected' | 'duplicates'>('preview');
  const [previewType, setPreviewType] = useState<TxnType | 'ALL'>('ALL');
  const [drag, setDrag] = useState(false);
  const worker = useRef<Worker | null>(null);
  const committing = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const reset = () => {
    worker.current?.terminate();
    worker.current = null;
    setParsed(null);
    setError('');
    setStage({ kind: 'idle' });
    setMappings(store.mappings);
    setOptions(DEFAULT_IMPORT_OPTIONS);
    setTab('preview');
    if (input.current) input.current.value = '';
  };

  const start = async (file: File) => {
    if (stage.kind === 'parsing') return; // one import at a time
    setError('');
    if (!ADAPTERS[platform].implemented) return;
    const limit = store.settings.maxFileSizeMb;
    if (file.size > limit * 1024 * 1024) {
      setError(`This file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${limit} MB (change it in Settings).`);
      return;
    }
    if (file.size === 0) {
      setError('The file is empty (0 bytes).');
      return;
    }
    setStage({ kind: 'parsing', label: 'Reading file', progress: null });
    const buffer = await file.arrayBuffer();
    worker.current?.terminate();
    const w = new Worker(new URL('../../workers/import.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const batchId = newId('batch');
    w.onmessage = (ev: MessageEvent<ImportMessage>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        setStage({ kind: 'parsing', label: m.total ? `${m.stage} (${fmtInt(m.done)} of ${fmtInt(m.total)})` : m.stage, progress: m.total ? m.done / m.total : null });
      } else if (m.type === 'error') {
        setError(m.message);
        setStage({ kind: 'idle' });
        w.terminate();
      } else if (m.type === 'done') {
        // An earlier import of this same file that was interrupted is resumed under its original batch id.
        const resume = useStore.getState().batches.find((b) => b.status === 'incomplete' && b.fileHash === m.fileHash);
        const id = resume?.batchId ?? batchId;
        if (resume) {
          for (const t of m.result.transactions) t.batchId = id;
          for (const r of m.result.rejected) r.batchId = id;
        }
        setParsed({ result: m.result, fileHash: m.fileHash, fileName: file.name, batchId: id, platform });
        setMappings(store.mappings);
        setStage({ kind: 'review' });
        w.terminate();
      }
    };
    w.onerror = (e) => {
      setError(`The file could not be processed: ${e.message || 'unknown error'}`);
      setStage({ kind: 'idle' });
    };
    const req: ImportRequest = { buffer, fileName: file.name, platform, settings: store.settings, mappings: store.mappings, batchId };
    w.postMessage(req, [buffer]);
  };

  /* ---------- derived review data ---------- */
  const txns = useMemo(() => (parsed ? reclassify(parsed.result.transactions, mappings) : []), [parsed, mappings]);
  const existingIds = useMemo(() => new Set(store.txns.map((t) => t.id)), [store.txns]);
  const plan = useMemo(() => planImport(txns, existingIds, options), [txns, existingIds, options]);
  const events = useMemo(() => summarizeEvents(txns), [txns]);
  // Rows of this batch that are already stored (only when resuming an interrupted import).
  const alreadyInBatch = useMemo(() => (parsed ? store.txns.filter((t) => t.batchId === parsed.batchId) : []), [store.txns, parsed]);
  const resuming = parsed ? store.batches.some((b) => b.batchId === parsed.batchId && b.status === 'incomplete') : false;
  const totals = useMemo(
    () => computeTotals([...alreadyInBatch, ...plan.toImport], store.settings.cancellationPolicy),
    [alreadyInBatch, plan, store.settings.cancellationPolicy],
  );
  // Skipped rows that live under OTHER batches: this import overlaps with those files.
  const overlap = useMemo(() => {
    const batchOf = new Map(store.txns.map((t) => [t.id, t.batchId]));
    const ids = new Set<string>();
    let rows = 0;
    for (const t of plan.duplicateExisting) {
      const owner = batchOf.get(t.id);
      if (owner && owner !== parsed?.batchId && options.existingDuplicates === 'skip') {
        ids.add(owner);
        rows++;
      }
    }
    return { batchIds: [...ids], rows };
  }, [store.txns, plan, parsed, options.existingDuplicates]);
  const linkage = useMemo(() => buildCohort([...store.txns, ...plan.toImport], null, 0).stats, [store.txns, plan]);
  const warningGroups = useMemo(() => {
    const map = new Map<RowWarning['code'], RowWarning[]>();
    for (const w of parsed?.result.warnings ?? []) {
      const list = map.get(w.code);
      if (list) list.push(w);
      else map.set(w.code, [w]);
    }
    return [...map];
  }, [parsed]);

  const sameFile = parsed ? store.batches.find((b) => b.status === 'active' && b.fileHash === parsed.fileHash) : undefined;
  // Same file, yet some rows no longer match what is stored: a setting that changes how rows are
  // read (day/month order, timezone, header rows) was changed since. Importing would double-count.
  const readsDifferently = !!sameFile && options.existingDuplicates === 'skip' && options.inFileDuplicates === 'keep_all' && plan.toImport.length > 0;
  const canImport = !readsDifferently && (plan.toImport.length > 0 || resuming);
  const mappingChanged = JSON.stringify(mappings) !== JSON.stringify(store.mappings);
  const unmapped = events.filter((e) => e.txnType === 'UNMAPPED');

  const setEventType = (eventValue: string, type: TxnType) => {
    if (!parsed) return;
    const key = (m: EventMapping) => m.platform === parsed.platform && m.eventValue.trim().toLowerCase() === eventValue.trim().toLowerCase();
    const rest = mappings.filter((m) => !key(m));
    setMappings(type === 'UNMAPPED' ? rest : [...rest, { platform: parsed.platform, eventValue, txnType: type, source: 'user', updatedAt: new Date().toISOString() }]);
  };

  const commit = async () => {
    if (!parsed || committing.current) return; // guards against a double click starting two imports
    committing.current = true;
    try {
      if (mappingChanged) await store.saveMappings(mappings);
      const batchRows = [...alreadyInBatch, ...plan.toImport];
      let from = '';
      let to = '';
      for (const t of batchRows) {
        if (!from || t.txnDate < from) from = t.txnDate;
        if (!to || t.txnDate > to) to = t.txnDate;
      }
      const batch: ImportBatch = {
        batchId: parsed.batchId, platform: parsed.platform, fileName: parsed.fileName, fileHash: parsed.fileHash,
        importedAt: new Date().toISOString(), importedBy: store.settings.userName || 'unknown',
        sourceRows: parsed.result.sourceRows, emptyRows: parsed.result.emptyRows, acceptedRows: batchRows.length,
        rejectedRows: parsed.result.rejected.length, duplicateInFile: plan.duplicateInFile.length,
        duplicateExisting: overlap.rows, unmappedEvents: unmapped.map((e) => e.eventValue),
        dateFrom: from, dateTo: to, grossSalesValue: totals.grossSalesValue, returnValue: totals.returnValue,
        cancellationValue: totals.cancellationValue, grossSoldUnits: totals.grossSoldUnits, returnedUnits: totals.returnedUnits,
        status: 'active', dependsOn: overlap.batchIds,
      };
      await store.commitImport(batch, plan.toImport, parsed.result.rejected);
      setStage({ kind: 'done', batch });
    } catch {
      /* the store shows the error banner */
    } finally {
      committing.current = false;
    }
  };

  /* ---------- render ---------- */
  if (stage.kind === 'done' && parsed) {
    const b = stage.batch;
    const rows: [string, string][] = [
      ['File name', b.fileName], ['Marketplace', PLATFORM_LABEL[b.platform]],
      ['Imported', fmtDateTime(b.importedAt, store.settings.reportingTimezone)],
      ['Total source rows', fmtInt(b.sourceRows)], ['Accepted rows', fmtInt(b.acceptedRows)], ['Rejected rows', fmtInt(b.rejectedRows)],
      ['Rows blank in all selected columns', fmtInt(b.emptyRows)],
      ['Unmapped event types', b.unmappedEvents.length ? b.unmappedEvents.join(', ') : 'None'],
      ['Duplicate candidates in file', fmtInt(b.duplicateInFile)], ['Already stored by an earlier import (skipped)', fmtInt(b.duplicateExisting)],
      ['Total sales value', fmtINR2(b.grossSalesValue)], ['Total return value', fmtINR2(b.returnValue)],
      ['Total cancellation value', fmtINR2(b.cancellationValue)], ['Gross sold units', fmtInt(b.grossSoldUnits)], ['Returned units', fmtInt(b.returnedUnits)],
      ['Transaction dates', b.dateFrom ? `${fmtDate(b.dateFrom)} – ${fmtDate(b.dateTo)}` : '—'],
    ];
    return (
      <Panel title={<span className="flex items-center gap-1.5"><CheckCircle2 size={16} className="text-good" /> Import complete</span>}
        subtitle={store.mode === 'sheets' ? `Saved to Google Sheets (${store.spreadsheetName}).` : 'Saved in this browser only. Connect Google Sheets in Settings to store it in your spreadsheet.'}>
        <dl className="grid gap-x-8 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-line py-1.5 text-[0.8125rem]"><dt className="text-ink-2">{k}</dt><dd className="num text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => go('overview')}>View dashboard</Button>
          <Button onClick={reset}>Import another file</Button>
          {(parsed.result.rejected.length > 0 || parsed.result.warnings.length > 0) && (
            <Button onClick={() => download(new Blob([rejectedCsv(parsed.result.rejected, parsed.result.warnings)], { type: 'text/csv' }), `validation-report_${parsed.fileName}.csv`)}>
              <Download size={14} /> Download validation report
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  if (stage.kind === 'review' && parsed) {
    const r = parsed.result;
    const previewRows = (previewType === 'ALL' ? txns : txns.filter((t) => t.txnType === previewType)).slice(0, 200);
    const tile = (label: string, value: string, tone?: 'warn' | 'bad') => (
      <div className="bg-surface px-3 py-2.5">
        <p className="text-xs text-ink-2">{label}</p>
        <p className={cx('num text-lg font-semibold leading-6', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</p>
      </div>
    );
    return (
      <div className="space-y-3">
        <Panel title={`Review: ${parsed.fileName}`} subtitle={`${PLATFORM_LABEL[parsed.platform]}${r.sheetName ? ` · sheet “${r.sheetName}”` : ' · CSV'} · nothing is saved until you confirm`}
          actions={<Button variant="ghost" onClick={reset}>Cancel</Button>} flush>
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
            {tile('Source rows', fmtInt(r.sourceRows))}
            {tile('Valid rows', fmtInt(r.transactions.length))}
            {tile('Rejected rows', fmtInt(r.rejected.length), r.rejected.length ? 'bad' : undefined)}
            {tile('Blank rows', fmtInt(r.emptyRows))}
            {tile('Duplicate candidates', fmtInt(plan.duplicateInFile.length), plan.duplicateInFile.length ? 'warn' : undefined)}
            {tile('Already imported', fmtInt(plan.duplicateExisting.length), plan.duplicateExisting.length ? 'warn' : undefined)}
          </div>
          <p className="num px-3.5 py-2 text-xs text-ink-2">
            {fmtInt(r.sourceRows)} source rows = {fmtInt(r.transactions.length)} valid + {fmtInt(r.rejected.length)} rejected + {fmtInt(r.emptyRows)} blank in all eight selected columns.
            To be imported: <strong className="font-semibold text-ink">{fmtInt(plan.toImport.length)}</strong>{plan.skipped.length > 0 && ` (${fmtInt(plan.skipped.length)} skipped as duplicates)`}.
          </p>
        </Panel>

        {resuming && (
          <Notice tone="accent"><strong className="font-medium">Resuming an interrupted import.</strong> {fmtInt(alreadyInBatch.length)} rows of this file were saved before the interruption; the remaining {fmtInt(plan.toImport.length)} will be added and the import marked complete.</Notice>
        )}
        {sameFile && !readsDifferently && (
          <Notice tone="warn"><strong className="font-medium">This exact file was already imported</strong> on {fmtDateTime(sameFile.importedAt, store.settings.reportingTimezone)}. Rows already stored are skipped, so importing again adds nothing unless you choose otherwise under Duplicates.</Notice>
        )}
        {readsDifferently && (
          <Notice tone="bad"><strong className="font-medium">This exact file was already imported, but {fmtInt(plan.toImport.length)} of its rows now read differently.</strong> A setting that affects how rows are read (day/month order, reporting timezone or header rows) has changed since {fmtDateTime(sameFile!.importedAt, store.settings.reportingTimezone)}. Importing now would count those transactions twice. Delete the earlier import in Import History first, then import this file again.</Notice>
        )}
        {overlap.rows > 0 && !sameFile && (
          <Notice><strong className="font-medium">{fmtInt(overlap.rows)} row(s) are already stored from an earlier file</strong> and will not be stored again. That earlier import cannot be deleted while this one exists, because the shared rows live under it.</Notice>
        )}
        {unmapped.length > 0 && (
          <Notice tone="warn"><strong className="font-medium">{unmapped.length} event type(s) are unmapped:</strong> {unmapped.map((e) => `“${e.eventValue}” (${fmtInt(e.rows)} rows)`).join(', ')}. You can import now and map them later; until then those rows are left out of every figure.</Notice>
        )}

        <Panel flush>
          <div className="px-3.5 pt-2">
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'preview', label: 'Extracted data' }, { value: 'mapping', label: 'Event mapping', count: unmapped.length },
              { value: 'warnings', label: 'Warnings', count: r.warnings.length + r.statesForReview.length },
              { value: 'rejected', label: 'Rejected rows', count: r.rejected.length },
              { value: 'duplicates', label: 'Duplicates', count: plan.duplicateInFile.length + plan.duplicateExisting.length },
            ]} />
          </div>

          {tab === 'preview' && (
            <div className="space-y-3 p-3.5">
              <div>
                <h3 className="mb-1 text-xs font-semibold">Columns read (by position — all other columns are ignored)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead><tr><th className="th">Column</th><th className="th">Used as</th><th className="th">Header text found in the file</th></tr></thead>
                    <tbody>
                      {FLIPKART_COLUMNS.map((c) => (
                        <tr key={c.key}><td className="td num font-medium">{c.letter} ({c.column})</td><td className="td">{c.label}</td><td className="td text-ink-2">{r.headers[c.key] || <span className="text-ink-3">(no header row)</span>}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-ink-3">Header text is shown only so you can check the right columns were picked up. If a header looks wrong, the report layout differs from the expected one — cancel and check the file.</p>
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold">Source value → value used for reporting (first {previewRows.length} rows)</h3>
                  <select aria-label="Show transaction type" className="field h-7 w-40 text-xs" value={previewType} onChange={(e) => setPreviewType(e.target.value as TxnType | 'ALL')}>
                    <option value="ALL">All types</option>
                    {(['SALE', 'RETURN', 'CANCELLATION', 'EXCLUDE', 'UNMAPPED'] as TxnType[]).map((t) => <option key={t} value={t}>{TXN_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div className="max-h-80 overflow-auto border border-line">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>{['Row', 'Order ID', 'Order Item ID', 'SKU (source → normalised)', 'Event → type', 'Qty (source → reported)', 'Taxable value (source → reported)', 'Date (source → reporting date)', 'State (source → normalised)'].map((h) => <th key={h} className="th sticky top-0">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {previewRows.map((t) => (
                        <tr key={`${t.sourceRow}`}>
                          <td className="td num text-ink-3">{t.sourceRow}</td>
                          <td className="td">{t.orderId || '—'}</td>
                          <td className="td">{t.orderItemId || '—'}</td>
                          <td className="td"><span className="text-ink-3">{t.rawSku || '(blank)'} →</span> <span className="font-medium">{t.sku}</span></td>
                          <td className="td"><span className="text-ink-3">{t.eventSubType} →</span> <Badge tone={t.txnType === 'UNMAPPED' ? 'warn' : t.txnType === 'SALE' ? 'accent' : 'neutral'}>{TXN_TYPE_LABEL[t.txnType]}</Badge></td>
                          <td className="td num"><span className="text-ink-3">{t.rawQty} →</span> {t.txnType === 'UNMAPPED' || t.txnType === 'EXCLUDE' ? 'not counted' : reportingQty(t)}</td>
                          <td className="td num"><span className="text-ink-3">{t.rawTaxable} →</span> {t.txnType === 'UNMAPPED' || t.txnType === 'EXCLUDE' ? 'not counted' : fmtINR2(reportingValue(t))}</td>
                          <td className="td num"><span className="text-ink-3">{t.rawDate} →</span> {t.txnDate}</td>
                          <td className="td"><span className="text-ink-3">{t.rawState.trim() || '(blank)'} →</span> {t.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-ink-3">Returns and cancellations are reported as positive amounts whatever sign the source uses; the source value is stored unchanged. Sales keep their sign.</p>
              </div>
            </div>
          )}

          {tab === 'mapping' && (
            <div className="space-y-3 p-3.5">
              <Notice>
                Event Sub Type decides whether a row is a sale, a return or a cancellation. The built-in defaults (Sale, Return, Cancellation) were written without access to a real Flipkart file, so check them against the counts and signs below before importing. A value is never classified from words it contains. Your choices are saved and applied to future uploads.
              </Notice>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr>{['Event Sub Type in file', 'Rows', 'Σ source quantity', 'Σ source taxable value', 'Rows with negative qty', 'Rows with negative value', 'Treat as'].map((h, i) => <th key={h} className={cx('th', i > 0 && i < 6 && 'text-right')}>{h}</th>)}</tr></thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.eventValue}>
                        <td className="td font-medium">{e.eventValue}</td>
                        <td className="td num text-right">{fmtInt(e.rows)}</td>
                        <td className="td num text-right">{fmtInt(e.rawQty)}</td>
                        <td className="td num text-right">{fmtINR2(e.rawTaxable)}</td>
                        <td className="td num text-right">{fmtInt(e.negativeQtyRows)}</td>
                        <td className="td num text-right">{fmtInt(e.negativeValueRows)}</td>
                        <td className="td">
                          <select aria-label={`Treat ${e.eventValue} as`} className={cx('field h-7 w-40 text-xs', e.txnType === 'UNMAPPED' && 'border-warn')} value={e.txnType} onChange={(ev) => setEventType(e.eventValue, ev.target.value as TxnType)}>
                            <option value="UNMAPPED">Unmapped (not counted)</option>
                            <option value="SALE">Sale</option>
                            <option value="RETURN">Return</option>
                            <option value="CANCELLATION">Cancellation</option>
                            <option value="EXCLUDE">Exclude</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {linkage.cancellationRows > 0 && (
                <Notice tone={store.settings.cancellationPolicy === 'separate' && (linkage.cancellationLinkagePct ?? 0) >= 50 ? 'warn' : 'neutral'}>
                  <strong className="font-medium">Cancellation check:</strong> {fmtInt(linkage.cancellationLinkedRows)} of {fmtInt(linkage.cancellationRows)} cancellation rows ({fmtPct(linkage.cancellationLinkagePct)}) share an Order Item ID with a Sale row.
                  {' '}When most do, the cancelled orders are also inside Gross Sales, and Net Sales is overstated unless cancellations are subtracted.
                  {' '}Current policy: <strong className="font-medium">{store.settings.cancellationPolicy === 'reversal' ? 'subtract cancellations from Net Sales (reversal)' : 'report cancellations separately, do not subtract'}</strong>. Change it in Settings → Accounting policy; it can be changed at any time without re-importing.
                </Notice>
              )}
            </div>
          )}

          {tab === 'warnings' && (
            <div className="space-y-3 p-3.5">
              {warningGroups.length === 0 && r.statesForReview.length === 0 && <p className="text-xs text-ink-2">No warnings. Rows with warnings are still imported; warnings never change a source value.</p>}
              {warningGroups.map(([code, list]) => (
                <div key={code}>
                  <p className="text-[0.8125rem] font-medium">{WARNING_TITLE[code]} <Badge tone="warn">{fmtInt(list.length)}</Badge></p>
                  <p className="text-xs text-ink-2">{list[0].message}. Rows: {list.slice(0, 15).map((w) => w.sourceRow).join(', ')}{list.length > 15 && ` and ${fmtInt(list.length - 15)} more (see the validation report)`}.</p>
                </div>
              ))}
              {r.statesForReview.length > 0 && (
                <div>
                  <p className="text-[0.8125rem] font-medium">State names needing review <Badge tone="warn">{r.statesForReview.length}</Badge></p>
                  <p className="text-xs text-ink-2">Kept as written, not merged into any state: {r.statesForReview.map((s) => `“${s.raw}” (${fmtInt(s.rows)})`).join(', ')}. Add aliases in Settings if these are known variants.</p>
                </div>
              )}
            </div>
          )}

          {tab === 'rejected' && (
            <div className="p-3.5">
              {r.rejected.length === 0 ? <p className="text-xs text-ink-2">No rows were rejected.</p> : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-ink-2">These rows have an invalid or missing date, quantity or amount and will not be imported. Nothing is guessed or defaulted.</p>
                    <Button size="sm" onClick={() => download(new Blob([rejectedCsv(r.rejected, r.warnings)], { type: 'text/csv' }), `validation-report_${parsed.fileName}.csv`)}><Download size={13} /> Download validation report</Button>
                  </div>
                  <div className="max-h-72 overflow-auto border border-line">
                    <table className="w-full border-collapse">
                      <thead><tr>{['Row', 'Reason', 'Order Item ID', 'SKU', 'Quantity', 'Taxable value', 'Date'].map((h) => <th key={h} className="th sticky top-0">{h}</th>)}</tr></thead>
                      <tbody>
                        {r.rejected.slice(0, 300).map((x) => (
                          <tr key={x.sourceRow}>
                            <td className="td num">{x.sourceRow}</td><td className="td whitespace-normal text-bad">{x.reasons.join('; ')}</td><td className="td">{x.raw['Order Item ID']}</td>
                            <td className="td">{x.raw.SKU}</td><td className="td">{x.raw['Item Quantity'] || '(blank)'}</td><td className="td">{x.raw['Taxable Value'] || '(blank)'}</td><td className="td">{x.raw['Buyer Invoice Date'] || '(blank)'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'duplicates' && (
            <div className="space-y-3 p-3.5 text-[0.8125rem]">
              <p className="text-xs leading-relaxed text-ink-2">Two rows are duplicate candidates only when Order ID, Order Item ID, event, date, SKU, quantity and taxable value are all identical. Rows that merely share an Order ID or SKU are never treated as duplicates.</p>
              <fieldset>
                <legend className="font-medium">Identical rows inside this file: {fmtInt(plan.duplicateInFile.length)}</legend>
                <label className="mt-1 flex items-center gap-2"><input type="radio" name="infile" checked={options.inFileDuplicates === 'keep_all'} onChange={() => setOptions({ ...options, inFileDuplicates: 'keep_all' })} /> Keep every row and flag the repeats for review (default)</label>
                <label className="mt-1 flex items-center gap-2"><input type="radio" name="infile" checked={options.inFileDuplicates === 'keep_first'} onChange={() => setOptions({ ...options, inFileDuplicates: 'keep_first' })} /> Import only the first of each identical group</label>
              </fieldset>
              <fieldset>
                <legend className="font-medium">Rows already imported from an earlier file: {fmtInt(plan.duplicateExisting.length)}</legend>
                <label className="mt-1 flex items-center gap-2"><input type="radio" name="existing" checked={options.existingDuplicates === 'skip'} onChange={() => setOptions({ ...options, existingDuplicates: 'skip' })} /> Skip them, so nothing is counted twice (default)</label>
                <label className="mt-1 flex items-center gap-2"><input type="radio" name="existing" checked={options.existingDuplicates === 'import_anyway'} onChange={() => setOptions({ ...options, existingDuplicates: 'import_anyway' })} /> Import them again as separate records (only if they are genuinely different transactions)</label>
              </fieldset>
              {[...plan.duplicateInFile, ...plan.duplicateExisting].length > 0 && (
                <div className="max-h-60 overflow-auto border border-line">
                  <table className="w-full border-collapse">
                    <thead><tr>{['Row', 'Kind', 'Order Item ID', 'SKU', 'Event', 'Date', 'Qty', 'Value'].map((h) => <th key={h} className="th sticky top-0">{h}</th>)}</tr></thead>
                    <tbody>
                      {([...plan.duplicateInFile.map((t) => [t, 'Repeat in file'] as [Transaction, string]), ...plan.duplicateExisting.filter((t) => t.occurrence === 1).map((t) => [t, 'Already imported'] as [Transaction, string])]).slice(0, 300).map(([t, kind]) => (
                        <tr key={`${kind}${t.sourceRow}`}><td className="td num">{t.sourceRow}</td><td className="td">{kind}</td><td className="td">{t.orderItemId}</td><td className="td">{t.sku}</td><td className="td">{t.eventSubType}</td><td className="td num">{t.txnDate}</td><td className="td num">{t.rawQty}</td><td className="td num">{t.rawTaxable}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="num text-xs text-ink-2">
              Will add <strong className="font-semibold text-ink">{fmtInt(plan.toImport.length)}</strong> transactions: sales {fmtINR(totals.grossSalesValue)} ({fmtInt(totals.grossSoldUnits)} units), returns {fmtINR(totals.returnValue)} ({fmtInt(totals.returnedUnits)} units), cancellations {fmtINR(totals.cancellationValue)}.
              {mappingChanged && ' The event mapping will be saved and applied to existing data as well.'}
            </div>
            <div className="flex gap-2">
              <Button onClick={reset}>Cancel</Button>
              <Button variant="primary" disabled={!canImport || !!store.busy} onClick={() => void commit()}>
                {readsDifferently ? 'Import blocked' : plan.toImport.length === 0 ? (resuming ? 'Mark import complete' : 'Nothing new to import') : `Import ${fmtInt(plan.toImport.length)} rows`}
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const adapter = ADAPTERS[platform];
  return (
    <div className="space-y-3">
      {error && <Notice tone="bad" onDismiss={() => setError('')}><strong className="font-medium">The file was not imported.</strong> {error}</Notice>}
      <Panel title="Import a marketplace report">
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <div>
            <p className="label">Marketplace</p>
            <div className="space-y-1">
              {PLATFORMS.map((p) => (
                <label key={p} className={cx('flex cursor-pointer items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-sm', platform === p ? 'border-accent bg-accent-soft' : 'border-line hover:bg-sunken')}>
                  <span className="flex items-center gap-2"><input type="radio" name="platform" checked={platform === p} onChange={() => setPlatform(p)} /> {PLATFORM_LABEL[p]}</span>
                  {!ADAPTERS[p].implemented && <Badge>Awaiting sample</Badge>}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs leading-relaxed text-ink-2">{adapter.formatDescription}</p>
            {adapter.implemented ? (
              stage.kind === 'parsing' ? (
                <div className="rounded border border-line p-6">
                  <p className="mb-2 text-sm font-medium">{stage.label}…</p>
                  <ProgressBar value={stage.progress} />
                  <p className="mt-2 text-xs text-ink-3">The file is processed on this device. It is not uploaded anywhere.</p>
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void start(f); }}
                  className={cx('flex flex-col items-center justify-center rounded border-2 border-dashed px-4 py-10 text-center', drag ? 'border-accent bg-accent-soft' : 'border-line-strong')}
                >
                  <UploadCloud size={28} className="text-ink-3" />
                  <p className="mt-2 text-sm font-medium">Drop the report here</p>
                  <p className="text-xs text-ink-2">.xlsx, .xls or .csv, up to {store.settings.maxFileSizeMb} MB</p>
                  <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(f); }} />
                  <Button variant="primary" className="mt-3" onClick={() => input.current?.click()}><FileUp size={14} /> Choose file</Button>
                </div>
              )
            ) : (
              <Notice>{PLATFORM_LABEL[platform]} import is not available yet. Its adapter will be built from a real {PLATFORM_LABEL[platform]} report, so that its columns, event names and return handling are verified rather than assumed.</Notice>
            )}
          </div>
        </div>
      </Panel>
      {store.mode === 'local' && (
        <Notice tone="warn">Imports are currently saved in this browser only and are lost if site data is cleared. <a href="#/settings" className="font-medium underline">Connect your Google Spreadsheet</a> to save them there.</Notice>
      )}
    </div>
  );
}
