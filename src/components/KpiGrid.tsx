import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { change } from '../analytics/date-ranges';
import { fmtKpi, type Kpi } from '../modules/overview/kpis';
import { fmtDec, fmtINR, fmtInt, fmtPct } from '../utils/format';
import { cx, InfoTip } from './ui';

function Delta({ k, hasRange }: { k: Kpi; hasRange: boolean }) {
  if (k.prev === undefined) return null;
  if (!hasRange) return null;
  if (k.value === null || k.prev === null) return <p className="text-xs text-ink-3">No previous-period data</p>;
  const c = change(k.value, k.prev);
  const abs = c.abs ?? 0;
  const dir = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';
  const good = k.goodWhen === 'neutral' || dir === 'flat' ? null : dir === k.goodWhen;
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  const sign = abs > 0 ? '+' : abs < 0 ? '−' : '';
  const absText =
    k.kind === 'money' ? fmtINR(Math.abs(abs)) : k.kind === 'int' ? fmtInt(Math.abs(abs)) : `${fmtDec(Math.abs(abs), 1)} pts`;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
      <span className={cx('inline-flex items-center gap-0.5 font-medium', good === null ? 'text-ink-2' : good ? 'text-good' : 'text-bad')}>
        <Icon size={13} aria-hidden />
        <span className="sr-only">{dir === 'up' ? 'Up' : dir === 'down' ? 'Down' : 'No change'}</span>
        {sign}{absText}
        {k.kind !== 'pct' && c.pct !== null && ` (${sign}${fmtPct(Math.abs(c.pct))})`}
      </span>
      <span className="text-ink-3">
        vs {fmtKpi(k, k.prev)} prev.
        {k.kind !== 'pct' && c.pct === null && c.note === 'Previous period was zero' && ' — % not shown, previous was zero'}
      </span>
    </p>
  );
}

/**
 * KPI ledger: one ruled panel instead of twelve floating cards, so the figures
 * read as a statement and line up for comparison.
 */
export function KpiGrid({ kpis, hasRange }: { kpis: Kpi[]; hasRange: boolean }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-line">
      <dl className="grid grid-cols-2 gap-px md:grid-cols-3 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.id} className="flex min-h-[5.75rem] flex-col gap-0.5 bg-surface px-3.5 py-3">
            <dt className="flex items-center gap-1 text-xs font-medium text-ink-2">
              {k.label}
              <InfoTip text={k.formula} />
            </dt>
            <dd className="min-w-0">
              {k.unavailable ? (
                <p className="mt-0.5 text-xs leading-snug text-ink-2">{k.unavailable}</p>
              ) : (
                <>
                  <p className="text-[1.375rem] font-semibold leading-7 tracking-tight text-ink">{fmtKpi(k, k.value)}</p>
                  <Delta k={k} hasRange={hasRange} />
                </>
              )}
              {k.footnote && <p className="mt-0.5 text-xs leading-snug text-ink-3">{k.footnote}</p>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
