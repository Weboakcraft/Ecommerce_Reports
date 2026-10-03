import type { Analytics } from '../../app/analytics';
import { change } from '../../analytics/date-ranges';
import { PROFIT_UNAVAILABLE } from '../../analytics/profitability/profit';
import { fmtINR, fmtInt, fmtPct } from '../../utils/format';

export interface Kpi {
  id: string;
  label: string;
  kind: 'money' | 'int' | 'pct';
  value: number | null;
  /** undefined = comparison does not apply to this KPI. */
  prev?: number | null;
  /** Which direction is good news, for the colour of the change indicator. */
  goodWhen: 'up' | 'down' | 'neutral';
  formula: string;
  /** Shown instead of a value when the KPI cannot be calculated. */
  unavailable?: string;
  footnote?: string;
}

export const fmtKpi = (k: Pick<Kpi, 'kind'>, v: number | null): string =>
  k.kind === 'money' ? fmtINR(v) : k.kind === 'int' ? fmtInt(v) : fmtPct(v);

export function buildKpis(a: Analytics): Kpi[] {
  const t = a.totals;
  const p = a.prevTotals;
  const reversal = a.settings.cancellationPolicy === 'reversal';
  const netFormula = reversal
    ? 'Gross Sales Value − Return Value − Cancellation Value. Cancellation policy: cancellations reverse sales already counted in Gross Sales.'
    : 'Gross Sales Value − Return Value. Cancellations are reported separately and not subtracted.';
  const growth = change(t.netSalesValue, p?.netSalesValue);

  const pr = a.profit;
  let gp: Partial<Kpi>;
  if (pr.total.available) {
    gp = { value: pr.total.grossProfit, prev: a.prevProfit?.total.available ? a.prevProfit.total.grossProfit : null };
  } else {
    gp = {
      value: null,
      unavailable: pr.total.reason || PROFIT_UNAVAILABLE,
      footnote: pr.costedSkuCount > 0
        ? `Cost data covers ${pr.costedSkuCount} of ${pr.skuCount} SKUs (${fmtPct(pr.costCoveragePct)} of net sales). Gross profit of those: ${fmtINR(pr.costedTotal.grossProfit)}.`
        : undefined,
    };
  }

  return [
    {
      id: 'gross', label: 'Gross Sales Value', kind: 'money', value: t.grossSalesValue, prev: p?.grossSalesValue ?? null, goodWhen: 'up',
      formula: 'Sum of taxable value (invoice amount minus taxes) of all transactions classified as Sale.',
    },
    {
      id: 'returns', label: 'Return Value', kind: 'money', value: t.returnValue, prev: p?.returnValue ?? null, goodWhen: 'down',
      formula: 'Sum of the absolute taxable value of all transactions classified as Return, shown as a positive amount. Counted on the return’s own invoice date.',
    },
    {
      id: 'net', label: 'Net Sales Value', kind: 'money', value: t.netSalesValue, prev: p?.netSalesValue ?? null, goodWhen: 'up',
      formula: netFormula,
      footnote: t.cancellationValue > 0 ? `Cancellation value ${fmtINR(t.cancellationValue)} ${reversal ? 'subtracted' : 'reported separately'}.` : undefined,
    },
    {
      id: 'gunits', label: 'Gross Sold Units', kind: 'int', value: t.grossSoldUnits, prev: p?.grossSoldUnits ?? null, goodWhen: 'up',
      formula: 'Sum of item quantity of all Sale transactions.',
    },
    {
      id: 'runits', label: 'Returned Units', kind: 'int', value: t.returnedUnits, prev: p?.returnedUnits ?? null, goodWhen: 'down',
      formula: 'Sum of the absolute item quantity of all Return transactions.',
    },
    {
      id: 'nunits', label: 'Net Units', kind: 'int', value: t.netUnits, prev: p?.netUnits ?? null, goodWhen: 'up',
      formula: reversal ? 'Gross Sold Units − Returned Units − Cancelled Units.' : 'Gross Sold Units − Returned Units. Cancelled units are reported separately.',
      footnote: t.cancelledUnits > 0 ? `${fmtInt(t.cancelledUnits)} cancelled unit(s).` : undefined,
    },
    {
      id: 'orders', label: 'Unique Orders', kind: 'int', value: t.uniqueOrders, prev: p?.uniqueOrders ?? null, goodWhen: 'up',
      formula: 'Number of distinct Order IDs among Sale transactions. An order with several items counts once.',
    },
    {
      id: 'items', label: 'Unique Order Items', kind: 'int', value: t.uniqueOrderItems, prev: p?.uniqueOrderItems ?? null, goodWhen: 'up',
      formula: 'Number of distinct Order Item IDs among Sale transactions.',
    },
    {
      id: 'rrate', label: 'Return Rate (units)', kind: 'pct', value: t.returnUnitRatePct, prev: p ? p.returnUnitRatePct : null, goodWhen: 'down',
      formula: 'Returned Units ÷ Gross Sold Units × 100, by transaction date. Not shown when no units were sold.',
      unavailable: t.returnUnitRatePct === null ? 'No sold units in this selection.' : undefined,
      footnote: t.returnValueRatePct !== null ? `Return value rate ${fmtPct(t.returnValueRatePct)} of gross sales value.` : undefined,
    },
    {
      id: 'growth', label: 'Net Revenue Growth', kind: 'pct', value: growth.pct, goodWhen: 'up',
      formula: '(Net Sales Value − previous-period Net Sales Value) ÷ previous-period Net Sales Value × 100. The previous period is the same length immediately before the selected range.',
      unavailable: growth.pct === null
        ? !a.range ? 'Select a date range to compare with the previous period.' : growth.note === 'Previous period was zero' ? 'Previous-period net sales were zero, so a percentage would mislead.' : 'No imported data for the previous period.'
        : undefined,
    },
    {
      id: 'gp', label: 'Gross Profit', kind: 'money', value: null, goodWhen: 'up',
      formula: 'Net Sales Value − Cost of Goods Sold, using the product cost effective on each transaction date and the configured return-cost policy. Needs cost data for every SKU in the selection.',
      ...gp,
    },
    {
      id: 'loss', label: 'Loss-Making SKUs', kind: 'int', goodWhen: 'down',
      value: pr.costedSkuCount > 0 ? pr.lossMakingSkuCount : null,
      prev: a.prevProfit && a.prevProfit.costedSkuCount > 0 ? a.prevProfit.lossMakingSkuCount : null,
      formula: 'SKUs with negative contribution profit, counted only among SKUs with complete cost data. A SKU without cost data is never counted as loss-making.',
      unavailable: pr.costedSkuCount > 0 ? undefined : pr.total.reason || PROFIT_UNAVAILABLE,
      footnote: pr.costedSkuCount > 0 && pr.costedSkuCount < pr.skuCount ? `Among ${pr.costedSkuCount} of ${pr.skuCount} SKUs with cost data.` : undefined,
    },
  ];
}
