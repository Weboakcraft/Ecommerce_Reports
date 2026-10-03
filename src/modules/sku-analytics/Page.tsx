import { useMemo, useState } from 'react';
import type { SkuRow } from '../../analytics/sku-classification';
import type { Analytics } from '../../app/analytics';
import { ClassBadges, Trend, Unavailable } from '../../components/SkuBits';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Button, Modal, Notice, PageHeader, Panel } from '../../components/ui';
import { PLATFORM_LABEL, SKU_CLASS_LABEL } from '../../types';
import { fmtDate } from '../../utils/dates';
import { fmtDec, fmtINR, fmtINR2, fmtInt, fmtPct } from '../../utils/format';
import { NoData, PeriodLine } from '../overview/Page';
import { go } from '../../app/router';

export default function SkuAnalyticsPage({ a }: { a: Analytics }) {
  const [detail, setDetail] = useState<SkuRow | null>(null);
  const s = a.settings;
  const columns = useMemo<Column<SkuRow>[]>(() => {
    const money = (key: string, header: string, get: (r: SkuRow) => number | null, info?: string): Column<SkuRow> => ({
      key, header, align: 'right', value: get, render: (r) => fmtINR(get(r)), info,
    });
    const int = (key: string, header: string, get: (r: SkuRow) => number | null, info?: string): Column<SkuRow> => ({
      key, header, align: 'right', value: get, render: (r) => fmtInt(get(r)), info,
    });
    const profitCol = (key: string, header: string, get: (r: SkuRow) => number | null, fmt: (n: number | null) => string, info: string): Column<SkuRow> => ({
      key, header, align: 'right', info,
      value: (r) => (r.profit.available ? get(r) : null),
      render: (r) => (r.profit.available ? fmt(get(r)) : <Unavailable reason={r.profit.reason} />),
    });
    return [
      { key: 'sku', header: 'SKU', value: (r) => r.sku, render: (r) => <span className="font-medium">{r.sku}</span> },
      { key: 'platform', header: 'Platform', value: (r) => PLATFORM_LABEL[r.platform] },
      money('gross', 'Gross Sales', (r) => r.grossSalesValue, 'Sum of taxable value of Sale transactions.'),
      money('ret', 'Return Value', (r) => r.returnValue, 'Absolute taxable value of Return transactions.'),
      money('net', 'Net Sales', (r) => r.netSalesValue, s.cancellationPolicy === 'reversal' ? 'Gross − Returns − Cancellations.' : 'Gross − Returns.'),
      int('gu', 'Sold Units', (r) => r.grossSoldUnits),
      int('ru', 'Returned Units', (r) => r.returnedUnits),
      int('nu', 'Net Units', (r) => r.netUnits),
      int('orders', 'Orders', (r) => r.uniqueOrders, 'Distinct Order IDs among Sale transactions.'),
      int('items', 'Order Items', (r) => r.uniqueOrderItems, 'Distinct Order Item IDs among Sale transactions.'),
      { key: 'rr', header: 'Return Rate', align: 'right', value: (r) => r.returnUnitRatePct, render: (r) => fmtPct(r.returnUnitRatePct), info: 'Returned Units ÷ Gross Sold Units × 100.' },
      { key: 'rv', header: 'Return Value %', align: 'right', value: (r) => r.returnValueRatePct, render: (r) => fmtPct(r.returnValueRatePct), info: 'Return Value ÷ Gross Sales Value × 100.' },
      { key: 'asp', header: 'Avg Value / Unit', align: 'right', value: (r) => r.avgSellingValuePerUnit, render: (r) => fmtINR2(r.avgSellingValuePerUnit), info: 'Gross Sales Value ÷ Gross Sold Units (taxable value, before returns).' },
      { key: 'arpi', header: 'Avg Revenue / Order Item', align: 'right', value: (r) => r.avgRevenuePerOrderItem, render: (r) => fmtINR2(r.avgRevenuePerOrderItem), info: 'Net Sales Value ÷ Unique Order Items.' },
      profitCol('gp', 'Gross Profit', (r) => r.profit.grossProfit, fmtINR, 'Net Sales − Cost of Goods Sold. Needs cost data for every sale date of the SKU.'),
      profitCol('cp', 'Contribution Profit', (r) => r.profit.contributionProfit, fmtINR, 'Gross Profit − allocated variable expenses (advertising, shipping, fees …).'),
      profitCol('gm', 'Gross Margin %', (r) => r.profit.grossMarginPct, (n) => fmtPct(n), 'Gross Profit ÷ Net Sales Value × 100.'),
      { key: 'last', header: 'Last Sale', value: (r) => r.movement?.lastSaleDate ?? null, render: (r) => (r.movement?.lastSaleDate ? fmtDate(r.movement.lastSaleDate) : '—'), info: 'Most recent Sale transaction on or before the reporting date.' },
      { key: 'dsl', header: 'Days Since Sale', align: 'right', value: (r) => r.movement?.daysSinceLastSale ?? null, render: (r) => fmtInt(r.movement?.daysSinceLastSale ?? null), info: `Reporting date (${fmtDate(a.asOf)}) minus last sale date.` },
      { key: 'trend', header: 'Sales Trend', value: (r) => (r.movement?.covered.trend ? r.movement.trendPct : null), render: (r) => <Trend row={r} />, info: `Gross sales value in the last ${s.decliningWindowDays} days vs the ${s.decliningWindowDays} days before, measured back from the reporting date.` },
      { key: 'class', header: 'Classification', sortable: false, value: (r) => r.classes.map((c) => SKU_CLASS_LABEL[c]).join(', '), render: (r) => <ClassBadges row={r} /> },
    ];
  }, [a.asOf, s.cancellationPolicy, s.decliningWindowDays]);

  if (!a.hasData) return <NoData />;
  return (
    <div className="space-y-3">
      <PageHeader title="SKU Analytics" lead={<PeriodLine a={a} />} actions={<Button onClick={() => go('reports')}>Export report</Button>} />
      {a.profit.costedSkuCount === 0 && (
        <Notice>Profitability unavailable — product cost data required. Profit columns stay empty until unit costs are added in <a href="#/costs" className="font-medium underline">Product Cost Master</a>.</Notice>
      )}
      <Panel flush>
        <DataTable
          rows={a.skuRows}
          columns={columns}
          rowKey={(r) => r.key}
          searchText={(r) => `${r.sku} ${r.canonicalProductId} ${r.classes.map((c) => SKU_CLASS_LABEL[c]).join(' ')}`}
          searchPlaceholder="Search SKU or classification"
          initialSort={{ key: 'net', dir: 'desc' }}
          onRowClick={setDetail}
          emptyTitle="No SKUs match the current filters"
        />
      </Panel>
      <p className="text-xs text-ink-3">Select a row to see why each classification was assigned. Classification thresholds are set in Settings.</p>

      {detail && (
        <Modal title={`${detail.sku} — ${PLATFORM_LABEL[detail.platform]}`} onClose={() => setDetail(null)} wide>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {([
              ['Gross Sales Value', fmtINR(detail.grossSalesValue)], ['Return Value', fmtINR(detail.returnValue)],
              ['Net Sales Value', fmtINR(detail.netSalesValue)], ['Cancellation Value', fmtINR(detail.cancellationValue)],
              ['Sold / returned / net units', `${fmtInt(detail.grossSoldUnits)} / ${fmtInt(detail.returnedUnits)} / ${fmtInt(detail.netUnits)}`],
              ['Return rate (units / value)', `${fmtPct(detail.returnUnitRatePct)} / ${fmtPct(detail.returnValueRatePct)}`],
              ['First / last sale', `${detail.movement?.firstSaleDate ? fmtDate(detail.movement.firstSaleDate) : '—'} / ${detail.movement?.lastSaleDate ? fmtDate(detail.movement.lastSaleDate) : '—'}`],
              ['Average daily units', detail.movement ? fmtDec(detail.movement.avgDailyUnits) : '—'],
              ['Gross profit', detail.profit.available ? fmtINR(detail.profit.grossProfit) : 'Unavailable'],
              ['Contribution profit', detail.profit.available ? fmtINR(detail.profit.contributionProfit) : 'Unavailable'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line py-1 text-[0.8125rem]">
                <span className="text-ink-2">{k}</span><span className="num font-medium">{v}</span>
              </div>
            ))}
          </div>
          {!detail.profit.available && <p className="mt-3 text-xs text-ink-2">{detail.profit.reason}{detail.profit.missingCostRows > 0 && ` ${detail.profit.missingCostRows} transaction(s) fall on dates with no cost record.`}</p>}
          <h3 className="mb-1 mt-4 text-xs font-semibold text-ink">Why these classifications</h3>
          {detail.classNotes.length ? (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-ink-2">{detail.classNotes.map((n) => <li key={n}>{n}</li>)}</ul>
          ) : <p className="text-xs text-ink-3">No rule-based flags apply.</p>}
          {detail.classes.includes('TOP_REVENUE') && <p className="mt-1 text-xs text-ink-2">Top revenue: in the top {s.topN} by Net Sales Value before SKU-level filters.</p>}
          {detail.classes.includes('TOP_VOLUME') && <p className="mt-1 text-xs text-ink-2">Top volume: in the top {s.topN} by Gross Sold Units before SKU-level filters.</p>}
        </Modal>
      )}
    </div>
  );
}
