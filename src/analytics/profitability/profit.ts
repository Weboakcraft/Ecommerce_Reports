import type { CancellationPolicy, Expense, ReturnCostPolicy, Transaction } from '../../types';
import { rangeDays } from '../../utils/dates';
import { pct } from '../../utils/numbers';
import { reportingQty, reportingValue } from '../quantities';
import { CostIndex, unitTotal } from './costs';

export const PROFIT_UNAVAILABLE = 'Profitability unavailable — product cost data required.';

export interface ProfitResult {
  available: boolean;
  reason: string;
  /** Rows that needed a cost record and had none effective on their date. */
  missingCostRows: number;
  costedRows: number;
  /** Net cost of goods after the configured return / cancellation reversal. */
  cogs: number;
  netSalesValue: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  allocatedExpenses: number;
  contributionProfit: number | null;
  contributionMarginPct: number | null;
}

export interface ProfitPolicy {
  cancellationPolicy: CancellationPolicy;
  returnCostPolicy: ReturnCostPolicy;
}

class ProfitAcc {
  net = 0;
  cogs = 0;
  missing = 0;
  costed = 0;
}

/**
 * Cost effect of one transaction (documented in docs/CALCULATIONS.md):
 *  SALE          + qty x (unit + packaging + other) at the cost effective on the SALE row's date
 *  RETURN        resalable_full            - qty x (unit + packaging + other)
 *                resalable_packaging_lost  - qty x (unit + other)   (packaging is not recovered)
 *                written_off               no reversal (the goods are lost)
 *  CANCELLATION  'reversal' policy: - qty x full unit cost; 'separate' policy: no effect
 * Returns use the cost effective on the RETURN row's own date because the
 * source gives no verified link to the original sale.
 */
function addTxn(acc: ProfitAcc, t: Transaction, costs: CostIndex, policy: ProfitPolicy): void {
  if (t.txnType === 'SALE') {
    acc.net += reportingValue(t);
    const c = costs.lookup(t.platform, t.sku, t.txnDate);
    if (!c) acc.missing++;
    else {
      acc.cogs += reportingQty(t) * unitTotal(c);
      acc.costed++;
    }
  } else if (t.txnType === 'RETURN') {
    acc.net -= reportingValue(t);
    if (policy.returnCostPolicy === 'written_off') return;
    const c = costs.lookup(t.platform, t.sku, t.txnDate);
    if (!c) acc.missing++;
    else {
      const per = policy.returnCostPolicy === 'resalable_full' ? unitTotal(c) : c.unitCost + c.otherCost;
      acc.cogs -= reportingQty(t) * per;
      acc.costed++;
    }
  } else if (t.txnType === 'CANCELLATION' && policy.cancellationPolicy === 'reversal') {
    acc.net -= reportingValue(t);
    const c = costs.lookup(t.platform, t.sku, t.txnDate);
    if (!c) acc.missing++;
    else {
      acc.cogs -= reportingQty(t) * unitTotal(c);
      acc.costed++;
    }
  }
}

function finish(acc: ProfitAcc, expenses: number, hasRows: boolean, blocked?: string): ProfitResult {
  const base = {
    missingCostRows: acc.missing, costedRows: acc.costed, cogs: acc.cogs, netSalesValue: acc.net,
    allocatedExpenses: expenses,
  };
  if (blocked) {
    return { ...base, available: false, reason: blocked, grossProfit: null, grossMarginPct: null, contributionProfit: null, contributionMarginPct: null };
  }
  if (acc.missing > 0 || !hasRows || acc.costed === 0) {
    return { ...base, available: false, reason: PROFIT_UNAVAILABLE, grossProfit: null, grossMarginPct: null, contributionProfit: null, contributionMarginPct: null };
  }
  const gp = acc.net - acc.cogs;
  const cp = gp - expenses;
  return {
    ...base,
    available: true,
    reason: '',
    grossProfit: gp,
    grossMarginPct: acc.net !== 0 ? pct(gp, acc.net) : null,
    contributionProfit: cp,
    contributionMarginPct: acc.net !== 0 ? pct(cp, acc.net) : null,
  };
}

export interface ProfitAnalysis {
  /** Key: `${platform}|${sku}` */
  bySku: Map<string, ProfitResult>;
  /** Shared expenses that could not be allocated (no sales in their window). */
  unallocatedExpenses: number;
  blockedReason: string;
}

export interface ProfitSummary {
  /** Whole selection: available only when every SKU in it is fully costed. */
  total: ProfitResult;
  /** Totals over SKUs with complete cost data only. */
  costedTotal: ProfitResult;
  skuCount: number;
  costedSkuCount: number;
  lossMakingSkuCount: number;
  /** Share of net sales value that belongs to fully costed SKUs. */
  costCoveragePct: number | null;
}

export interface ProfitInput {
  /** Transactions the profit is calculated for (all filters applied except transaction type). */
  txns: Transaction[];
  /**
   * Transactions used ONLY to decide each SKU's share of an expense. Pass the set
   * filtered by date and marketplace but NOT by SKU or state, so narrowing the
   * view never changes how much expense a SKU carries. Defaults to `txns`.
   */
  allocationTxns?: Transaction[];
  costs: CostIndex;
  expenses: Expense[];
  policy: ProfitPolicy;
  /** Reporting period, used to pro-rate expenses by days. null = all time: every expense counts in full. */
  range: { from: string; to: string } | null;
  /** Set when a filter makes profit meaningless (e.g. a transaction-type filter). */
  blockedReason?: string;
  /** True when a state filter is active: an expense cannot be attributed to a state, so none is applied. */
  skipExpenses?: boolean;
}

export function analyseProfit(input: ProfitInput): ProfitAnalysis {
  const { txns, costs, policy, range } = input;
  const accs = new Map<string, ProfitAcc>();
  for (const t of txns) {
    const k = `${t.platform}|${t.sku}`;
    let a = accs.get(k);
    if (!a) {
      a = new ProfitAcc();
      accs.set(k, a);
    }
    addTxn(a, t, costs, policy);
  }

  // ---- variable expenses ----
  const expBySku = new Map<string, number>();
  let unallocated = 0;
  if (!input.skipExpenses && input.expenses.length) {
    const alloc = input.allocationTxns ?? txns;
    for (const e of input.expenses) {
      if (!e.periodFrom || !e.periodTo || e.periodTo < e.periodFrom) continue;
      // Overlap of the expense period with the reporting period (the whole expense when "all time").
      const oFrom = range && range.from > e.periodFrom ? range.from : e.periodFrom;
      const oTo = range && range.to < e.periodTo ? range.to : e.periodTo;
      if (oTo < oFrom) continue;
      // Pro-rate by days so a monthly expense viewed over half the month counts half.
      const amount = (e.amount * rangeDays(oFrom, oTo)) / rangeDays(e.periodFrom, e.periodTo);
      const platformOk = (p: string) => e.platform === 'all' || e.platform === p;
      // Weights: gross sales value inside the overlap window, per (platform, SKU).
      const weights = new Map<string, number>();
      let wSum = 0;
      for (const t of alloc) {
        if (t.txnType !== 'SALE' || t.txnDate < oFrom || t.txnDate > oTo || !platformOk(t.platform)) continue;
        if (e.sku && t.sku !== e.sku) continue;
        const k = `${t.platform}|${t.sku}`;
        const v = reportingValue(t);
        weights.set(k, (weights.get(k) ?? 0) + v);
        wSum += v;
      }
      if (wSum <= 0) {
        // No sales to carry it in that window: reported as unallocated rather than spread arbitrarily.
        unallocated += amount;
        continue;
      }
      for (const [k, w] of weights) expBySku.set(k, (expBySku.get(k) ?? 0) + (amount * w) / wSum);
    }
  }

  const blocked = input.blockedReason ?? '';
  const bySku = new Map<string, ProfitResult>();
  for (const [k, a] of accs) {
    bySku.set(k, finish(a, expBySku.get(k) ?? 0, a.costed + a.missing > 0, blocked));
  }
  return { bySku, unallocatedExpenses: unallocated, blockedReason: blocked };
}

/**
 * Roll SKU results up to a selection. `keys` restricts the roll-up to the SKUs
 * that survive SKU-level filters; shared-expense allocation is NOT redone, so a
 * SKU carries the same allocated expense whichever filter is applied.
 */
export function summariseProfit(analysis: ProfitAnalysis, keys?: ReadonlySet<string>): ProfitSummary {
  const all = new ProfitAcc();
  const costed = new ProfitAcc();
  let allExp = 0;
  let costedExp = 0;
  let skuCount = 0;
  let costedSkus = 0;
  let loss = 0;
  for (const [k, r] of analysis.bySku) {
    if (keys && !keys.has(k)) continue;
    skuCount++;
    all.net += r.netSalesValue;
    all.cogs += r.cogs;
    all.missing += r.missingCostRows;
    all.costed += r.costedRows;
    allExp += r.allocatedExpenses;
    if (r.available) {
      costedSkus++;
      costed.net += r.netSalesValue;
      costed.cogs += r.cogs;
      costed.costed += r.costedRows;
      costedExp += r.allocatedExpenses;
      if ((r.contributionProfit ?? 0) < 0) loss++;
    }
  }
  const blocked = analysis.blockedReason;
  return {
    total: finish(all, allExp, all.costed + all.missing > 0, blocked),
    costedTotal: finish(costed, costedExp, costed.costed > 0, blocked),
    skuCount,
    costedSkuCount: costedSkus,
    lossMakingSkuCount: loss,
    costCoveragePct: all.net !== 0 ? pct(costed.net, all.net) : null,
  };
}
