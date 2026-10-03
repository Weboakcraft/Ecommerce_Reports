import {
  Boxes, Database, FileDown, Gauge, Globe2, HardDrive, IndianRupee, LayoutDashboard, Map as MapIcon, Menu, Moon,
  RefreshCw, Settings as SettingsIcon, Sun, TrendingUp, Undo2, Upload, X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, cx, Notice, ProgressBar } from '../components/ui';
import { useStore } from '../storage/store';
import type { PageId } from './router';

export const NAV: { id: PageId; label: string; icon: typeof Gauge; group: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Analysis' },
  { id: 'sku', label: 'SKU Analytics', icon: Boxes, group: 'Analysis' },
  { id: 'pnl', label: 'Profit & Loss', icon: IndianRupee, group: 'Analysis' },
  { id: 'returns', label: 'Returns Intelligence', icon: Undo2, group: 'Analysis' },
  { id: 'movement', label: 'Product Movement', icon: TrendingUp, group: 'Analysis' },
  { id: 'states', label: 'State Analytics', icon: MapIcon, group: 'Analysis' },
  { id: 'marketplaces', label: 'Marketplace Comparison', icon: Globe2, group: 'Analysis' },
  { id: 'costs', label: 'Product Cost Master', icon: Database, group: 'Data' },
  { id: 'import', label: 'Import Center', icon: Upload, group: 'Data' },
  { id: 'reports', label: 'Reports', icon: FileDown, group: 'Data' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, group: 'Data' },
];

export function Shell({
  page, onNavigate, filterBar, children,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  filterBar: ReactNode;
  children: ReactNode;
}) {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const incomplete = s.batches.filter((b) => b.status === 'incomplete');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', s.theme === 'dark');
  }, [s.theme]);
  useEffect(() => setMenu(false), [page]);

  const nav = (
    <nav aria-label="Sections" className="flex flex-col gap-4 px-2 py-3">
      {['Analysis', 'Data'].map((g) => (
        <div key={g}>
          <p className="px-2 pb-1 text-2xs font-medium text-ink-3">{g}</p>
          <ul className="space-y-px">
            {NAV.filter((n) => n.group === g).map((n) => {
              const active = n.id === page;
              return (
                <li key={n.id}>
                  <a
                    href={`#/${n.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex items-center gap-2 rounded px-2 py-1.5 text-[0.8125rem]',
                      active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                    )}
                  >
                    <n.icon size={15} strokeWidth={active ? 2.2 : 1.8} />
                    {n.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const source = (
    <button
      type="button"
      onClick={() => onNavigate('settings')}
      title={s.mode === 'sheets' ? 'Data is saved to your Google Spreadsheet' : 'Data is stored only in this browser. Connect Google Sheets in Settings.'}
      className={cx(
        'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs',
        s.mode === 'sheets' ? 'border-line text-ink-2' : 'border-warn/40 bg-warn/5 text-ink',
      )}
    >
      {s.mode === 'sheets' ? <Database size={14} className="shrink-0 text-good" /> : <HardDrive size={14} className="shrink-0 text-warn" />}
      <span className="min-w-0">
        <span className="block font-medium">{s.mode === 'sheets' ? 'Google Sheets' : 'This browser only'}</span>
        <span className="block truncate text-ink-3">{s.mode === 'sheets' ? s.spreadsheetName || 'Connected' : 'Not saved to a spreadsheet'}</span>
      </span>
    </button>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-12 items-center gap-2 border-b border-line px-4">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-accent text-accent-ink"><Gauge size={14} /></span>
          <span className="text-sm font-semibold tracking-tight">Marketplace Analytics</span>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-line p-2">{source}</div>
      </aside>

      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-line px-4">
              <span className="text-sm font-semibold">Marketplace Analytics</span>
              <button type="button" aria-label="Close menu" onClick={() => setMenu(false)} className="rounded p-1 text-ink-2"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            <div className="border-t border-line p-2">{source}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" aria-label="Open menu" onClick={() => setMenu(true)} className="rounded p-1 text-ink-2 lg:hidden"><Menu size={18} /></button>
            <span className="truncate text-sm font-medium text-ink">{NAV.find((n) => n.id === page)?.label}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden text-xs text-ink-3 sm:inline">Times in {s.settings.reportingTimezone}</span>
            <Button variant="ghost" size="sm" onClick={() => void s.reload()} title="Reload data from storage" aria-label="Reload data"><RefreshCw size={14} /></Button>
            <Button variant="ghost" size="sm" onClick={s.toggleTheme} aria-label={s.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              {s.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </Button>
          </div>
        </header>

        {(s.error || s.notice || s.localSaveFailed || s.loadFailed || incomplete.length > 0) && (
          <div className="space-y-1.5 px-4 pt-2 lg:px-6">
            {s.error && <Notice tone="bad" onDismiss={s.dismissError}><strong className="font-medium">Something went wrong.</strong> {s.error}</Notice>}
            {s.loadFailed && (
              <Notice tone="bad">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><strong className="font-medium">Your data is not loaded.</strong> The screen is empty because Google Sheets could not be reached, not because the spreadsheet is empty. Saving is switched off until the data loads.</span>
                  <Button size="sm" onClick={() => void s.reload()}>Try again</Button>
                </div>
              </Notice>
            )}
            {incomplete.length > 0 && (
              <Notice tone="bad">
                <strong className="font-medium">An import was interrupted:</strong> {incomplete.map((b) => `“${b.fileName}”`).join(', ')}. Only part of {incomplete.length === 1 ? 'that file is' : 'those files are'} stored, so current figures are incomplete. <a href="#/import" className="font-medium underline">Import the same file again</a> to finish, or delete it in Import History.
              </Notice>
            )}
            {s.localSaveFailed && (
              <Notice tone="warn">This browser could not save the data (storage full or blocked). Connect Google Sheets in Settings so nothing is lost.</Notice>
            )}
            {s.notice && <Notice tone="accent" onDismiss={s.dismissNotice}>{s.notice}</Notice>}
          </div>
        )}

        {filterBar}
        <main className="min-w-0 flex-1 px-4 py-4 lg:px-6">{children}</main>
      </div>

      {s.busy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" role="alertdialog" aria-label={s.busy.label} aria-busy="true">
          <div className="w-full max-w-sm rounded-md border border-line-strong bg-surface p-4 shadow-xl">
            <p className="mb-2 text-sm font-medium">{s.busy.label}…</p>
            <ProgressBar value={s.busy.progress} />
          </div>
        </div>
      )}
    </div>
  );
}
