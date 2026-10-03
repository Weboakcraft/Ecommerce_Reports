import type { EventMapping, Platform, Transaction, TxnType } from '../../types';

export const BLANK_EVENT = '(blank)';

/** Comparison key for an event value: trimmed, whitespace collapsed, case-folded. */
export function eventKey(platform: Platform, eventValue: string): string {
  return `${platform}|${eventValue.replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

export type MappingIndex = Map<string, Exclude<TxnType, 'UNMAPPED'>>;

export function buildMappingIndex(mappings: EventMapping[]): MappingIndex {
  const idx: MappingIndex = new Map();
  for (const m of mappings) idx.set(eventKey(m.platform, m.eventValue), m.txnType);
  return idx;
}

/**
 * Classification is a pure table lookup on the full event value.
 * No substring or keyword inference: an event with no rule is UNMAPPED.
 */
export function classifyEvent(platform: Platform, eventValue: string, index: MappingIndex): TxnType {
  return index.get(eventKey(platform, eventValue)) ?? 'UNMAPPED';
}

/** Re-apply the mapping table to stored transactions (after a mapping correction). */
export function reclassify(txns: Transaction[], mappings: EventMapping[]): Transaction[] {
  const idx = buildMappingIndex(mappings);
  let changed = false;
  const out = txns.map((t) => {
    const type = classifyEvent(t.platform, t.eventSubType, idx);
    if (type === t.txnType) return t;
    changed = true;
    return { ...t, txnType: type };
  });
  return changed ? out : txns;
}

export interface EventSummaryRow {
  platform: Platform;
  eventValue: string;
  txnType: TxnType;
  rows: number;
  rawQty: number;
  rawTaxable: number;
  negativeQtyRows: number;
  negativeValueRows: number;
}

/** Distinct event values with row counts and signed raw totals, for the mapping screen. */
export function summarizeEvents(txns: Transaction[]): EventSummaryRow[] {
  const map = new Map<string, EventSummaryRow>();
  for (const t of txns) {
    const k = eventKey(t.platform, t.eventSubType);
    let r = map.get(k);
    if (!r) {
      r = {
        platform: t.platform, eventValue: t.eventSubType, txnType: t.txnType,
        rows: 0, rawQty: 0, rawTaxable: 0, negativeQtyRows: 0, negativeValueRows: 0,
      };
      map.set(k, r);
    }
    r.rows++;
    r.rawQty += t.rawQty;
    r.rawTaxable += t.rawTaxable;
    if (t.rawQty < 0) r.negativeQtyRows++;
    if (t.rawTaxable < 0) r.negativeValueRows++;
  }
  return [...map.values()].sort((a, b) => b.rows - a.rows);
}
