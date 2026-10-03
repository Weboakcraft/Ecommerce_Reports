import type { Platform, Settings, Transaction } from '../../types';
import { addDays, diffDays } from '../../utils/dates';
import { pct } from '../../utils/numbers';
import { reportingQty, reportingValue } from '../quantities';

export interface Coverage {
  from: string;
  to: string;
}

/**
 * First and last transaction date per platform over ALL imported data = the span
 * the reports reach. Rows dated after `today` are ignored here (a stray future
 * date must not make the present look "covered"); they are reported as a
 * data-quality finding instead.
 */
export function coverageByPlatform(allTxns: Transaction[], today?: string): Map<Platform, Coverage> {
  const map = new Map<Platform, Coverage>();
  for (const t of allTxns) {
    if (today && t.txnDate > today) continue;
    const c = map.get(t.platform);
    if (!c) map.set(t.platform, { from: t.txnDate, to: t.txnDate });
    else {
      if (t.txnDate < c.from) c.from = t.txnDate;
      if (t.txnDate > c.to) c.to = t.txnDate;
    }
  }
  return map;
}

export function overallCoverage(allTxns: Transaction[], today?: string): Coverage | null {
  let from = '';
  let to = '';
  for (const t of allTxns) {
    if (today && t.txnDate > today) continue;
    if (!from || t.txnDate < from) from = t.txnDate;
    if (!to || t.txnDate > to) to = t.txnDate;
  }
  return from ? { from, to } : null;
}

export interface Gap extends Coverage {
  days: number;
}

/** Runs of consecutive days, inside each platform's span, on which there is no transaction of any kind. */
export function dateGaps(allTxns: Transaction[], today?: string): Map<Platform, Gap[]> {
  const days = new Map<Platform, Set<string>>();
  for (const t of allTxns) {
    let set = days.get(t.platform);
    if (!set) {
      set = new Set();
      days.set(t.platform, set);
    }
    set.add(t.txnDate);
  }
  const out = new Map<Platform, Gap[]>();
  for (const [platform, cov] of coverageByPlatform(allTxns, today)) {
    const set = days.get(platform)!;
    const span = diffDays(cov.from, cov.to);
    if (!Number.isFinite(span) || span < 0 || span > 366 * 6) continue;
    const gaps: Gap[] = [];
    let start = '';
    for (let d = cov.from; d <= cov.to; d = addDays(d, 1)) {
      if (!set.has(d)) {
        if (!start) start = d;
      } else if (start) {
        gaps.push({ from: start, to: addDays(d, -1), days: diffDays(start, d) });
        start = '';
      }
    }
    if (gaps.length) out.set(platform, gaps);
  }
  return out;
}

/**
 * Stretches treated as NOT covered by any imported report: gaps of at least
 * `minGapDays` consecutive days without a single transaction. A window that
 * touches one cannot be used to call a SKU inactive.
 */
export function coverageHoles(allTxns: Transaction[], minGapDays: number, today?: string): Map<Platform, Gap[]> {
  const out = new Map<Platform, Gap[]>();
  for (const [platform, gaps] of dateGaps(allTxns, today)) {
    const big = gaps.filter((g) => g.days >= Math.max(1, minGapDays));
    if (big.length) out.set(platform, big);
  }
  return out;
}

export interface MovementRow {
  key: string;
  platform: Platform;
  sku: string;
  firstSaleDate: string | null;
  lastSaleDate: string | null;
  /** Reporting date minus last sale date. Not a statement about inactivity unless `covered.recent`. */
  daysSinceLastSale: number | null;
  units7: number;
  units30: number;
  units90: number;
  rev30: number;
  prevRev30: number;
  revGrowthPct: number | null;
  /** Units sold in the velocity window / days in the window. */
  avgDailyUnits: number;
  unitsVelocityWindow: number;
  unitsLowMovementWindow: number;
  saleRowsNoRecentWindow: number;
  trendCur: number;
  trendPrev: number;
  trendPct: number | null;
  saleRows: number;
  /** Whether imported data fully covers each window. An uncovered window must not be read as inactivity. */
  covered: {
    w7: boolean; w30: boolean; w90: boolean; prev30: boolean; velocity: boolean;
    lowMovement: boolean; noRecent: boolean; trend: boolean;
  };
}

interface Win {
  from: string;
  to: string;
}

export function movementWindows(asOf: string, s: Settings) {
  const w = (days: number, endOffset = 0): Win => ({
    from: addDays(asOf, -(days + endOffset) + 1),
    to: addDays(asOf, -endOffset),
  });
  return {
    w7: w(7),
    w30: w(30),
    w90: w(90),
    prev30: w(30, 30),
    velocity: w(s.velocityWindowDays),
    lowMovement: w(s.lowMovementDays),
    noRecent: w(s.noRecentSalesDays),
    trendCur: w(s.decliningWindowDays),
    trendPrev: w(s.decliningWindowDays, s.decliningWindowDays),
  };
}

/**
 * Movement and velocity per (platform, SKU), measured back from the reporting
 * date `asOf` (the end of the selected date range, or today). Revenue here is
 * Gross Sales Value of Sale rows; units are Gross Sold Units.
 * `scopeTxns` must NOT be date-filtered: windows reach back before the range.
 */
export function computeMovement(
  scopeTxns: Transaction[],
  asOf: string,
  coverage: Map<Platform, Coverage>,
  s: Settings,
  holes: Map<Platform, Coverage[]> = new Map(),
): Map<string, MovementRow> {
  const win = movementWindows(asOf, s);
  const within = (d: string, w: Win) => d >= w.from && d <= w.to;
  const rows = new Map<string, MovementRow>();

  for (const t of scopeTxns) {
    if (t.txnDate > asOf) continue;
    const key = `${t.platform}|${t.sku}`;
    let r = rows.get(key);
    if (!r) {
      const cov = coverage.get(t.platform);
      const gaps = holes.get(t.platform) ?? [];
      const ok = (w: Win) =>
        !!cov && cov.from <= w.from && cov.to >= w.to && !gaps.some((g) => g.from <= w.to && g.to >= w.from);
      r = {
        key, platform: t.platform, sku: t.sku, firstSaleDate: null, lastSaleDate: null, daysSinceLastSale: null,
        units7: 0, units30: 0, units90: 0, rev30: 0, prevRev30: 0, revGrowthPct: null, avgDailyUnits: 0,
        unitsVelocityWindow: 0, unitsLowMovementWindow: 0, saleRowsNoRecentWindow: 0,
        trendCur: 0, trendPrev: 0, trendPct: null, saleRows: 0,
        covered: {
          w7: ok(win.w7), w30: ok(win.w30), w90: ok(win.w90), prev30: ok(win.w30) && ok(win.prev30),
          velocity: ok(win.velocity), lowMovement: ok(win.lowMovement), noRecent: ok(win.noRecent),
          trend: ok(win.trendCur) && ok(win.trendPrev),
        },
      };
      rows.set(key, r);
    }
    if (t.txnType !== 'SALE') continue;
    const d = t.txnDate;
    const q = reportingQty(t);
    const v = reportingValue(t);
    r.saleRows++;
    if (!r.firstSaleDate || d < r.firstSaleDate) r.firstSaleDate = d;
    if (!r.lastSaleDate || d > r.lastSaleDate) r.lastSaleDate = d;
    if (within(d, win.w7)) r.units7 += q;
    if (within(d, win.w30)) {
      r.units30 += q;
      r.rev30 += v;
    }
    if (within(d, win.w90)) r.units90 += q;
    if (within(d, win.prev30)) r.prevRev30 += v;
    if (within(d, win.velocity)) r.unitsVelocityWindow += q;
    if (within(d, win.lowMovement)) r.unitsLowMovementWindow += q;
    if (within(d, win.noRecent)) r.saleRowsNoRecentWindow++;
    if (within(d, win.trendCur)) r.trendCur += v;
    if (within(d, win.trendPrev)) r.trendPrev += v;
  }

  for (const r of rows.values()) {
    r.daysSinceLastSale = r.lastSaleDate ? diffDays(r.lastSaleDate, asOf) : null;
    r.avgDailyUnits = r.unitsVelocityWindow / s.velocityWindowDays;
    r.revGrowthPct = r.prevRev30 > 0 ? pct(r.rev30 - r.prevRev30, r.prevRev30) : null;
    r.trendPct = r.trendPrev > 0 ? pct(r.trendCur - r.trendPrev, r.trendPrev) : null;
  }
  return rows;
}
