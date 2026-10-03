import type { CancellationPolicy, Totals, Transaction } from '../../types';
import { pct } from '../../utils/numbers';
import { reportingQty, reportingValue } from '../quantities';

/** Single-pass accumulator for the eight core measures plus unique counts. */
export class TotalsAcc {
  gross = 0;
  ret = 0;
  canc = 0;
  gUnits = 0;
  rUnits = 0;
  cUnits = 0;
  saleRows = 0;
  returnRows = 0;
  cancellationRows = 0;
  excludedRows = 0;
  unmappedRows = 0;
  unmappedValue = 0;
  orders = new Set<string>();
  items = new Set<string>();

  add(t: Transaction): void {
    switch (t.txnType) {
      case 'SALE':
        this.gross += reportingValue(t);
        this.gUnits += reportingQty(t);
        this.saleRows++;
        // Unique counts are scoped by platform: ids are not assumed unique across marketplaces.
        if (t.orderId) this.orders.add(`${t.platform}|${t.orderId}`);
        if (t.orderItemId) this.items.add(`${t.platform}|${t.orderItemId}`);
        break;
      case 'RETURN':
        this.ret += reportingValue(t);
        this.rUnits += reportingQty(t);
        this.returnRows++;
        break;
      case 'CANCELLATION':
        this.canc += reportingValue(t);
        this.cUnits += reportingQty(t);
        this.cancellationRows++;
        break;
      case 'EXCLUDE':
        this.excludedRows++;
        break;
      default:
        this.unmappedRows++;
        this.unmappedValue += t.rawTaxable;
    }
  }

  finalize(policy: CancellationPolicy): Totals {
    // 'separate': cancellations are reported on their own and never reduce Net Sales.
    // 'reversal': cancellation rows reverse sales already inside Gross Sales, so they
    //             are subtracted exactly once.
    const cancDeductValue = policy === 'reversal' ? this.canc : 0;
    const cancDeductUnits = policy === 'reversal' ? this.cUnits : 0;
    return {
      grossSalesValue: this.gross,
      returnValue: this.ret,
      cancellationValue: this.canc,
      netSalesValue: this.gross - this.ret - cancDeductValue,
      grossSoldUnits: this.gUnits,
      returnedUnits: this.rUnits,
      cancelledUnits: this.cUnits,
      netUnits: this.gUnits - this.rUnits - cancDeductUnits,
      uniqueOrders: this.orders.size,
      uniqueOrderItems: this.items.size,
      saleRows: this.saleRows,
      returnRows: this.returnRows,
      cancellationRows: this.cancellationRows,
      excludedRows: this.excludedRows,
      unmappedRows: this.unmappedRows,
      unmappedValue: this.unmappedValue,
      returnUnitRatePct: this.gUnits > 0 ? pct(this.rUnits, this.gUnits) : null,
      returnValueRatePct: this.gross > 0 ? pct(this.ret, this.gross) : null,
    };
  }
}

export function computeTotals(txns: Transaction[], policy: CancellationPolicy): Totals {
  const acc = new TotalsAcc();
  for (const t of txns) acc.add(t);
  return acc.finalize(policy);
}

export interface GroupTotals extends Totals {
  key: string;
}

export function aggregateBy(
  txns: Transaction[],
  keyOf: (t: Transaction) => string,
  policy: CancellationPolicy,
): GroupTotals[] {
  const map = new Map<string, TotalsAcc>();
  for (const t of txns) {
    const k = keyOf(t);
    let acc = map.get(k);
    if (!acc) {
      acc = new TotalsAcc();
      map.set(k, acc);
    }
    acc.add(t);
  }
  const out: GroupTotals[] = [];
  for (const [key, acc] of map) out.push({ key, ...acc.finalize(policy) });
  return out;
}

export const EMPTY_TOTALS: Totals = new TotalsAcc().finalize('separate');
