import { useMemo, useState } from 'react';
import { defaultGrain, timeSeries, type Grain } from '../../analytics/date-ranges';
import type { CohortRow } from '../../analytics/returns/cohort';
import type { GroupTotals } from '../../analytics/revenue/totals';
import type { SkuRow } from '../../analytics/sku-classification';
import type { Analytics } from '../../app/analytics';
import { ChartCard, RankBars, SERIES, TrendChart } from '../../components/charts';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { InfoTip, Notice, PageHeader, Panel, Segmented, Tabs } from '../../components/ui';
import { PLATFORM_LABEL, type Platform } from '../../types';
import { fmtMonth, rangeDays } from '../../utils/dates';
import { fmtDec, fmtINR, fmtINRCompact, fmtInt, fmtPct } from '../../utils/format';
import { bucketLabel, NoData, PeriodLine } from '../overview/Page';

export default function ReturnsPage({ a }: { a: Analytics }) {
  const [view, setView] = useState<'txn' | 'cohort'>('txn');
  const [tab, setTab] = useState<'sku' | 'state' | 'platform'>('sku');
  const span = a.range ?? a.coverage;
  const [grainChoice, setGrain] = useState<Grain | null>(null);
  const grain = grainChoice ?? defaultGrain(span ? rangeDays(span.from, span.to) : 30);
  const t = a.totals;
  const policy = a.settings.cancellationPolicy;
  const minUnits = a.settings.highReturnMinUnits;

  const series = useMemo(() => {
    return timeSeries(a.period, grain, policy, a.span).map((g) => ({
      key: g.key, value: g.returnValue, units: g.returnedUnits, rate: g.returnUnitRatePct,
    }));
  }, [a.period, a.span, grain, policy]);

  const skuCols = useMemo<Column<SkuRow>[]>(() => [
    { key: 'sku', header: 'SKU', value: (r) => r.sku, render: (r) => <span className="font-medium">{r.sku}</span> },
    { key: 'platform', header: 'Platform', value: (r) => PLATFORM_LABEL[r.platform] },
    { key: 'rv', header: 'Return Value', align: 'right', value: (r) => r.returnValue, render: (r) => fmtINR(r.returnValue) },
    { key: 'ru', header: 'Returned Units', align: 'right', value: (r) => r.returnedUnits, render: (r) => fmtInt(r.returnedUnits) },
    { key: 'gu', header: 'Sold Units', align: 'right', value: (r) => r.grossSoldUnits, render: (r) => fmtInt(r.grossSoldUnits) },
    { key: 'rr', header: 'Return Unit Rate', align: 'right', value: (r) => r.returnUnitRatePct, render: (r) => fmtPct(r.returnUnitRatePct), info: 'Returned Units ÷ Gross Sold Units × 100.' },
    { key: 'rvr', header: 'Return Value Rate', align: 'right', value: (r) => r.returnValueRatePct, render: (r) => fmtPct(r.returnValueRatePct), info: 'Return Value ÷ Gross Sales Value × 100.' },
    { key: 'share', header: 'Share of Returns', align: 'right', value: (r) => r.returnContributionPct, render: (r) => fmtPct(r.returnContributionPct), info: 'This SKU’s Return Value as a share of all Return Value in the selection.' },
    {
      key: 'flag', header: 'Elevated', value: (r) => (r.classes.includes('HIGH_RETURN') ? 1 : 0),
      render: (r) => r.classes.includes('HIGH_RETURN')
        ? <span className="text-warn">Yes</span>
        : r.grossSoldUnits < minUnits ? <span className="text-ink-3" title={`Fewer than ${minUnits} sold units: rate not judged`}>Too few sales</span> : <span className="text-ink-3">No</span>,
      info: `Unit return rate ≥ ${a.settings.highReturnRatePct}% with at least ${minUnits} sold units.`,
    },
  ], [a.settings.highReturnRatePct, minUnits]);

  const groupCols = (label: string, name: (k: string) => string): Column<GroupTotals>[] => [
    { key: 'k', header: label, value: (r) => name(r.key), render: (r) => <span className="font-medium">{name(r.key)}</span> },
    { key: 'rv', header: 'Return Value', align: 'right', value: (r) => r.returnValue, render: (r) => fmtINR(r.returnValue) },
    { key: 'ru', header: 'Returned Units', align: 'right', value: (r) => r.returnedUnits, render: (r) => fmtInt(r.returnedUnits) },
    { key: 'gu', header: 'Sold Units', align: 'right', value: (r) => r.grossSoldUnits, render: (r) => fmtInt(r.grossSoldUnits) },
    { key: 'rr', header: 'Return Unit Rate', align: 'right', value: (r) => r.returnUnitRatePct, render: (r) => fmtPct(r.returnUnitRatePct) },
    { key: 'rvr', header: 'Return Value Rate', align: 'right', value: (r) => r.returnValueRatePct, render: (r) => fmtPct(r.returnValueRatePct) },
    { key: 'share', header: 'Share of Returns', align: 'right', value: (r) => (t.returnValue ? (r.returnValue / t.returnValue) * 100 : null), render: (r) => fmtPct(t.returnValue ? (r.returnValue / t.returnValue) * 100 : null) },
  ];

  const cohortCols: Column<CohortRow>[] = [
    { key: 'm', header: 'Sale month', value: (r) => r.saleMonth, render: (r) => <span className="font-medium">{fmtMonth(r.saleMonth)}</span> },
    { key: 'gs', header: 'Gross Sales', align: 'right', value: (r) => r.grossSalesValue, render: (r) => fmtINR(r.grossSalesValue) },
    { key: 'gu', header: 'Sold Units', align: 'right', value: (r) => r.grossSoldUnits, render: (r) => fmtInt(r.grossSoldUnits) },
    { key: 'rv', header: 'Returned (value)', align: 'right', value: (r) => r.returnValue, render: (r) => fmtINR(r.returnValue), info: 'Return Value of returns linked to sales made in this month, whenever the return happened.' },
    { key: 'ru', header: 'Returned (units)', align: 'right', value: (r) => r.returnedUnits, render: (r) => fmtInt(r.returnedUnits) },
    { key: 'rr', header: 'Cohort Unit Rate', align: 'right', value: (r) => r.returnUnitRatePct, render: (r) => fmtPct(r.returnUnitRatePct) },
    { key: 'rvr', header: 'Cohort Value Rate', align: 'right', value: (r) => r.returnValueRatePct, render: (r) => fmtPct(r.returnValueRatePct) },
    { key: 'days', header: 'Avg Days to Return', align: 'right', value: (r) => r.avgDaysToReturn, render: (r) => fmtDec(r.avgDaysToReturn, 1) },
  ];

  if (!a.hasData) return <NoData />;
  const c = a.cohort;
  const topValue = [...a.skuRows].filter((r) => r.returnValue > 0).sort((x, y) => y.returnValue - x.returnValue).slice(0, 10);
  const topUnits = [...a.skuRows].filter((r) => r.returnedUnits > 0).sort((x, y) => y.returnedUnits - x.returnedUnits).slice(0, 10);
  const tick = (k: string) => bucketLabel(k, grain);
  const long = (k: string) => bucketLabel(k, grain, true);
  const grainControl = <Segmented label="Time grain" value={grain} onChange={setGrain} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />;
  const tiles: [string, string, string][] = [
    ['Total Return Value', fmtINR(t.returnValue), 'Sum of the absolute taxable value of Return transactions.'],
    ['Total Returned Units', fmtInt(t.returnedUnits), 'Sum of the absolute quantity of Return transactions.'],
    ['Return Unit Rate', fmtPct(t.returnUnitRatePct), 'Returned Units ÷ Gross Sold Units × 100.'],
    ['Return Value Rate', fmtPct(t.returnValueRatePct), 'Return Value ÷ Gross Sales Value × 100. This is the share of sales value lost through returns.'],
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Returns Intelligence" lead={<PeriodLine a={a} />}
        actions={<Segmented label="Attribution view" value={view} onChange={setView} options={[{ value: 'txn', label: 'Transaction-date view' }, { value: 'cohort', label: 'Cohort view' }]} />}
      />

      {view === 'txn' ? (
        <>
          <Notice>
            <strong className="font-medium">Transaction-date view.</strong> Each sale and each return is counted on its own Buyer Invoice Date. A return in this period may belong to a sale from an earlier period, so rates for short ranges can look higher or lower than the true rate for those sales.
          </Notice>
          <div className="overflow-hidden rounded-md border border-line bg-line">
            <dl className="grid grid-cols-2 gap-px lg:grid-cols-4">
              {tiles.map(([label, value, info]) => (
                <div key={label} className="bg-surface px-3.5 py-3">
                  <dt className="flex items-center gap-1 text-xs font-medium text-ink-2">{label} <InfoTip text={info} /></dt>
                  <dd className="text-[1.375rem] font-semibold leading-7 tracking-tight">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Return Value trend" controls={grainControl}
              empty={t.returnRows === 0 ? { title: 'No returns in this selection' } : null}
              table={{ headers: ['Period', 'Return value', 'Returned units'], rows: series.map((d) => [long(d.key), fmtINR(d.value), fmtInt(d.units)]) }}>
              <TrendChart kind={series.length > 45 ? 'line' : 'bar'} data={series} series={[{ key: 'value', name: 'Return Value', color: SERIES.returns }]} format={fmtINR} axisFormat={fmtINRCompact} tickFormat={tick} labelFormat={long} />
            </ChartCard>
            <ChartCard title="Return unit rate trend" controls={grainControl}
              info="Returned Units ÷ Gross Sold Units × 100 for each period, by transaction date. Periods with no sold units have no rate."
              empty={t.returnRows === 0 ? { title: 'No returns in this selection' } : null}
              table={{ headers: ['Period', 'Return unit rate'], rows: series.map((d) => [long(d.key), fmtPct(d.rate)]) }}>
              <TrendChart data={series} series={[{ key: 'rate', name: 'Return unit rate', color: SERIES.returns }]} format={(n) => fmtPct(n)} axisFormat={(n) => `${n}%`} tickFormat={tick} labelFormat={long} />
            </ChartCard>
            <ChartCard title="Top SKUs by Return Value" empty={topValue.length ? null : { title: 'No returns in this selection' }}
              table={{ headers: ['SKU', 'Return value', 'Share'], rows: topValue.map((r) => [r.sku, fmtINR(r.returnValue), fmtPct(r.returnContributionPct)]) }}>
              <RankBars name="Return Value" color={SERIES.returns} format={fmtINRCompact} data={topValue.map((r) => ({ label: r.sku, value: r.returnValue, note: `${fmtPct(r.returnContributionPct)} of all return value` }))} />
            </ChartCard>
            <ChartCard title="Top SKUs by returned quantity" empty={topUnits.length ? null : { title: 'No returns in this selection' }}
              table={{ headers: ['SKU', 'Returned units', 'Sold units'], rows: topUnits.map((r) => [r.sku, fmtInt(r.returnedUnits), fmtInt(r.grossSoldUnits)]) }}>
              <RankBars name="Returned Units" color={SERIES.returns} format={fmtInt} data={topUnits.map((r) => ({ label: r.sku, value: r.returnedUnits, note: `of ${fmtInt(r.grossSoldUnits)} sold` }))} />
            </ChartCard>
          </div>

          <Panel flush>
            <div className="px-3.5 pt-2">
              <Tabs value={tab} onChange={setTab} tabs={[{ value: 'sku', label: 'By SKU' }, { value: 'state', label: 'By state' }, { value: 'platform', label: 'By marketplace' }]} />
            </div>
            {tab === 'sku' && <DataTable rows={a.skuRows.filter((r) => r.returnRows > 0 || r.saleRows > 0)} columns={skuCols} rowKey={(r) => r.key} searchText={(r) => r.sku} searchPlaceholder="Search SKU" initialSort={{ key: 'rv', dir: 'desc' }} />}
            {tab === 'state' && <DataTable rows={a.byState} columns={groupCols('State', (k) => k)} rowKey={(r) => r.key} searchText={(r) => r.key} searchPlaceholder="Search state" initialSort={{ key: 'rv', dir: 'desc' }} />}
            {tab === 'platform' && <DataTable rows={a.byPlatform} columns={groupCols('Marketplace', (k) => PLATFORM_LABEL[k as Platform])} rowKey={(r) => r.key} initialSort={{ key: 'rv', dir: 'desc' }} />}
          </Panel>
        </>
      ) : (
        <>
          <Notice>
            <strong className="font-medium">Cohort view.</strong> Returns are attributed to the month of the original sale, found by matching a return’s Order Item ID to a Sale row dated on or before it. This link is checked against your data rather than assumed; the result of that check is below.
          </Notice>
          <Panel title="Linkage check">
            <div className="grid gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2 lg:grid-cols-4">
              {([
                ['Return rows examined', fmtInt(c.stats.returnRows)],
                ['Linked to a sale row', `${fmtInt(c.stats.linkedRows)} (${fmtPct(c.stats.linkagePct)})`],
                ['Sale dated after the return', fmtInt(c.stats.saleAfterReturnRows)],
                ['Required for a reliable cohort', `${a.settings.cohortMinLinkagePct}%`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}><p className="text-xs text-ink-2">{k}</p><p className="num font-semibold">{v}</p></div>
              ))}
            </div>
            {c.stats.returnRows > 0 && c.unlinkedReturnedUnits > 0 && (
              <p className="mt-2 text-xs text-ink-2">Unlinked returns ({fmtINR(c.unlinkedReturnValue)}, {fmtInt(c.unlinkedReturnedUnits)} units) are not placed in any cohort.</p>
            )}
          </Panel>
          {c.stats.returnRows === 0 ? (
            <Notice>No return rows in this selection, so there is nothing to attribute.</Notice>
          ) : c.reliable ? (
            <Panel title="Returns by month of original sale" subtitle="Recent months are incomplete: items sold recently can still be returned after the last imported date." flush>
              <DataTable rows={c.rows} columns={cohortCols} rowKey={(r) => r.saleMonth} initialSort={{ key: 'm', dir: 'asc' }} pageSize={25} />
            </Panel>
          ) : (
            <Notice tone="warn">
              <strong className="font-medium">A reliable cohort cannot be built from this data.</strong> Only {fmtPct(c.stats.linkagePct)} of return rows match a sale row by Order Item ID (minimum {a.settings.cohortMinLinkagePct}%). The usual causes are sales reports for earlier months not yet imported, or a report format in which returns do not carry the original Order Item ID. The transaction-date view remains valid. The minimum can be changed in Settings.
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
