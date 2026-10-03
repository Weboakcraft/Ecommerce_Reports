import { useMemo } from 'react';
import type { SkuRow } from '../../analytics/sku-classification';
import type { Analytics } from '../../app/analytics';
import { go } from '../../app/router';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel } from '../../components/ui';
import { useStore } from '../../storage/store';
import { PLATFORM_LABEL } from '../../types';
import { fmtINR, fmtInt, fmtPct } from '../../utils/format';
import { NoData, PeriodLine } from '../overview/Page';

const RETURN_POLICY_TEXT = {
  resalable_full: 'Returned units are treated as resalable: their full unit cost is reversed.',
  resalable_packaging_lost: 'Returned units are treated as resalable but packaging is not recovered: unit and other direct costs are reversed, packaging cost is kept.',
  written_off: 'Returned units are treated as written off: no cost is reversed.',
};

export default function ProfitabilityPage({ a }: { a: Analytics }) {
  const costs = useStore((s) => s.costs);
  const expenses = useStore((s) => s.expenses);
  const p = a.profit;
  const t = a.totals;
  const reversal = a.settings.cancellationPolicy === 'reversal';

  const columns = useMemo<Column<SkuRow>[]>(() => {
    const when = (r: SkuRow, v: number | null) => (r.profit.available ? v : null);
    return [
      { key: 'sku', header: 'SKU', value: (r) => r.sku, render: (r) => <span className="font-medium">{r.sku}</span> },
      { key: 'platform', header: 'Platform', value: (r) => PLATFORM_LABEL[r.platform] },
      { key: 'net', header: 'Net Sales', align: 'right', value: (r) => r.netSalesValue, render: (r) => fmtINR(r.netSalesValue) },
      { key: 'units', header: 'Net Units', align: 'right', value: (r) => r.netUnits, render: (r) => fmtInt(r.netUnits) },
      { key: 'cogs', header: 'Net COGS', align: 'right', value: (r) => when(r, r.profit.cogs), render: (r) => (r.profit.available ? fmtINR(r.profit.cogs) : '—'), info: 'Cost of sold units minus the cost reversed for returns under the configured return-cost policy.' },
      { key: 'gp', header: 'Gross Profit', align: 'right', value: (r) => when(r, r.profit.grossProfit), render: (r) => (r.profit.available ? fmtINR(r.profit.grossProfit) : '—') },
      { key: 'gm', header: 'Gross Margin %', align: 'right', value: (r) => when(r, r.profit.grossMarginPct), render: (r) => (r.profit.available ? fmtPct(r.profit.grossMarginPct) : '—') },
      { key: 'exp', header: 'Variable Expenses', align: 'right', value: (r) => when(r, r.profit.allocatedExpenses), render: (r) => (r.profit.available ? fmtINR(r.profit.allocatedExpenses) : '—'), info: 'SKU-specific expenses plus a share of shared expenses, allocated by gross sales value.' },
      { key: 'cp', header: 'Contribution Profit', align: 'right', value: (r) => when(r, r.profit.contributionProfit), render: (r) => (r.profit.available ? fmtINR(r.profit.contributionProfit) : '—') },
      { key: 'cm', header: 'Contribution Margin %', align: 'right', value: (r) => when(r, r.profit.contributionMarginPct), render: (r) => (r.profit.available ? fmtPct(r.profit.contributionMarginPct) : '—') },
      {
        key: 'status', header: 'Status', value: (r) => (r.profit.available ? ((r.profit.contributionProfit ?? 0) < 0 ? 'Loss-making' : 'Profitable') : 'Cost data missing'),
        render: (r) => r.profit.available
          ? (r.profit.contributionProfit ?? 0) < 0 ? <Badge tone="bad">Loss-making</Badge> : <Badge tone="good">Profitable</Badge>
          : <Badge title={`${r.profit.reason}${r.profit.missingCostRows ? ` ${r.profit.missingCostRows} transaction(s) without a cost.` : ''}`}>Cost data missing</Badge>,
      },
    ];
  }, []);

  if (!a.hasData) return <NoData />;
  const blocked = a.profitAnalysis.blockedReason;
  const noCosts = costs.length === 0;

  const statement = (label: string, x: typeof p.total, gross: number | null, ret: number | null, canc: number | null) => (
    <table className="w-full border-collapse text-[0.8125rem]">
      <caption className="mb-1 text-left text-xs font-medium text-ink-2">{label}</caption>
      <tbody>
        {([
          gross !== null ? ['Gross Sales Value', fmtINR(gross), false] : null,
          ret !== null ? ['Less: Return Value', `− ${fmtINR(ret)}`, false] : null,
          canc !== null && reversal ? ['Less: Cancellation Value', `− ${fmtINR(canc)}`, false] : null,
          ['Net Sales Value', fmtINR(x.netSalesValue), true],
          ['Less: Net Cost of Goods Sold', `− ${fmtINR(x.cogs)}`, false],
          ['Gross Profit', fmtINR(x.grossProfit), true],
          ['Gross Margin %', fmtPct(x.grossMarginPct), false],
          ['Less: Variable expenses', `− ${fmtINR(x.allocatedExpenses)}`, false],
          ['Contribution Profit', fmtINR(x.contributionProfit), true],
          ['Contribution Margin %', fmtPct(x.contributionMarginPct), false],
        ] as ([string, string, boolean] | null)[]).filter(Boolean).map((row) => (
          <tr key={row![0]} className={row![2] ? 'border-t border-line-strong font-semibold' : ''}>
            <td className="py-1 pr-4 text-ink-2">{row![0]}</td>
            <td className="num py-1 text-right text-ink">{row![1]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Profit & Loss" lead={<PeriodLine a={a} />} actions={<Button onClick={() => go('costs')}>Manage costs</Button>} />

      {blocked ? (
        <Notice tone="warn">{blocked}</Notice>
      ) : noCosts ? (
        <Panel>
          <EmptyState
            title="Profitability unavailable — product cost data required."
            body="Marketplace reports contain sales value but no product cost. Taxable sales value is revenue, not profit, so nothing is estimated here. Add unit costs with effective dates to calculate gross profit, margins and loss-making SKUs."
            action={<Button variant="primary" onClick={() => go('costs')}>Add product costs</Button>}
          />
        </Panel>
      ) : (
        <>
          {!p.total.available && (
            <Notice tone="warn">
              <strong className="font-medium">Cost data is incomplete.</strong> {p.costedSkuCount} of {p.skuCount} SKUs have a cost for every transaction date
              {p.costCoveragePct !== null && ` (${fmtPct(p.costCoveragePct)} of net sales value)`}. A total profit for the whole selection is not shown; the statement below covers the costed SKUs only.
            </Notice>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={p.total.available ? 'Statement for this selection' : 'Statement — costed SKUs only'}
              subtitle={p.total.available ? 'Every SKU in the selection has complete cost data' : `${p.costedSkuCount} of ${p.skuCount} SKUs`}>
              {p.total.available
                ? statement('All SKUs', p.total, t.grossSalesValue, t.returnValue, t.cancellationValue)
                : p.costedSkuCount > 0
                  ? statement('SKUs with complete cost data', p.costedTotal, null, null, null)
                  : <EmptyState title="No SKU in this selection has complete cost data" body="Check the effective dates in Product Cost Master cover the transaction dates." />}
            </Panel>
            <Panel title="How this is calculated">
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
                <li>Gross Profit = Net Sales Value − Net Cost of Goods Sold. Unit cost = manufacturing + packaging + other direct cost, taken from the record effective on each transaction’s date.</li>
                <li>{RETURN_POLICY_TEXT[a.settings.returnCostPolicy]} A return uses the cost effective on the return’s own date, because the report gives no verified link to the original sale.</li>
                <li>{reversal ? 'Cancellations reverse both the sale value and its cost (reversal policy).' : 'Cancellations are reported separately and affect neither sales nor cost.'}</li>
                <li>Contribution Profit = Gross Profit − variable expenses. {expenses.length ? 'Shared expenses are split across SKUs by gross sales value and pro-rated by days.' : 'No variable expenses are recorded, so contribution profit equals gross profit.'}{a.filters.states.length > 0 && ' With a state filter active, variable expenses are left out because they cannot be attributed to a state, so contribution profit equals gross profit here.'}{!a.range && ' With no date range selected, every recorded expense counts in full.'}</li>
                <li>A SKU missing a cost for any transaction date is shown as “Cost data missing”, never as profitable or loss-making.</li>
              </ul>
              {a.profitAnalysis.unallocatedExpenses > 0 && <p className="mt-2 text-xs text-warn">{fmtINR(a.profitAnalysis.unallocatedExpenses)} of shared expenses could not be allocated (no sales in their period).</p>}
              <p className="mt-2 text-xs text-ink-2">Loss-making SKUs: <strong className="font-semibold text-ink">{p.lossMakingSkuCount}</strong> of {p.costedSkuCount} costed.</p>
            </Panel>
          </div>
        </>
      )}

      <Panel title="SKU profitability" flush>
        <DataTable
          rows={a.skuRows.filter((r) => r.saleRows + r.returnRows > 0)}
          columns={columns}
          rowKey={(r) => r.key}
          searchText={(r) => r.sku}
          searchPlaceholder="Search SKU"
          initialSort={{ key: 'net', dir: 'desc' }}
          emptyTitle="No SKUs with sales in this selection"
        />
      </Panel>
    </div>
  );
}
