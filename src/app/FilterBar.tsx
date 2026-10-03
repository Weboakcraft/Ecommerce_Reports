import { Filter, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { DATE_PRESETS } from '../analytics/date-ranges';
import { countActiveFilters } from '../analytics/transactions/filters';
import { Button, cx, MultiSelect } from '../components/ui';
import { useStore } from '../storage/store';
import {
  PLATFORM_LABEL, PLATFORMS, SKU_CLASS_LABEL, TXN_TYPE_LABEL, type Filters, type Platform, type SkuClass, type TxnType,
} from '../types';
import { fmtDate, isValidISO } from '../utils/dates';
import type { Analytics } from './analytics';

const TYPES: TxnType[] = ['SALE', 'RETURN', 'CANCELLATION', 'EXCLUDE', 'UNMAPPED'];
const CLASSES = Object.keys(SKU_CLASS_LABEL) as SkuClass[];

export function FilterBar({ a }: { a: Analytics }) {
  const draft = useStore((s) => s.draft);
  const applied = useStore((s) => s.applied);
  const setDraft = useStore((s) => s.setDraft);
  const apply = useStore((s) => s.applyFilters);
  const clear = useStore((s) => s.clearFilters);
  const [more, setMore] = useState(false);
  const [openMobile, setOpenMobile] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const active = countActiveFilters(applied);
  const dateError =
    (draft.dateFrom && !isValidISO(draft.dateFrom)) || (draft.dateTo && !isValidISO(draft.dateTo))
      ? 'Enter valid dates'
      : draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo
        ? 'Start date is after end date'
        : '';

  const setPreset = (id: string) => {
    const preset = DATE_PRESETS.find((p) => p.id === id);
    if (!preset) return setDraft({ datePreset: 'custom' });
    const r = preset.range(a.today);
    setDraft({ datePreset: id, dateFrom: r?.from ?? '', dateTo: r?.to ?? '' });
  };

  const chips: { label: string; remove: Partial<Filters> }[] = [];
  if (applied.dateFrom || applied.dateTo) {
    const preset = DATE_PRESETS.find((p) => p.id === applied.datePreset);
    chips.push({
      label: `${preset && preset.id !== 'all' ? `${preset.label}: ` : ''}${applied.dateFrom ? fmtDate(applied.dateFrom) : 'start'} – ${applied.dateTo ? fmtDate(applied.dateTo) : 'today'}`,
      remove: { dateFrom: '', dateTo: '', datePreset: 'all' },
    });
  }
  const listChip = (name: string, values: string[], remove: Partial<Filters>, render?: (v: string) => string) => {
    if (!values.length) return;
    const shown = values.slice(0, 2).map((v) => (render ? render(v) : v)).join(', ');
    chips.push({ label: `${name}: ${shown}${values.length > 2 ? ` +${values.length - 2}` : ''}`, remove });
  };
  listChip('Marketplace', applied.platforms, { platforms: [] }, (v) => PLATFORM_LABEL[v as Platform]);
  listChip('SKU', applied.skus, { skus: [] });
  listChip('Type', applied.txnTypes, { txnTypes: [] }, (v) => TXN_TYPE_LABEL[v as TxnType]);
  listChip('State', applied.states, { states: [] });
  if (applied.minSalesUnits !== null) chips.push({ label: `Sold units ≥ ${applied.minSalesUnits}`, remove: { minSalesUnits: null } });
  if (applied.returnRateThresholdPct !== null) chips.push({ label: `Return rate ≥ ${applied.returnRateThresholdPct}%`, remove: { returnRateThresholdPct: null } });
  if (applied.profitStatus !== 'all') {
    chips.push({
      label: `Profitability: ${{ profitable: 'Profitable', loss: 'Loss-making', unavailable: 'Cost data missing' }[applied.profitStatus]}`,
      remove: { profitStatus: 'all' },
    });
  }
  listChip('Class', applied.classifications, { classifications: [] }, (v) => SKU_CLASS_LABEL[v as SkuClass]);

  const num = (v: string): number | null => (v.trim() === '' || isNaN(Number(v)) ? null : Math.max(0, Number(v)));

  return (
    <div className="no-print sticky top-0 z-30 border-b border-line bg-page/95 backdrop-blur">
      <div className="px-4 py-2 lg:px-6">
        <div className="flex items-center justify-between gap-2 md:hidden">
          <Button onClick={() => setOpenMobile((o) => !o)} aria-expanded={openMobile}>
            <Filter size={14} /> Filters{active > 0 && <span className="num rounded-full bg-accent px-1.5 text-2xs text-accent-ink">{active}</span>}
          </Button>
          {dirty && <Button variant="primary" disabled={!!dateError} onClick={() => apply()}>Apply filters</Button>}
        </div>

        <form
          className={cx('md:block', openMobile ? 'mt-2 block' : 'hidden')}
          onSubmit={(e) => { e.preventDefault(); if (!dateError) apply(); }}
        >
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <label className="block">
              <span className="label">Date range</span>
              <select className="field" value={DATE_PRESETS.some((p) => p.id === draft.datePreset) ? draft.datePreset : 'custom'} onChange={(e) => setPreset(e.target.value)}>
                {DATE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">Custom range</option>
              </select>
            </label>
            <label className="block">
              <span className="label">From (inclusive)</span>
              <input type="date" className="field" value={draft.dateFrom} max={draft.dateTo || undefined} onChange={(e) => setDraft({ dateFrom: e.target.value, datePreset: 'custom' })} />
            </label>
            <label className="block">
              <span className="label">To (inclusive)</span>
              <input type="date" className="field" value={draft.dateTo} min={draft.dateFrom || undefined} onChange={(e) => setDraft({ dateTo: e.target.value, datePreset: 'custom' })} />
            </label>
            <MultiSelect label="Marketplace" options={PLATFORMS} selected={draft.platforms} onChange={(v) => setDraft({ platforms: v as Platform[] })} render={(v) => PLATFORM_LABEL[v as Platform]} searchable={false} />
            <MultiSelect label="SKU" options={a.options.skus} selected={draft.skus} onChange={(v) => setDraft({ skus: v })} />
            <MultiSelect label="Transaction type" options={TYPES} selected={draft.txnTypes} onChange={(v) => setDraft({ txnTypes: v as TxnType[] })} render={(v) => TXN_TYPE_LABEL[v as TxnType]} searchable={false} />
            <MultiSelect label="State" options={a.options.states} selected={draft.states} onChange={(v) => setDraft({ states: v })} />
          </div>

          {more && (
            <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:max-w-4xl">
              <label className="block">
                <span className="label">Minimum sold units (per SKU)</span>
                <input type="number" min={0} className="field" placeholder="Any" value={draft.minSalesUnits ?? ''} onChange={(e) => setDraft({ minSalesUnits: num(e.target.value) })} />
              </label>
              <label className="block">
                <span className="label">Return rate at least (%)</span>
                <input type="number" min={0} max={100} className="field" placeholder="Any" value={draft.returnRateThresholdPct ?? ''} onChange={(e) => setDraft({ returnRateThresholdPct: num(e.target.value) })} />
              </label>
              <label className="block">
                <span className="label">Profitability status</span>
                <select className="field" value={draft.profitStatus} onChange={(e) => setDraft({ profitStatus: e.target.value as Filters['profitStatus'] })}>
                  <option value="all">All</option>
                  <option value="profitable">Profitable</option>
                  <option value="loss">Loss-making</option>
                  <option value="unavailable">Cost data missing</option>
                </select>
              </label>
              <MultiSelect label="SKU classification" options={CLASSES} selected={draft.classifications} onChange={(v) => setDraft({ classifications: v as SkuClass[] })} render={(v) => SKU_CLASS_LABEL[v as SkuClass]} searchable={false} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {active > 0 && <span className="text-xs text-ink-2">{active} active {active === 1 ? 'filter' : 'filters'}</span>}
              {chips.map((c) => (
                <span key={c.label} className="inline-flex items-center gap-1 rounded-sm border border-line-strong bg-surface py-px pl-1.5 pr-0.5 text-xs text-ink">
                  {c.label}
                  <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => apply({ ...c.remove })} className="rounded-sm p-0.5 text-ink-3 hover:bg-sunken hover:text-ink">
                    <X size={11} />
                  </button>
                </span>
              ))}
              {dirty && <span className="text-xs text-warn">Changes not applied yet</span>}
              {dateError && <span className="text-xs text-bad">{dateError}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMore((m) => !m)} aria-expanded={more} title="More filters">
                <SlidersHorizontal size={13} /> {more ? 'Fewer filters' : 'More filters'}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={active === 0 && !dirty} onClick={clear}>Clear filters</Button>
              <Button type="submit" size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || !!dateError}>Apply filters</Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
