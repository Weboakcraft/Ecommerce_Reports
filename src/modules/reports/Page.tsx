import { FileSpreadsheet, FileText, FileType2 } from 'lucide-react';
import { useState } from 'react';
import type { Analytics } from '../../app/analytics';
import { Button, Notice, PageHeader, Panel } from '../../components/ui';
import { buildReport, describeFilters, REPORTS, type ReportDef } from '../../reports/build';
import { exportCsv, exportExcel, exportPdf } from '../../reports/export';
import { useStore } from '../../storage/store';
import { NoData } from '../overview/Page';

export default function ReportsPage({ a }: { a: Analytics }) {
  const s = useStore();
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  const run = async (def: ReportDef, kind: 'xlsx' | 'csv' | 'pdf') => {
    setWorking(`${def.id}:${kind}`);
    setError('');
    try {
      const report = buildReport(def, {
        a, batches: s.batches, rejected: s.rejected, audit: s.audit, costs: a.costIndex,
        dataSource: s.mode === 'sheets' ? `Google Sheets (${s.spreadsheetName})` : 'This browser',
      });
      if (kind === 'xlsx') await exportExcel(report);
      else if (kind === 'csv') exportCsv(report);
      else await exportPdf(report);
    } catch (e) {
      setError(`${def.title} could not be created: ${(e as Error).message}`);
    } finally {
      setWorking('');
    }
  };

  if (!a.hasData) return <NoData />;
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" lead="Every download uses the filters applied above and records them inside the file, with the reporting period, the time it was generated and metric definitions." />
      {error && <Notice tone="bad" onDismiss={() => setError('')}>{error}</Notice>}
      <Panel title="What will be exported">
        <dl className="grid gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2">
          {describeFilters(a).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
              <dt className="text-ink-2">{k}</dt><dd className="truncate text-right font-medium" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel flush>
        <ul className="divide-y divide-line">
          {REPORTS.map((def) => (
            <li key={def.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{def.title}</p>
                <p className="text-xs text-ink-2">{def.description}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" disabled={!!working} onClick={() => void run(def, 'xlsx')} aria-label={`Download ${def.title} as Excel`}>
                  <FileSpreadsheet size={13} /> {working === `${def.id}:xlsx` ? 'Preparing…' : 'Excel'}
                </Button>
                <Button size="sm" disabled={!!working} onClick={() => void run(def, 'csv')} aria-label={`Download ${def.title} as CSV`}>
                  <FileText size={13} /> CSV
                </Button>
                <Button size="sm" disabled={!!working} onClick={() => void run(def, 'pdf')} aria-label={`Download ${def.title} as PDF`}>
                  <FileType2 size={13} /> {working === `${def.id}:pdf` ? 'Preparing…' : 'PDF'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <p className="text-xs leading-relaxed text-ink-3">
        Text cells that begin with =, +, − or @ are written with a leading apostrophe so they cannot run as formulas when a file is opened. Profit columns are left blank wherever cost data is incomplete; nothing is estimated.
      </p>
    </div>
  );
}
