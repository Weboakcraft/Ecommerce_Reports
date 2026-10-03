import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { defaultGrain, timeSeries, type Grain } from '../../analytics/date-ranges';
import type { Analytics } from '../../app/analytics';
import { go } from '../../app/router';
import { ChartCard, RankBars, SERIES, TrendChart } from '../../components/charts';
import { KpiGrid } from '../../components/KpiGrid';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel, Segmented } from '../../components/ui';
import { useStore } from '../../storage/store';
import { PLATFORM_LABEL, type Platform } from '../../types';
import { fmtDate, fmtDateShort, fmtMonth, rangeDays } from '../../utils/dates';
import { fmtCompact, fmtINR, fmtINRCompact, fmtInt, fmtPct } from '../../utils/format';
import { buildKpis } from './kpis';

export function bucketLabel(key: string, grain: Grain, long = false): string {
  if (grain === 'month') return fmtMonth(key);
  if (grain === 'week') return long ? `Week of ${fmtDate(key)}` : fmtDateShort(key);
  return long ? fmtDate(key) : fmtDateShort(key);
}

export function NoData() {
  return (
    <Panel>
      <EmptyState
        title="No sales data yet"
        body="Import a Flipkart Sales Report workbook to see revenue, returns, SKU performance and state-wise sales. Every figure is calculated from your uploaded reports."
        action={<Button variant="primary" onClick={() => go('import')}>Go to Import Center</Button>}
      />
    </Panel>
  );
}

export function PeriodLine({ a }: { a: Analytics }) {
  const cov = a.coverage;
  return (
    <>
      {a.range ? `${fmtDate(a.range.from)} – ${fmtDate(a.range.to)} (${rangeDays(a.range.from, a.range.to)} days, both dates included)` : 'All imported data'}
      {cov && `. Imported reports cover ${fmtDate(cov.from)} – ${fmtDate(cov.to)}.`}
      {!a.range && ' Choose a date range to see each figure against the previous period.'}
      {a.prevRange && a.prevTotals && ` Compared with ${fmtDate(a.prevRange.from)} – ${fmtDate(a.prevRange.to)}${a.prevPartial ? ' (only partly covered by imported data)' : ''}.`}
    </>
  );
}

export default function OverviewPage({ a }: { a: Analytics }) {
  const unmappedCount = a.totals.unmappedRows;
  const span = a.range ?? a.coverage;
  const [grainChoice, setGrain] = useState<Grain | null>(null);
  const grain = grainChoice ?? defaultGrain(span ? rangeDays(span.from, span.to) : 30);
  const policy = a.settings.cancellationPolicy;
  const mode = useStore((s) => s.mode);

  const series = useMemo(() => {
    return timeSeries(a.period, grain, policy, a.span).map((g) => ({
      key: g.key,
      gross: g.grossSalesValue,
      net: g.netSalesValue,
      returns: g.returnValue,
      cancel: g.cancellationValue,
      sold: g.grossSoldUnits,
      returned: g.returnedUnits,
      cancelledUnits: g.cancelledUnits,
    }));
  }, [a.period, a.span, grain, policy]);

  const kpis = useMemo(() => buildKpis(a), [a]);
  if (!a.hasData) return <NoData />;

  const tick = (k: string) => bucketLabel(k, grain);
  const long = (k: string) => bucketLabel(k, grain, true);
  const withSales = a.skuRows.filter((r) => r.netSalesValue > 0);
  const topRevenue = [...withSales].sort((x, y) => y.netSalesValue - x.netSalesValue).slice(0, 10);
  const topUnits = [...a.skuRows].filter((r) => r.grossSoldUnits > 0).sort((x, y) => y.grossSoldUnits - x.grossSoldUnits).slice(0, 10);
  const minUnits = a.settings.highReturnMinUnits;
  const topReturnRate = a.skuRows
    .filter((r) => r.returnUnitRatePct !== null && r.grossSoldUnits >= minUnits && r.returnedUnits > 0)
    .sort((x, y) => y.returnUnitRatePct! - x.returnUnitRatePct!)
    .slice(0, 10);
  const states = [...a.byState].filter((s) => s.netSalesValue > 0).sort((x, y) => y.netSalesValue - x.netSalesValue);
  const platforms = [...a.byPlatform].sort((x, y) => y.netSalesValue - x.netSalesValue);

  const attention = {
    highReturn: a.skuRows.filter((r) => r.classes.includes('HIGH_RETURN')).sort((x, y) => y.returnValue - x.returnValue),
    declining: a.skuRows.filter((r) => r.classes.includes('DECLINING')).sort((x, y) => (x.movement?.trendPct ?? 0) - (y.movement?.trendPct ?? 0)),
    noRecent: a.skuRows.filter((r) => r.classes.includes('NO_RECENT_SALES')),
    loss: a.skuRows.filter((r) => r.classes.includes('LOSS_MAKING')).sort((x, y) => (x.profit.contributionProfit ?? 0) - (y.profit.contributionProfit ?? 0)),
  };

  // SKU profitability distribution (only SKUs with complete cost data).
  const costed = a.skuRows.filter((r) => r.profit.available && r.profit.grossMarginPct !== null);
  const bands: [string, (m: number) => boolean][] = [
    ['Below 0%', (m) => m < 0], ['0–10%', (m) => m >= 0 && m < 10], ['10–20%', (m) => m >= 10 && m < 20],
    ['20–30%', (m) => m >= 20 && m < 30], ['30–40%', (m) => m >= 30 && m < 40], ['40% and above', (m) => m >= 40],
  ];
  const dist = bands.map(([label, test]) => ({ key: label, count: costed.filter((r) => test(r.profit.grossMarginPct!)).length }));

  const grainControl = (
    <Segmented label="Time grain" value={grain} onChange={setGrain} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
  );
  const noPeriod = a.period.length === 0 ? { title: 'No transactions match the current filters', body: 'Widen the date range or clear a filter.' } : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Overview" lead={<PeriodLine a={a} />} />

      {mode === 'local' && (
        <Notice tone="warn">
          Data is stored only in this browser and is lost if site data is cleared.{' '}
          <a href="#/settings" className="font-medium underline">Connect your Google Spreadsheet</a> to save everything there.
        </Notice>
      )}
      {unmappedCount > 0 && (
        <Notice tone="warn">
          <strong className="font-medium">{fmtInt(unmappedCount)} transaction(s) have an unmapped event type</strong> (raw value {fmtINR(a.totals.unmappedValue)}) and are left out of every figure below.{' '}
          <a href="#/settings" className="font-medium underline">Map them in Settings</a>.
        </Notice>
      )}

      <KpiGrid kpis={kpis} hasRange={!!a.range} />

      <Panel
        title="Needs attention"
        subtitle="Rule-based flags. Thresholds are set in Settings; hover a SKU in SKU Analytics to see why it was flagged."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ['High return rate', attention.highReturn, (r) => `${fmtPct(r.returnUnitRatePct)} of ${fmtInt(r.grossSoldUnits)} units`, 'warn'],
            ['Declining sales', attention.declining, (r) => `${fmtPct(r.movement?.trendPct ?? null)} vs prior ${a.settings.decliningWindowDays} days`, 'warn'],
            ['No recent sales', attention.noRecent, (r) => `Last sale ${r.movement?.lastSaleDate ? fmtDate(r.movement.lastSaleDate) : 'never'}`, 'neutral'],
            ['Loss-making', attention.loss, (r) => fmtINR(r.profit.contributionProfit), 'bad'],
          ] as [string, typeof a.skuRows, (r: (typeof a.skuRows)[number]) => string, 'warn' | 'neutral' | 'bad'][]).map(([title, rows, detail, tone]) => (
            <div key={title} className="min-w-0">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink">
                {title} <Badge tone={rows.length ? tone : 'neutral'}>{rows.length}</Badge>
              </p>
              {title === 'Loss-making' && a.profit.costedSkuCount === 0 ? (
                <p className="text-xs leading-snug text-ink-3">{a.profit.total.reason}</p>
              ) : rows.length === 0 ? (
                <p className="text-xs text-ink-3">
                  {(title === 'No recent sales' || title === 'Declining sales') && a.asOfBeyondCoverage
                    ? 'Not assessed: the reporting date is after the last imported transaction. See Product Movement.'
                    : 'None in this selection.'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {rows.slice(0, 5).map((r) => (
                    <li key={r.key} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-ink" title={r.sku}>{r.sku}</span>
                      <span className="num shrink-0 text-ink-2">{detail(r)}</span>
                    </li>
                  ))}
                  {rows.length > 5 && <li className="text-xs text-ink-3">and {rows.length - 5} more in SKU Analytics</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Sales trend" controls={grainControl} empty={noPeriod}
          info="Gross Sales Value and Net Sales Value per period, by Buyer Invoice Date. Returns are counted on the date of the return."
          table={{ headers: ['Period', 'Gross sales', 'Net sales'], rows: series.map((d) => [long(d.key), fmtINR(d.gross), fmtINR(d.net)]) }}
        >
          <TrendChart data={series} series={[{ key: 'gross', name: 'Gross Sales Value', color: SERIES.sales }, { key: 'net', name: 'Net Sales Value', color: SERIES.net }]} format={fmtINR} axisFormat={fmtINRCompact} tickFormat={tick} labelFormat={long} />
        </ChartCard>

        <ChartCard
          title="Gross Sales Value vs Return Value" controls={grainControl} empty={noPeriod}
          info="Sale value and return value side by side for each period. Return Value is shown as a positive amount."
          table={{ headers: ['Period', 'Gross sales', 'Return value'], rows: series.map((d) => [long(d.key), fmtINR(d.gross), fmtINR(d.returns)]) }}
        >
          <TrendChart kind={series.length > 45 ? 'line' : 'bar'} data={series} series={[{ key: 'gross', name: 'Gross Sales Value', color: SERIES.sales }, { key: 'returns', name: 'Return Value', color: SERIES.returns }]} format={fmtINR} axisFormat={fmtINRCompact} tickFormat={tick} labelFormat={long} />
        </ChartCard>

        <ChartCard
          title="Sold and returned units" controls={grainControl} empty={noPeriod}
          info="Gross Sold Units and Returned Units per period, by transaction date."
          table={{ headers: ['Period', 'Sold units', 'Returned units'], rows: series.map((d) => [long(d.key), fmtInt(d.sold), fmtInt(d.returned)]) }}
        >
          <TrendChart data={series} series={[{ key: 'sold', name: 'Gross Sold Units', color: SERIES.sales }, { key: 'returned', name: 'Returned Units', color: SERIES.returns }]} format={fmtInt} axisFormat={fmtCompact} tickFormat={tick} labelFormat={long} />
        </ChartCard>

        <ChartCard
          title="Cancellations" controls={grainControl}
          subtitle={policy === 'reversal' ? 'Subtracted from Net Sales (reversal policy)' : 'Reported separately; not subtracted from Net Sales'}
          info="Cancellation Value per period: the absolute taxable value of transactions classified as Cancellation."
          empty={noPeriod ?? (a.totals.cancellationRows === 0 ? { title: 'No cancellations in this selection' } : null)}
          table={{ headers: ['Period', 'Cancellation value', 'Cancelled units'], rows: series.map((d) => [long(d.key), fmtINR(d.cancel), fmtInt(d.cancelledUnits)]) }}
        >
          <TrendChart kind={series.length > 45 ? 'line' : 'bar'} data={series} series={[{ key: 'cancel', name: 'Cancellation Value', color: SERIES.cancel }]} format={fmtINR} axisFormat={fmtINRCompact} tickFormat={tick} labelFormat={long} />
        </ChartCard>

        <ChartCard
          title="Top 10 SKUs by Net Sales Value" empty={topRevenue.length ? null : { title: 'No SKUs with net sales in this selection' }}
          table={{ headers: ['SKU', 'Net sales', 'Sold units'], rows: topRevenue.map((r) => [r.sku, fmtINR(r.netSalesValue), fmtInt(r.grossSoldUnits)]) }}
        >
          <RankBars name="Net Sales Value" color={SERIES.net} format={fmtINRCompact} data={topRevenue.map((r) => ({ label: r.sku, value: r.netSalesValue, note: `${fmtInt(r.grossSoldUnits)} units sold, ${fmtInt(r.returnedUnits)} returned` }))} />
        </ChartCard>

        <ChartCard
          title="Top 10 SKUs by units sold" empty={topUnits.length ? null : { title: 'No units sold in this selection' }}
          table={{ headers: ['SKU', 'Sold units', 'Net sales'], rows: topUnits.map((r) => [r.sku, fmtInt(r.grossSoldUnits), fmtINR(r.netSalesValue)]) }}
        >
          <RankBars name="Gross Sold Units" color={SERIES.sales} format={fmtInt} data={topUnits.map((r) => ({ label: r.sku, value: r.grossSoldUnits }))} />
        </ChartCard>

        <ChartCard
          title="Highest return rates"
          subtitle={`SKUs with at least ${minUnits} sold units`}
          info={`Return Unit Rate = Returned Units ÷ Gross Sold Units × 100. SKUs below the minimum of ${minUnits} sold units are left out because their rate is unreliable. Change the minimum in Settings.`}
          empty={topReturnRate.length ? null : { title: 'No SKU meets the minimum sales volume with returns' }}
          table={{ headers: ['SKU', 'Return rate', 'Returned / sold'], rows: topReturnRate.map((r) => [r.sku, fmtPct(r.returnUnitRatePct), `${fmtInt(r.returnedUnits)} / ${fmtInt(r.grossSoldUnits)}`]) }}
        >
          <RankBars name="Return unit rate" color={SERIES.returns} format={(n) => fmtPct(n)} data={topReturnRate.map((r) => ({ label: r.sku, value: r.returnUnitRatePct!, note: `${fmtInt(r.returnedUnits)} of ${fmtInt(r.grossSoldUnits)} units` }))} />
        </ChartCard>

        <ChartCard
          title="Net Sales Value by state" subtitle={states.length > 12 ? `Top 12 of ${states.length} states` : undefined}
          empty={states.length ? null : { title: 'No state sales in this selection' }}
          table={{ headers: ['State', 'Net sales', 'Sold units'], rows: states.map((s) => [s.key, fmtINR(s.netSalesValue), fmtInt(s.grossSoldUnits)]) }}
        >
          <RankBars name="Net Sales Value" color={SERIES.net} format={fmtINRCompact} data={states.slice(0, 12).map((s) => ({ label: s.key, value: s.netSalesValue }))} />
        </ChartCard>

        <ChartCard
          title="Net Sales Value by marketplace"
          table={platforms.length > 1 ? { headers: ['Marketplace', 'Net sales'], rows: platforms.map((p) => [PLATFORM_LABEL[p.key as Platform], fmtINR(p.netSalesValue)]) } : undefined}
          empty={platforms.length ? null : { title: 'No marketplace sales in this selection' }}
        >
          {platforms.length === 1 ? (
            <div className="py-4">
              <p className="text-xs text-ink-2">{PLATFORM_LABEL[platforms[0].key as Platform]}</p>
              <p className="text-2xl font-semibold tracking-tight">{fmtINR(platforms[0].netSalesValue)}</p>
              <p className="mt-1 text-xs text-ink-3">Only one marketplace has imported data. Amazon, Myntra and Shopify appear here once their reports can be imported.</p>
            </div>
          ) : (
            <RankBars name="Net Sales Value" color={SERIES.net} format={fmtINRCompact} data={platforms.map((p) => ({ label: PLATFORM_LABEL[p.key as Platform], value: p.netSalesValue }))} />
          )}
        </ChartCard>

        <ChartCard
          title="SKU profitability distribution"
          subtitle={costed.length ? `${costed.length} SKU(s) with complete cost data, by gross margin` : undefined}
          info="Number of SKUs in each gross margin band. Gross Margin % = Gross Profit ÷ Net Sales Value × 100. Only SKUs with complete cost data are counted."
          empty={costed.length ? null : { title: a.profit.total.reason || 'Profitability unavailable — product cost data required.', body: 'Add unit costs in Product Cost Master to see how SKUs spread across margin bands.' }}
          table={{ headers: ['Gross margin', 'SKUs'], rows: dist.map((d) => [d.key, d.count]) }}
        >
          <TrendChart kind="bar" data={dist} series={[{ key: 'count', name: 'SKUs', color: SERIES.net }]} format={fmtInt} axisFormat={fmtCompact} />
          {dist[0].count > 0 && (
            <p className="mt-1 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} /> {dist[0].count} SKU(s) have a negative gross margin.</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
