import type { Platform, Settings, SkuAlias, SkuClass, Totals, Transaction } from '../../types';
import { pct } from '../../utils/numbers';
import type { MovementRow } from '../movement';
import type { ProfitResult } from '../profitability/profit';
import { PROFIT_UNAVAILABLE } from '../profitability/profit';
import { aggregateBy, EMPTY_TOTALS } from '../revenue/totals';

export interface SkuRow extends Totals {
  key: string;
  platform: Platform;
  sku: string;
  canonicalProductId: string;
  /** Gross Sales Value / Gross Sold Units. */
  avgSellingValuePerUnit: number | null;
  /** Net Sales Value / Unique Order Items. */
  avgRevenuePerOrderItem: number | null;
  /** This SKU's share of all Return Value in the selection. */
  returnContributionPct: number | null;
  movement: MovementRow | null;
  profit: ProfitResult;
  classes: SkuClass[];
  /** Why a class was (or could not be) assigned: shown in tooltips so rules stay transparent. */
  classNotes: string[];
}

const NO_PROFIT: ProfitResult = {
  available: false, reason: PROFIT_UNAVAILABLE, missingCostRows: 0, costedRows: 0, cogs: 0, netSalesValue: 0,
  grossProfit: null, grossMarginPct: null, allocatedExpenses: 0, contributionProfit: null, contributionMarginPct: null,
};

export interface BuildSkuRowsInput {
  periodTxns: Transaction[];
  movement: Map<string, MovementRow>;
  profitBySku: Map<string, ProfitResult>;
  settings: Settings;
  aliases: SkuAlias[];
}

/**
 * One row per (platform, SKU). SKUs that have history before the reporting date
 * but no transactions inside the selected period are still listed (with zero
 * period totals) so that "no recent sales" can actually be seen.
 */
export function buildSkuRows(input: BuildSkuRowsInput): SkuRow[] {
  const { settings: s } = input;
  const totals = new Map(
    aggregateBy(input.periodTxns, (t) => `${t.platform}|${t.sku}`, s.cancellationPolicy).map((g) => [g.key, g]),
  );
  const aliasMap = new Map(input.aliases.map((a) => [`${a.platform}|${a.platformSku}`, a.canonicalProductId]));
  const keys = new Set<string>([...totals.keys(), ...input.movement.keys()]);
  let totalReturnValue = 0;
  for (const g of totals.values()) totalReturnValue += g.returnValue;

  const rows: SkuRow[] = [];
  for (const key of keys) {
    const i = key.indexOf('|');
    const platform = key.slice(0, i) as Platform;
    const sku = key.slice(i + 1);
    const t = totals.get(key) ?? EMPTY_TOTALS;
    rows.push({
      ...t,
      key,
      platform,
      sku,
      canonicalProductId: aliasMap.get(key) ?? '',
      avgSellingValuePerUnit: t.grossSoldUnits > 0 ? t.grossSalesValue / t.grossSoldUnits : null,
      avgRevenuePerOrderItem: t.uniqueOrderItems > 0 ? t.netSalesValue / t.uniqueOrderItems : null,
      returnContributionPct: pct(t.returnValue, totalReturnValue),
      movement: input.movement.get(key) ?? null,
      profit: input.profitBySku.get(key) ?? NO_PROFIT,
      classes: [],
      classNotes: [],
    });
  }

  // ---- rank-based classes ----
  const byRevenue = rows.filter((r) => r.netSalesValue > 0).sort((a, b) => b.netSalesValue - a.netSalesValue);
  const byVolume = rows.filter((r) => r.grossSoldUnits > 0).sort((a, b) => b.grossSoldUnits - a.grossSoldUnits);
  const topRev = new Set(byRevenue.slice(0, s.topN).map((r) => r.key));
  const topVol = new Set(byVolume.slice(0, s.topN).map((r) => r.key));

  for (const r of rows) {
    const m = r.movement;
    if (topRev.has(r.key)) r.classes.push('TOP_REVENUE');
    if (topVol.has(r.key)) r.classes.push('TOP_VOLUME');

    if (
      r.returnUnitRatePct !== null &&
      r.grossSoldUnits >= s.highReturnMinUnits &&
      r.returnUnitRatePct >= s.highReturnRatePct
    ) {
      r.classes.push('HIGH_RETURN');
      r.classNotes.push(
        `High return: unit return rate ${r.returnUnitRatePct.toFixed(1)}% ≥ ${s.highReturnRatePct}% with ${r.grossSoldUnits} sold units (minimum ${s.highReturnMinUnits}).`,
      );
    }

    let insufficient = false;
    const lifetimeSaleRows = m?.saleRows ?? 0;
    if (lifetimeSaleRows < s.minTxnForClassification) {
      insufficient = true;
      r.classNotes.push(
        `Insufficient data: ${lifetimeSaleRows} sale transaction(s) up to the reporting date (minimum ${s.minTxnForClassification}).`,
      );
    }

    if (m) {
      if (!m.covered.noRecent || !m.covered.lowMovement) {
        insufficient = true;
        r.classNotes.push(
          'Imported reports do not fully cover the movement window ending on the reporting date, so inactivity cannot be judged.',
        );
      } else {
        if (m.saleRowsNoRecentWindow === 0) {
          r.classes.push('NO_RECENT_SALES');
          r.classNotes.push(`No recent sales: no Sale transaction in the ${s.noRecentSalesDays} days to the reporting date.`);
        } else if (m.unitsLowMovementWindow <= s.lowMovementMaxUnits) {
          r.classes.push('LOW_MOVEMENT');
          r.classNotes.push(
            `Low movement: ${m.unitsLowMovementWindow} unit(s) sold in ${s.lowMovementDays} days (threshold ≤ ${s.lowMovementMaxUnits}).`,
          );
        }
      }
      if (m.covered.trend) {
        if (m.trendPct !== null && m.trendPct <= -s.decliningPct) {
          r.classes.push('DECLINING');
          r.classNotes.push(
            `Declining: sales value down ${Math.abs(m.trendPct).toFixed(1)}% vs the previous ${s.decliningWindowDays} days (threshold ${s.decliningPct}%).`,
          );
        }
      } else {
        r.classNotes.push(
          `Trend not assessed: imported data does not cover two full ${s.decliningWindowDays}-day windows.`,
        );
      }
    }

    // Loss-making needs complete cost inputs. Never inferred from revenue.
    if (r.profit.available && (r.profit.contributionProfit ?? 0) < 0) {
      r.classes.push('LOSS_MAKING');
      r.classNotes.push('Loss-making: contribution profit is negative with complete cost data.');
    }

    if (insufficient) r.classes.push('INSUFFICIENT_DATA');
  }
  return rows;
}

export interface SkuLevelFilter {
  minSalesUnits: number | null;
  returnRateThresholdPct: number | null;
  profitStatus: 'all' | 'profitable' | 'loss' | 'unavailable';
  classifications: SkuClass[];
}

export function hasSkuLevelFilter(f: SkuLevelFilter): boolean {
  return (
    f.minSalesUnits !== null || f.returnRateThresholdPct !== null || f.profitStatus !== 'all' || f.classifications.length > 0
  );
}

/** SKU-level filters: keep SKUs that satisfy every active condition. */
export function filterSkuRows(rows: SkuRow[], f: SkuLevelFilter): SkuRow[] {
  if (!hasSkuLevelFilter(f)) return rows;
  const classes = new Set(f.classifications);
  return rows.filter((r) => {
    if (f.minSalesUnits !== null && r.grossSoldUnits < f.minSalesUnits) return false;
    if (f.returnRateThresholdPct !== null && (r.returnUnitRatePct === null || r.returnUnitRatePct < f.returnRateThresholdPct)) return false;
    if (f.profitStatus === 'unavailable' && r.profit.available) return false;
    if (f.profitStatus === 'profitable' && !(r.profit.available && (r.profit.contributionProfit ?? 0) >= 0)) return false;
    if (f.profitStatus === 'loss' && !(r.profit.available && (r.profit.contributionProfit ?? 0) < 0)) return false;
    if (classes.size && !r.classes.some((c) => classes.has(c))) return false;
    return true;
  });
}
