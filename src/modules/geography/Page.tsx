import { useMemo, useState } from 'react';
import { aggregateBy, type GroupTotals } from '../../analytics/revenue/totals';
import type { Analytics } from '../../app/analytics';
import { ChartCard, RankBars, SERIES } from '../../components/charts';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Notice, PageHeader, Panel } from '../../components/ui';
import { BLANK_STATE, normalizeState } from '../../utils/states';
import { fmtINR, fmtINRCompact, fmtInt, fmtPct } from '../../utils/format';
import { NoData, PeriodLine } from '../overview/Page';

type Metric = 'net' | 'gross' | 'returns' | 'units' | 'rate';
const METRICS: Record<Metric, { label: string; get: (g: GroupTotals) => number | null; fmt: (n: number) => string; color: string }> = {
  net: { label: 'Net Sales Value', get: (g) => g.netSalesValue, fmt: fmtINRCompact, color: SERIES.net },
  gross: { label: 'Gross Sales Value', get: (g) => g.grossSalesValue, fmt: fmtINRCompact, color: SERIES.sales },
  returns: { label: 'Return Value', get: (g) => g.returnValue, fmt: fmtINRCompact, color: SERIES.returns },
  units: { label: 'Gross Sold Units', get: (g) => g.grossSoldUnits, fmt: (n) => fmtInt(n), color: SERIES.sales },
  rate: { label: 'Return Unit Rate', get: (g) => g.returnUnitRatePct, fmt: (n) => fmtPct(n), color: SERIES.returns },
};

export default function GeographyPage({ a }: { a: Analytics }) {
  const [metric, setMetric] = useState<Metric>('net');
  const [state, setState] = useState<string>('');
  const policy = a.settings.cancellationPolicy;
  const m = METRICS[metric];

  const cols = useMemo<Column<GroupTotals>[]>(() => [
    { key: 'state', header: 'State', value: (r) => r.key, render: (r) => <span className="font-medium">{r.key}</span> },
    { key: 'gross', header: 'Gross Sales', align: 'right', value: (r) => r.grossSalesValue, render: (r) => fmtINR(r.grossSalesValue) },
    { key: 'ret', header: 'Return Value', align: 'right', value: (r) => r.returnValue, render: (r) => fmtINR(r.returnValue) },
    { key: 'net', header: 'Net Sales', align: 'right', value: (r) => r.netSalesValue, render: (r) => fmtINR(r.netSalesValue) },
    { key: 'share', header: 'Share of Net Sales', align: 'right', value: (r) => (a.totals.netSalesValue ? (r.netSalesValue / a.totals.netSalesValue) * 100 : null), render: (r) => fmtPct(a.totals.netSalesValue ? (r.netSalesValue / a.totals.netSalesValue) * 100 : null) },
    { key: 'gu', header: 'Sold Units', align: 'right', value: (r) => r.grossSoldUnits, render: (r) => fmtInt(r.grossSoldUnits) },
    { key: 'ru', header: 'Returned Units', align: 'right', value: (r) => r.returnedUnits, render: (r) => fmtInt(r.returnedUnits) },
    { key: 'rr', header: 'Return Unit Rate', align: 'right', value: (r) => r.returnUnitRatePct, render: (r) => fmtPct(r.returnUnitRatePct), info: 'Returned Units ÷ Gross Sold Units × 100.' },
    { key: 'orders', header: 'Orders', align: 'right', value: (r) => r.uniqueOrders, render: (r) => fmtInt(r.uniqueOrders) },
  ], [a.totals.netSalesValue]);

  const selected = state || [...a.byState].sort((x, y) => y.netSalesValue - x.netSalesValue)[0]?.key || '';
  const stateSkus = useMemo(
    () => aggregateBy(a.period.filter((t) => t.state === selected), (t) => t.sku, policy),
    [a.period, selected, policy],
  );
  const skuCols: Column<GroupTotals>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.key, render: (r) => <span className="font-medium">{r.key}</span> },
    { key: 'net', header: 'Net Sales', align: 'right', value: (r) => r.netSalesValue, render: (r) => fmtINR(r.netSalesValue) },
    { key: 'gu', header: 'Sold Units', align: 'right', value: (r) => r.grossSoldUnits, render: (r) => fmtInt(r.grossSoldUnits) },
    { key: 'ru', header: 'Returned Units', align: 'right', value: (r) => r.returnedUnits, render: (r) => fmtInt(r.returnedUnits) },
    { key: 'rr', header: 'Return Unit Rate', align: 'right', value: (r) => r.returnUnitRatePct, render: (r) => fmtPct(r.returnUnitRatePct) },
  ];

  const review = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of a.period) {
      if (t.state === BLANK_STATE || !normalizeState(t.rawState, a.settings.stateAliases).recognised) {
        const k = t.rawState.trim() || '(blank)';
        map.set(k, (map.get(k) ?? 0) + 1);
      }
    }
    return [...map].sort((x, y) => y[1] - x[1]);
  }, [a.period, a.settings.stateAliases]);

  if (!a.hasData) return <NoData />;
  const ranked = a.byState
    .map((g) => ({ label: g.key, value: m.get(g) }))
    .filter((d): d is { label: string; value: number } => d.value !== null && d.value > 0)
    .sort((x, y) => y.value - x.value);

  return (
    <div className="space-y-4">
      <PageHeader title="State Analytics" lead={<><PeriodLine a={a} /> State is the customer’s billing state.</>} />
      {review.length > 0 && (
        <Notice tone="warn">
          <strong className="font-medium">{review.length} state value(s) need review:</strong>{' '}
          {review.slice(0, 6).map(([k, n]) => `“${k}” (${fmtInt(n)} rows)`).join(', ')}{review.length > 6 && ` and ${review.length - 6} more`}.
          They are shown as written and were not merged into any state. <a href="#/settings" className="font-medium underline">Add an alias in Settings</a> if one is a known variant.
        </Notice>
      )}
      <ChartCard
        title={`${m.label} by state`}
        subtitle={ranked.length > 15 ? `Top 15 of ${ranked.length} states` : undefined}
        controls={
          <select aria-label="Metric" className="field h-7 w-44 text-xs" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            {(Object.keys(METRICS) as Metric[]).map((k) => <option key={k} value={k}>{METRICS[k].label}</option>)}
          </select>
        }
        empty={ranked.length ? null : { title: 'No state data in this selection' }}
        table={{ headers: ['State', m.label], rows: ranked.map((d) => [d.label, m.fmt(d.value)]) }}
      >
        <RankBars name={m.label} color={m.color} format={m.fmt} data={ranked.slice(0, 15)} />
      </ChartCard>
      <Panel title="State-wise sales" flush>
        <DataTable rows={a.byState} columns={cols} rowKey={(r) => r.key} searchText={(r) => r.key} searchPlaceholder="Search state" initialSort={{ key: 'net', dir: 'desc' }} onRowClick={(r) => setState(r.key)} />
      </Panel>
      <Panel
        title={`SKU performance in ${selected || '—'}`}
        subtitle="Select a row in the table above to change the state"
        actions={
          <select aria-label="State" className="field h-7 w-48 text-xs" value={selected} onChange={(e) => setState(e.target.value)}>
            {[...a.byState].sort((x, y) => x.key.localeCompare(y.key)).map((g) => <option key={g.key} value={g.key}>{g.key}</option>)}
          </select>
        }
        flush
      >
        <DataTable rows={stateSkus} columns={skuCols} rowKey={(r) => r.key} searchText={(r) => r.key} searchPlaceholder="Search SKU" initialSort={{ key: 'net', dir: 'desc' }} pageSize={10} />
      </Panel>
    </div>
  );
}
