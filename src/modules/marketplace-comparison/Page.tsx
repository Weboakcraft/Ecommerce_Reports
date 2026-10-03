import { useMemo } from 'react';
import { ADAPTERS } from '../../adapters';
import { aggregateBy } from '../../analytics/revenue/totals';
import type { Analytics } from '../../app/analytics';
import { ChartCard, RankBars, SERIES } from '../../components/charts';
import { Badge, Notice, PageHeader, Panel } from '../../components/ui';
import { useStore } from '../../storage/store';
import { PLATFORM_LABEL, PLATFORMS, type Platform } from '../../types';
import { fmtDate } from '../../utils/dates';
import { fmtINR, fmtINRCompact, fmtInt, fmtPct } from '../../utils/format';
import { NoData, PeriodLine } from '../overview/Page';

export default function MarketplacePage({ a }: { a: Analytics }) {
  const aliases = useStore((s) => s.aliases);
  const byPlatform = new Map(a.byPlatform.map((g) => [g.key as Platform, g]));
  const policy = a.settings.cancellationPolicy;

  // Cross-platform products: only SKUs a user has explicitly mapped to a canonical product id.
  const products = useMemo(() => {
    const idOf = new Map(aliases.map((x) => [`${x.platform}|${x.platformSku}`, x.canonicalProductId]));
    const mapped = a.period.filter((t) => idOf.has(`${t.platform}|${t.sku}`));
    const groups = aggregateBy(mapped, (t) => `${idOf.get(`${t.platform}|${t.sku}`)}\u0000${t.platform}`, policy);
    const out = new Map<string, Partial<Record<Platform, number>>>();
    for (const g of groups) {
      const [id, platform] = g.key.split('\u0000');
      out.set(id, { ...(out.get(id) ?? {}), [platform as Platform]: g.netSalesValue });
    }
    return [...out].sort((x, y) => x[0].localeCompare(y[0]));
  }, [a.period, aliases, policy]);

  if (!a.hasData) return <NoData />;
  const withData = PLATFORMS.filter((p) => byPlatform.has(p));
  const metric = (label: string, get: (p: Platform) => string) => (
    <tr key={label}>
      <th scope="row" className="td text-left font-normal text-ink-2">{label}</th>
      {PLATFORMS.map((p) => <td key={p} className="td num text-right">{byPlatform.has(p) ? get(p) : <span className="text-ink-3">—</span>}</td>)}
    </tr>
  );
  const g = (p: Platform) => byPlatform.get(p)!;

  return (
    <div className="space-y-4">
      <PageHeader title="Marketplace Comparison" lead={<PeriodLine a={a} />} />
      <Notice>
        Flipkart import is available now. Amazon, Myntra and Shopify each need their own adapter, built and validated from a real report of that marketplace, because column layouts, event names, date meaning, tax treatment and return structure differ. Until then their columns stay empty rather than estimated.
      </Notice>
      <Panel title="Side by side" flush>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th">Measure</th>
                {PLATFORMS.map((p) => (
                  <th key={p} className="th text-right">
                    {PLATFORM_LABEL[p]}{' '}
                    {ADAPTERS[p].implemented ? <Badge tone="good">Import available</Badge> : <Badge>Awaiting sample report</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metric('Imported data covers', (p) => { const c = a.coverageByPlatform.get(p); return c ? `${fmtDate(c.from)} – ${fmtDate(c.to)}` : '—'; })}
              {metric('Gross Sales Value', (p) => fmtINR(g(p).grossSalesValue))}
              {metric('Return Value', (p) => fmtINR(g(p).returnValue))}
              {metric('Cancellation Value', (p) => fmtINR(g(p).cancellationValue))}
              {metric('Net Sales Value', (p) => fmtINR(g(p).netSalesValue))}
              {metric('Share of Net Sales', (p) => fmtPct(a.totals.netSalesValue ? (g(p).netSalesValue / a.totals.netSalesValue) * 100 : null))}
              {metric('Gross Sold Units', (p) => fmtInt(g(p).grossSoldUnits))}
              {metric('Returned Units', (p) => fmtInt(g(p).returnedUnits))}
              {metric('Net Units', (p) => fmtInt(g(p).netUnits))}
              {metric('Unique Orders', (p) => fmtInt(g(p).uniqueOrders))}
              {metric('Return Unit Rate', (p) => fmtPct(g(p).returnUnitRatePct))}
              {metric('Return Value Rate', (p) => fmtPct(g(p).returnValueRatePct))}
              {metric('Net Sales per Order', (p) => fmtINR(g(p).uniqueOrders ? g(p).netSalesValue / g(p).uniqueOrders : null))}
            </tbody>
          </table>
        </div>
      </Panel>
      {withData.length > 1 && (
        <ChartCard title="Net Sales Value by marketplace" table={{ headers: ['Marketplace', 'Net sales'], rows: withData.map((p) => [PLATFORM_LABEL[p], fmtINR(g(p).netSalesValue)]) }}>
          <RankBars name="Net Sales Value" color={SERIES.net} format={fmtINRCompact} data={withData.map((p) => ({ label: PLATFORM_LABEL[p], value: g(p).netSalesValue })).sort((x, y) => y.value - x.value)} />
        </ChartCard>
      )}
      <Panel title="Same product across marketplaces" subtitle="Net Sales Value by canonical product. Only SKUs you have mapped in Settings → SKU mapping are combined; SKUs are never matched by similar names." flush={products.length > 0}>
        {products.length === 0 ? (
          <p className="text-xs text-ink-2">No SKUs are mapped to a canonical product yet. When the same product is sold under different SKUs on different marketplaces, map each SKU to one product ID in <a href="#/settings" className="font-medium underline">Settings</a>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Canonical product</th>{PLATFORMS.map((p) => <th key={p} className="th text-right">{PLATFORM_LABEL[p]}</th>)}</tr></thead>
              <tbody>
                {products.map(([id, v]) => (
                  <tr key={id}><td className="td font-medium">{id}</td>{PLATFORMS.map((p) => <td key={p} className="td num text-right">{v[p] !== undefined ? fmtINR(v[p]!) : '—'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
