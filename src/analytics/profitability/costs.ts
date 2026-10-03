import type { Platform, ProductCost } from '../../types';

export const unitTotal = (c: ProductCost): number => c.unitCost + c.packagingCost + c.otherCost;

export class CostIndex {
  private bySku = new Map<string, ProductCost[]>();

  constructor(costs: ProductCost[]) {
    for (const c of costs) {
      const list = this.bySku.get(c.sku);
      if (list) list.push(c);
      else this.bySku.set(c.sku, [c]);
    }
  }

  get size(): number {
    return this.bySku.size;
  }

  hasSku(sku: string): boolean {
    return this.bySku.has(sku);
  }

  /**
   * Cost record effective on `date` for this platform + SKU.
   * A platform-specific record wins over an 'all' record. Returns undefined when
   * no record covers the date: the cost of another period is never borrowed.
   */
  lookup(platform: Platform, sku: string, date: string): ProductCost | undefined {
    const list = this.bySku.get(sku);
    if (!list) return undefined;
    let generic: ProductCost | undefined;
    for (const c of list) {
      if (date < c.effectiveFrom) continue;
      if (c.effectiveTo && date > c.effectiveTo) continue;
      if (c.platform === platform) return c;
      if (c.platform === 'all') generic = c;
    }
    return generic;
  }
}

export interface CostIssue {
  id: string;
  sku: string;
  type: 'overlap' | 'duplicate' | 'range' | 'value';
  message: string;
}

/** Validate cost records: bad ranges, negative values, duplicate and overlapping effective periods. */
export function validateCosts(costs: ProductCost[]): CostIssue[] {
  const issues: CostIssue[] = [];
  const groups = new Map<string, ProductCost[]>();
  for (const c of costs) {
    if (!c.sku) issues.push({ id: c.id, sku: c.sku, type: 'value', message: 'SKU is blank' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.effectiveFrom)) {
      issues.push({ id: c.id, sku: c.sku, type: 'range', message: 'Effective From date is missing or invalid' });
    }
    if (c.effectiveTo && c.effectiveTo < c.effectiveFrom) {
      issues.push({ id: c.id, sku: c.sku, type: 'range', message: 'Effective To is before Effective From' });
    }
    for (const [name, v] of [['Unit cost', c.unitCost], ['Packaging cost', c.packagingCost], ['Other cost', c.otherCost]] as const) {
      if (!Number.isFinite(v) || v < 0) {
        issues.push({ id: c.id, sku: c.sku, type: 'value', message: `${name} must be zero or a positive number` });
      }
    }
    const k = `${c.platform}|${c.sku}`;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.effectiveFrom === cur.effectiveFrom && prev.effectiveTo === cur.effectiveTo) {
        issues.push({ id: cur.id, sku: cur.sku, type: 'duplicate', message: `Duplicate record for ${cur.sku} starting ${cur.effectiveFrom}` });
      } else if (!prev.effectiveTo || prev.effectiveTo >= cur.effectiveFrom) {
        issues.push({
          id: cur.id, sku: cur.sku, type: 'overlap',
          message: `Overlaps the record starting ${prev.effectiveFrom}${prev.effectiveTo ? ` (ends ${prev.effectiveTo})` : ' (open-ended)'}`,
        });
      }
    }
  }
  return issues;
}
