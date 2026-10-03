/**
 * SYNTHETIC TEST FIXTURE — NOT REAL FLIPKART DATA.
 *
 * Generates a workbook shaped like the Flipkart "Sales Report" sheet as the
 * project brief describes it: eight fields at fixed column positions, with
 * unrelated decoy data in other columns. The event values ("Sale", "Return",
 * "Cancellation", "Return Cancellation") and the sign convention used here
 * (returns and cancellations written as negative quantity and value) are
 * ASSUMPTIONS made for testing. They have not been verified against a real
 * Flipkart export.
 */
import * as XLSX from 'xlsx';
import { FLIPKART_COLUMN_BY_KEY as COL, FLIPKART_SHEET_NAME } from '../../schemas/flipkart';

export interface FixtureRow {
  orderId?: unknown;
  orderItemId?: unknown;
  sku?: unknown;
  event?: unknown;
  qty?: unknown;
  taxable?: unknown;
  date?: unknown;
  state?: unknown;
}

export const WIDTH = 55;

const HEADERS: Record<number, string> = {
  [COL.orderId.index0]: 'Order ID',
  [COL.orderItemId.index0]: 'Order Item ID',
  [COL.sku.index0]: 'SKU',
  [COL.eventSubType.index0]: 'Event Sub Type',
  [COL.quantity.index0]: 'Item Quantity',
  [COL.taxableValue.index0]: 'Taxable Value (Final Invoice Amount -Taxes)',
  [COL.buyerInvoiceDate.index0]: 'Buyer Invoice Date',
  [COL.billingState.index0]: "Customer's Billing State",
};

/** Build the array-of-arrays for the sheet. Decoy columns hold values that would corrupt totals if read. */
export function toAoa(rows: FixtureRow[], withHeader = true): unknown[][] {
  const aoa: unknown[][] = [];
  if (withHeader) {
    const h: unknown[] = [];
    for (let c = 0; c < WIDTH; c++) h.push(HEADERS[c] ?? `Other column ${c + 1}`);
    aoa.push(h);
  }
  rows.forEach((r, i) => {
    const line: unknown[] = [];
    for (let c = 0; c < WIDTH; c++) line.push(c % 3 === 0 ? 999999 : `decoy-${i}-${c}`);
    line[COL.orderId.index0] = r.orderId ?? null;
    line[COL.orderItemId.index0] = r.orderItemId ?? null;
    line[COL.sku.index0] = r.sku ?? null;
    line[COL.eventSubType.index0] = r.event ?? null;
    line[COL.quantity.index0] = r.qty ?? null;
    line[COL.taxableValue.index0] = r.taxable ?? null;
    line[COL.buyerInvoiceDate.index0] = r.date ?? null;
    line[COL.billingState.index0] = r.state ?? null;
    aoa.push(line);
  });
  return aoa;
}

export function toWorkbookBuffer(rows: FixtureRow[], sheetName = FLIPKART_SHEET_NAME, extraSheets: string[] = []): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const n of extraSheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['unrelated']]), n);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(toAoa(rows)), sheetName);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

export function toCsvBuffer(rows: FixtureRow[]): ArrayBuffer {
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(toAoa(rows)));
  return new TextEncoder().encode(csv).buffer as ArrayBuffer;
}

/** Excel serial for a calendar date (1900 date system). */
export function serial(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* ---------- large deterministic demo dataset ---------- */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATES: [string, number][] = [
  ['Maharashtra', 16], ['Karnataka', 12], ['Uttar Pradesh', 11], ['Delhi', 9], ['Tamil Nadu', 9],
  ['Telangana', 7], ['Gujarat', 7], ['West Bengal', 6], ['Rajasthan', 5], ['Kerala', 4], ['Haryana', 4],
  ['Madhya Pradesh', 3], ['Punjab', 3], ['Bihar', 2], ['Odisha', 2],
  // formatting variants and unknown values, to exercise normalisation + the review list
  ['  maharashtra ', 1], ['TAMIL  NADU', 1], ['Jammu & Kashmir', 1], ['Orissa', 1], ['Bangalore Region', 1],
];

const PRODUCTS = [
  'OC-07-BLACK', 'OC-07-WALNUT', 'OC-07-WHITE', 'OC-11-GREY', 'OC-11-OAK', 'ST-02-NATURAL', 'ST-02-TEAK',
  'TB-21-WALNUT', 'TB-21-OAK', 'SH-05-WHITE', 'SH-05-BLACK', 'BD-30-KING', 'BD-30-QUEEN', 'CH-14-BEIGE',
  'CH-14-GREY', 'CH-14-BLUE', 'WD-08-2DOOR', 'WD-08-3DOOR', 'TV-12-OAK', 'TV-12-WENGE', 'DK-03-STUDY',
  'DK-03-OFFICE', 'RK-09-SHOE', 'RK-09-BOOK',
];

export interface DemoOptions {
  seed?: number;
  from?: [number, number, number];
  days?: number;
  ordersPerDay?: number;
}

/**
 * Deterministic demo dataset (~4 months). Includes: multi-item orders, returns
 * dated days after their sale, cancellations, an unmapped event value, a
 * high-return SKU, a declining SKU, a SKU that stops selling, blank SKUs,
 * exact duplicate rows, and a few invalid rows that must be rejected.
 */
export function demoRows(opts: DemoOptions = {}): FixtureRow[] {
  const rnd = mulberry32(opts.seed ?? 20240401);
  const [y0, m0, d0] = opts.from ?? [2026, 5, 1];
  const days = opts.days ?? 123;
  const perDay = opts.ordersPerDay ?? 26;
  const start = serial(y0, m0, d0);
  const pick = <T,>(items: [T, number][]): T => {
    const total = items.reduce((a, [, w]) => a + w, 0);
    let x = rnd() * total;
    for (const [v, w] of items) {
      x -= w;
      if (x <= 0) return v;
    }
    return items[items.length - 1][0];
  };
  const price = (sku: string) => 900 + ((sku.charCodeAt(0) * 37 + sku.charCodeAt(3) * 91 + sku.length * 53) % 60) * 85;
  const rows: (FixtureRow & { _d: number })[] = [];
  let orderSeq = 100000;
  let itemSeq = 500000;

  for (let d = 0; d < days; d++) {
    const dow = (d + 4) % 7;
    const n = Math.round(perDay * (dow >= 5 ? 1.25 : 1) * (0.85 + rnd() * 0.3));
    for (let i = 0; i < n; i++) {
      const orderId = `OD${4300000000000 + orderSeq++}`;
      const state = pick(STATES);
      const items = rnd() < 0.14 ? 2 : 1;
      for (let k = 0; k < items; k++) {
        // product weights change over time to create a declining SKU and one that stops selling
        const weights: [string, number][] = PRODUCTS.map((p, idx) => {
          let w = 10 - (idx % 7);
          if (p === 'TB-21-WALNUT') w = Math.max(0.4, 9 - d / 14);
          if (p === 'RK-09-BOOK') w = d < 70 ? 5 : 0;
          if (p === 'DK-03-OFFICE') w = 0.25;
          return [p, w];
        });
        const sku = pick(weights);
        const qty = rnd() < 0.08 ? 2 : 1;
        const value = Math.round(price(sku) * qty * (0.92 + rnd() * 0.16) * 100) / 100;
        const itemId = `${12000000000000 + itemSeq++}`;
        const skuCell = rnd() < 0.004 ? '' : rnd() < 0.5 ? `SKU:${sku}` : ` sku:${sku} `;
        rows.push({ _d: d, orderId, orderItemId: itemId, sku: skuCell, event: 'Sale', qty, taxable: value, date: start + d, state });

        const r = rnd();
        const returnRate = sku === 'CH-14-BLUE' ? 0.42 : sku === 'SH-05-WHITE' ? 0.24 : 0.07;
        if (r < 0.035) {
          rows.push({ _d: d, orderId, orderItemId: itemId, sku: skuCell, event: 'Cancellation', qty: -qty, taxable: -value, date: start + d, state });
        } else if (r < 0.035 + returnRate) {
          const lag = 4 + Math.floor(rnd() * 18);
          if (d + lag < days) {
            rows.push({ _d: d + lag, orderId, orderItemId: itemId, sku: skuCell, event: 'Return', qty: -qty, taxable: -value, date: start + d + lag, state });
            if (rnd() < 0.03) {
              rows.push({ _d: d + lag + 2, orderId, orderItemId: itemId, sku: skuCell, event: 'Return Cancellation', qty, taxable: value, date: start + Math.min(d + lag + 2, days - 1), state });
            }
          }
        }
      }
    }
  }
  rows.sort((a, b) => a._d - b._d);
  const out: FixtureRow[] = rows.map(({ _d, ...r }) => r);

  // exact duplicate rows (duplicate candidates)
  out.splice(40, 0, { ...out[39] });
  out.splice(900, 0, { ...out[899] });
  // invalid rows that must be rejected with a reason
  out.splice(15, 0, { orderId: 'OD-BAD-1', orderItemId: 'BAD-1', sku: 'SKU:OC-07-BLACK', event: 'Sale', qty: 1, taxable: 1500, date: 'not a date', state: 'Delhi' });
  out.splice(60, 0, { orderId: 'OD-BAD-2', orderItemId: 'BAD-2', sku: 'SKU:OC-07-BLACK', event: 'Sale', qty: 'two', taxable: 1500, date: start + 3, state: 'Delhi' });
  out.splice(120, 0, { orderId: 'OD-BAD-3', orderItemId: 'BAD-3', sku: 'SKU:OC-07-BLACK', event: 'Sale', qty: 1, taxable: 'N/A', date: start + 6, state: 'Delhi' });
  out.splice(200, 0, { orderId: 'OD-BAD-4', orderItemId: 'BAD-4', sku: 'SKU:OC-07-BLACK', event: 'Sale', qty: 1, taxable: 1500, date: null, state: 'Delhi' });
  // text dates in two supported formats
  out.splice(300, 0, { orderId: 'OD-TXT-1', orderItemId: 'TXT-1', sku: 'SKU:OC-11-OAK', event: 'Sale', qty: 1, taxable: 2100, date: '2026-05-20', state: 'Goa' });
  out.splice(301, 0, { orderId: 'OD-TXT-2', orderItemId: 'TXT-2', sku: 'SKU:OC-11-OAK', event: 'Sale', qty: 1, taxable: 2100, date: '21-May-2026', state: 'Goa' });
  return out;
}
