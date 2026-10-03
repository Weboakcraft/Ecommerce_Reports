import { useMemo } from 'react';
import { movementWindows } from '../../analytics/movement';
import type { SkuRow } from '../../analytics/sku-classification';
import type { Analytics } from '../../app/analytics';
import { ClassBadges } from '../../components/SkuBits';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Button, Notice, PageHeader, Panel } from '../../components/ui';
import { useStore } from '../../storage/store';
import { PLATFORM_LABEL } from '../../types';
import { fmtDate } from '../../utils/dates';
import { fmtDec, fmtINR, fmtInt, fmtPct } from '../../utils/format';
import { NoData } from '../overview/Page';

const Partial = ({ covered, children }: { covered: boolean; children: React.ReactNode }) =>
  covered ? <>{children}</> : <span className="italic text-ink-3" title="Imported reports do not cover this whole window, so the figure is incomplete">{children}*</span>;

export default function MovementPage({ a }: { a: Analytics }) {
  const apply = useStore((s) => s.applyFilters);
  const s = a.settings;
  const w = movementWindows(a.asOf, s);
  const rows = useMemo(() => a.skuRows.filter((r) => r.movement), [a.skuRows]);

  const columns = useMemo<Column<SkuRow>[]>(() => {
    const m = (r: SkuRow) => r.movement!;
    return [
      { key: 'sku', header: 'SKU', value: (r) => r.sku, render: (r) => <span className="font-medium">{r.sku}</span> },
      { key: 'platform', header: 'Platform', value: (r) => PLATFORM_LABEL[r.platform] },
      { key: 'first', header: 'First Sale', value: (r) => m(r).firstSaleDate, render: (r) => (m(r).firstSaleDate ? fmtDate(m(r).firstSaleDate!) : '—'), info: 'Earliest Sale transaction in the imported data. The product may have sold before the imported reports begin.' },
      { key: 'last', header: 'Last Sale', value: (r) => m(r).lastSaleDate, render: (r) => (m(r).lastSaleDate ? fmtDate(m(r).lastSaleDate!) : '—') },
      { key: 'dsl', header: 'Days Since Sale', align: 'right', value: (r) => m(r).daysSinceLastSale, render: (r) => fmtInt(m(r).daysSinceLastSale), info: 'Reporting date minus last sale date.' },
      { key: 'u7', header: 'Units 7d', align: 'right', value: (r) => m(r).units7, render: (r) => <Partial covered={m(r).covered.w7}>{fmtInt(m(r).units7)}</Partial> },
      { key: 'u30', header: 'Units 30d', align: 'right', value: (r) => m(r).units30, render: (r) => <Partial covered={m(r).covered.w30}>{fmtInt(m(r).units30)}</Partial> },
      { key: 'u90', header: 'Units 90d', align: 'right', value: (r) => m(r).units90, render: (r) => <Partial covered={m(r).covered.w90}>{fmtInt(m(r).units90)}</Partial> },
      { key: 'r30', header: 'Revenue 30d', align: 'right', value: (r) => m(r).rev30, render: (r) => <Partial covered={m(r).covered.w30}>{fmtINR(m(r).rev30)}</Partial>, info: 'Gross Sales Value of Sale transactions in the last 30 days to the reporting date.' },
      { key: 'p30', header: 'Previous 30d', align: 'right', value: (r) => m(r).prevRev30, render: (r) => <Partial covered={m(r).covered.prev30}>{fmtINR(m(r).prevRev30)}</Partial> },
      {
        key: 'g', header: 'Growth %', align: 'right', value: (r) => (m(r).covered.prev30 ? m(r).revGrowthPct : null),
        render: (r) => !m(r).covered.prev30 ? <span className="text-ink-3" title="Both 30-day windows must be covered by imported data">Not assessed</span>
          : m(r).revGrowthPct === null ? <span className="text-ink-3" title="Previous 30 days had no sales, so a percentage would mislead">No prior sales</span>
          : <span className={m(r).revGrowthPct! < 0 ? 'text-bad' : m(r).revGrowthPct! > 0 ? 'text-good' : ''}>{m(r).revGrowthPct! > 0 ? '+' : ''}{fmtPct(m(r).revGrowthPct)}</span>,
        info: '(Revenue 30d − Previous 30d) ÷ Previous 30d × 100.',
      },
      { key: 'adu', header: 'Avg Daily Units', align: 'right', value: (r) => m(r).avgDailyUnits, render: (r) => <Partial covered={m(r).covered.velocity}>{fmtDec(m(r).avgDailyUnits)}</Partial>, info: `Units sold in the last ${s.velocityWindowDays} days ÷ ${s.velocityWindowDays}. Change the window in Settings.` },
      { key: 'class', header: 'Classification', sortable: false, value: (r) => r.classes.join(','), render: (r) => <ClassBadges row={r} /> },
    ];
  }, [s.velocityWindowDays]);

  if (!a.hasData) return <NoData />;
  const cov = a.coverage!;
  const anyPartial = rows.some((r) => !r.movement!.covered.w90);
  const holes = [...a.coverageHoles.values()].flat();

  return (
    <div className="space-y-3">
      <PageHeader
        title="Product Movement"
        lead={`Reporting date ${fmtDate(a.asOf)}${a.range ? ' (end of the selected date range)' : ' (today)'}. Windows run back from this date: 7 days from ${fmtDate(w.w7.from)}, 30 days from ${fmtDate(w.w30.from)}, 90 days from ${fmtDate(w.w90.from)}. Imported reports cover ${fmtDate(cov.from)} – ${fmtDate(cov.to)}.`}
      />
      {a.asOfBeyondCoverage && (
        <Notice tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong className="font-medium">The reporting date is after the last imported transaction ({fmtDate(cov.to)}).</strong> The days in between have no report, so they are not treated as days without sales, and no SKU is flagged as inactive.
            </span>
            <Button size="sm" onClick={() => apply({ dateFrom: cov.from, dateTo: cov.to, datePreset: 'custom' })}>Use {fmtDate(cov.to)} as the reporting date</Button>
          </div>
        </Notice>
      )}
      {holes.length > 0 && (
        <Notice tone="warn">
          <strong className="font-medium">Possible missing reports:</strong> no transactions at all on {holes.slice(0, 4).map((h) => `${fmtDate(h.from)} – ${fmtDate(h.to)} (${h.days} days)`).join(', ')}{holes.length > 4 && ` and ${holes.length - 4} more stretches`}. A stretch of {s.coverageGapDays} days or more with nothing recorded is treated as not covered, so SKUs are not called inactive across it. If you really had no orders then, lower or raise the threshold in Settings → Classification rules.
        </Notice>
      )}
      {!a.asOfBeyondCoverage && anyPartial && (
        <Notice>Figures marked * come from a window that starts before the imported reports begin ({fmtDate(cov.from)}), so they are incomplete.</Notice>
      )}
      <Panel flush>
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.key} searchText={(r) => r.sku} searchPlaceholder="Search SKU" initialSort={{ key: 'u30', dir: 'desc' }} emptyTitle="No SKUs match the current filters" />
      </Panel>
      <p className="text-xs leading-relaxed text-ink-3">
        Low movement: {s.lowMovementMaxUnits} or fewer units in {s.lowMovementDays} days. No recent sales: no Sale transaction in {s.noRecentSalesDays} days. Declining: sales value down {s.decliningPct}% or more against the previous {s.decliningWindowDays} days. A short period without sales is not, on its own, evidence of dead stock.
      </p>
    </div>
  );
}
