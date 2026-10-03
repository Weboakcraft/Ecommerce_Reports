import { CheckCircle2, Download, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { reconcile, runQualityChecks } from '../../analytics/quality';
import { countActiveFilters } from '../../analytics/transactions/filters';
import type { Analytics } from '../../app/analytics';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { VirtualTable, type VColumn } from '../../components/ui/VirtualTable';
import { Badge, Button, ConfirmDialog, EmptyState, Notice, PageHeader, Panel, Tabs } from '../../components/ui';
import { download } from '../../reports/export';
import { useStore } from '../../storage/store';
import { PLATFORM_LABEL, TXN_TYPE_LABEL, type ImportBatch, type Transaction } from '../../types';
import { fmtDate } from '../../utils/dates';
import { fmtDateTime, fmtDec, fmtINR, fmtINR2, fmtInt } from '../../utils/format';
import NewImport, { rejectedCsv } from './NewImport';

type Tab = 'new' | 'history' | 'recon' | 'quality' | 'txns';

export default function ImportPage({ a }: { a: Analytics }) {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('new');
  const [toDelete, setToDelete] = useState<ImportBatch | null>(null);
  const [q, setQ] = useState('');
  const tz = s.settings.reportingTimezone;
  const active = countActiveFilters(a.filters);
  const scopeNote = active > 0
    ? `Calculated for the ${active} filter(s) currently applied on the analysis pages (${fmtInt(a.period.length)} of ${fmtInt(s.txns.length)} transactions).`
    : `Calculated for all ${fmtInt(s.txns.length)} stored transactions.`;

  const recon = useMemo(() => (tab === 'recon' ? reconcile(a.period, a.settings.cancellationPolicy) : null), [tab, a.period, a.settings.cancellationPolicy]);
  const quality = useMemo(() => (tab === 'quality' ? runQualityChecks(a.period, a.settings, a.costIndex, s.rejected.length, a.today) : []), [tab, a.period, a.settings, a.costIndex, s.rejected.length, a.today]);
  const txnRows = useMemo(() => {
    if (tab !== 'txns') return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return a.period;
    return a.period.filter((t) => `${t.orderId} ${t.orderItemId} ${t.sku} ${t.eventSubType} ${t.state} ${t.sourceFile}`.toLowerCase().includes(needle));
  }, [tab, a.period, q]);

  const batchCols: Column<ImportBatch>[] = [
    { key: 'file', header: 'File', value: (b) => b.fileName, render: (b) => <span className="font-medium">{b.fileName}</span> },
    { key: 'platform', header: 'Marketplace', value: (b) => PLATFORM_LABEL[b.platform] },
    { key: 'at', header: 'Imported', value: (b) => b.importedAt, render: (b) => fmtDateTime(b.importedAt, tz) },
    { key: 'by', header: 'By', value: (b) => b.importedBy },
    { key: 'status', header: 'Status', value: (b) => b.status, render: (b) => (b.status === 'active' ? <Badge tone="good">Active</Badge> : b.status === 'incomplete' ? <Badge tone="bad" title="Interrupted before every row was saved. Import the same file again to finish it, or delete it.">Incomplete</Badge> : <Badge>Deleted</Badge>) },
    { key: 'src', header: 'Source rows', align: 'right', value: (b) => b.sourceRows, render: (b) => fmtInt(b.sourceRows) },
    { key: 'acc', header: 'Stored rows', align: 'right', value: (b) => b.acceptedRows, render: (b) => fmtInt(b.acceptedRows), info: 'Transactions stored under this import. For an incomplete import this is the number the file should contribute, not the number saved so far.' },
    { key: 'rej', header: 'Rejected', align: 'right', value: (b) => b.rejectedRows, render: (b) => fmtInt(b.rejectedRows) },
    { key: 'dup', header: 'Repeats in file', align: 'right', value: (b) => b.duplicateInFile, render: (b) => fmtInt(b.duplicateInFile), info: 'Rows identical to an earlier row of the same file on every field read.' },
    { key: 'ovl', header: 'Already stored', align: 'right', value: (b) => b.duplicateExisting, render: (b) => fmtInt(b.duplicateExisting), info: 'Rows of this file that an earlier import had already stored; they were not stored twice.' },
    { key: 'unm', header: 'Unmapped events', value: (b) => b.unmappedEvents.join(', '), render: (b) => b.unmappedEvents.join(', ') || '—' },
    { key: 'dates', header: 'Transaction dates', value: (b) => b.dateFrom, render: (b) => (b.dateFrom ? `${fmtDate(b.dateFrom)} – ${fmtDate(b.dateTo)}` : '—') },
    { key: 'sales', header: 'Sales value', align: 'right', value: (b) => b.grossSalesValue, render: (b) => fmtINR(b.grossSalesValue) },
    { key: 'ret', header: 'Return value', align: 'right', value: (b) => b.returnValue, render: (b) => fmtINR(b.returnValue) },
    { key: 'canc', header: 'Cancellation value', align: 'right', value: (b) => b.cancellationValue, render: (b) => fmtINR(b.cancellationValue) },
    { key: 'gu', header: 'Sold units', align: 'right', value: (b) => b.grossSoldUnits, render: (b) => fmtInt(b.grossSoldUnits) },
    { key: 'ru', header: 'Returned units', align: 'right', value: (b) => b.returnedUnits, render: (b) => fmtInt(b.returnedUnits) },
    {
      key: 'act', header: 'Actions', sortable: false, value: () => '',
      render: (b) => (
        <span className="flex gap-1">
          {b.rejectedRows > 0 && b.status !== 'deleted' && (
            <Button size="sm" variant="ghost" title="Download validation error report" aria-label={`Download error report for ${b.fileName}`}
              onClick={() => download(new Blob([rejectedCsv(s.rejected.filter((r) => r.batchId === b.batchId))], { type: 'text/csv' }), `validation-report_${b.fileName}.csv`)}>
              <Download size={13} />
            </Button>
          )}
          {b.status !== 'deleted' && (
            <Button size="sm" variant="ghost" title="Delete this import" aria-label={`Delete import ${b.fileName}`} onClick={() => setToDelete(b)}><Trash2 size={13} /></Button>
          )}
        </span>
      ),
    },
  ];

  const txnCols: VColumn<Transaction>[] = [
    { key: 'date', header: 'Date', width: 100, render: (t) => t.txnDate },
    { key: 'type', header: 'Type', width: 110, render: (t) => TXN_TYPE_LABEL[t.txnType] },
    { key: 'event', header: 'Event Sub Type', width: 150, render: (t) => t.eventSubType },
    { key: 'sku', header: 'SKU', width: 170, render: (t) => t.sku },
    { key: 'qty', header: 'Raw qty', width: 80, align: 'right', render: (t) => t.rawQty },
    { key: 'val', header: 'Raw taxable value', width: 140, align: 'right', render: (t) => fmtINR2(t.rawTaxable) },
    { key: 'order', header: 'Order ID', width: 170, render: (t) => t.orderId },
    { key: 'item', header: 'Order Item ID', width: 150, render: (t) => t.orderItemId },
    { key: 'state', header: 'State', width: 150, render: (t) => t.state },
    { key: 'platform', header: 'Platform', width: 90, render: (t) => PLATFORM_LABEL[t.platform] },
    { key: 'file', header: 'Source file', width: 220, render: (t) => t.sourceFile },
    { key: 'row', header: 'Row', width: 70, align: 'right', render: (t) => t.sourceRow },
    { key: 'batch', header: 'Batch', width: 170, render: (t) => t.batchId },
  ];

  return (
    <div className="space-y-3">
      <PageHeader title="Import Center" lead="Upload marketplace reports, check what was read, and keep an auditable history of every import." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'new', label: 'New import' }, { value: 'history', label: 'Import history', count: s.batches.length },
        { value: 'recon', label: 'Reconciliation' }, { value: 'quality', label: 'Data quality' }, { value: 'txns', label: 'Transactions', count: s.txns.length },
      ]} />

      {tab === 'new' && <NewImport />}

      {tab === 'history' && (
        <Panel flush>
          <DataTable rows={[...s.batches].reverse()} columns={batchCols} rowKey={(b) => b.batchId} searchText={(b) => b.fileName} searchPlaceholder="Search file name"
            emptyTitle="No imports yet" emptyBody="Imported files appear here with their row counts and totals." />
        </Panel>
      )}

      {tab === 'recon' && recon && (
        <>
          <Notice>{scopeNote} Each figure is recomputed by independent routes and compared, under the current accounting policy.</Notice>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Classified transactions">
              <table className="w-full border-collapse text-[0.8125rem]">
                <tbody>
                  {([
                    ['Sale rows', recon.totals.saleRows], ['Return rows', recon.totals.returnRows], ['Cancellation rows', recon.totals.cancellationRows],
                    ['Excluded rows', recon.totals.excludedRows], ['Unmapped rows', recon.totals.unmappedRows], ['Total stored rows in selection', recon.totalRows],
                    ['Duplicate candidates', recon.duplicateCandidates], ['Rejected at import (not stored)', s.rejected.length],
                  ] as [string, number][]).map(([k, v]) => <tr key={k} className="border-b border-line"><td className="py-1 text-ink-2">{k}</td><td className="num py-1 text-right font-medium">{fmtInt(v)}</td></tr>)}
                </tbody>
              </table>
            </Panel>
            <Panel title="Totals">
              <table className="w-full border-collapse text-[0.8125rem]">
                <tbody>
                  {([
                    ['Gross Sales Value', fmtINR2(recon.totals.grossSalesValue)], ['Return Value', fmtINR2(recon.totals.returnValue)],
                    ['Cancellation Value', fmtINR2(recon.totals.cancellationValue)], ['Net Sales Value', fmtINR2(recon.totals.netSalesValue)],
                    ['Gross Sold Units', fmtInt(recon.totals.grossSoldUnits)], ['Returned Units', fmtInt(recon.totals.returnedUnits)],
                    ['Cancelled Units', fmtInt(recon.totals.cancelledUnits)], ['Net Units', fmtInt(recon.totals.netUnits)],
                    ['Raw value of unmapped rows (not counted)', fmtINR2(recon.totals.unmappedValue)],
                  ] as [string, string][]).map(([k, v]) => <tr key={k} className="border-b border-line"><td className="py-1 text-ink-2">{k}</td><td className="num py-1 text-right font-medium">{v}</td></tr>)}
                </tbody>
              </table>
            </Panel>
          </div>
          <Panel title={<span className="flex items-center gap-1.5">{recon.allOk ? <CheckCircle2 size={15} className="text-good" /> : <XCircle size={15} className="text-bad" />} {recon.allOk ? 'All checks reconcile' : 'Some checks do not reconcile'}</span>} flush>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr><th className="th">Check</th><th className="th text-right">Expected</th><th className="th text-right">Actual</th><th className="th">Result</th></tr></thead>
                <tbody>
                  {recon.checks.map((c) => (
                    <tr key={c.name}><td className="td whitespace-normal">{c.name}</td><td className="td num text-right">{fmtDec(c.expected)}</td><td className="td num text-right">{fmtDec(c.actual)}</td>
                      <td className="td">{c.ok ? <span className="inline-flex items-center gap-1 text-good"><CheckCircle2 size={13} /> Matches</span> : <span className="inline-flex items-center gap-1 text-bad"><XCircle size={13} /> Mismatch</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {tab === 'quality' && (
        <>
          <Notice>{scopeNote} Checks only report problems; they never change a source value.</Notice>
          {quality.length === 0 ? <Panel><EmptyState title="No data-quality findings" body={s.txns.length ? 'Every automated check passed for this selection.' : 'Import a report to run the checks.'} /></Panel> : (
            <Panel flush>
              <ul className="divide-y divide-line">
                {quality.map((i) => (
                  <li key={i.code} className="px-3.5 py-2.5">
                    <p className="flex items-center gap-2 text-[0.8125rem] font-medium">
                      <Badge tone={i.severity === 'error' ? 'bad' : i.severity === 'warning' ? 'warn' : 'neutral'}>{i.severity === 'error' ? 'Action needed' : i.severity === 'warning' ? 'Review' : 'Note'}</Badge>
                      {i.title} <span className="num text-ink-2">{fmtInt(i.count)}</span>
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{i.detail}</p>
                    {i.examples.length > 0 && <p className="mt-0.5 text-xs text-ink-3">{i.examples.join(' · ')}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      {tab === 'txns' && (
        <Panel flush>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, item, SKU, state or file" aria-label="Search transactions" className="field w-72 max-w-full" />
            <span className="num text-xs text-ink-2">{fmtInt(txnRows.length)} of {fmtInt(s.txns.length)} stored transactions{active > 0 && ` (${active} filter(s) applied)`}</span>
          </div>
          {txnRows.length ? <VirtualTable rows={txnRows} columns={txnCols} /> : <EmptyState title="No transactions to show" />}
        </Panel>
      )}

      {toDelete && (
        <ConfirmDialog
          danger title="Delete this import?" confirmLabel="Delete import"
          onClose={() => setToDelete(null)} onConfirm={() => void s.deleteBatch(toDelete.batchId).catch(() => undefined)}
          body={
            <div className="space-y-2 text-[0.8125rem]">
              <p><strong className="font-medium">{toDelete.fileName}</strong> — {fmtInt(toDelete.acceptedRows)} transactions imported {fmtDateTime(toDelete.importedAt, tz)}.</p>
              <p className="text-ink-2">Its transactions and rejected-row records are removed{s.mode === 'sheets' ? ' from your Google Spreadsheet' : ''} and every figure is recalculated. The batch stays in the history, marked deleted, and the deletion is written to the audit log. You can import the file again later.</p>
            </div>
          }
        />
      )}
    </div>
  );
}
