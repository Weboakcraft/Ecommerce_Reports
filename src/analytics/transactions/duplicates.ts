import type { Transaction } from '../../types';
import { hashString } from '../../utils/hash';

/**
 * Duplicate detection.
 *
 * Fingerprint = platform + Order ID + Order Item ID + event value + reporting
 * date + SKU + raw quantity + raw taxable value. Two rows with the same
 * fingerprint agree on every business field the application reads, so they are
 * "duplicate candidates". Sharing only an Order ID, an Order Item ID or a SKU
 * never makes rows duplicates: a sale and its return, or two items of one
 * order, always have different fingerprints.
 *
 * Record id = hash(fingerprint + occurrence number within the file). Uploading
 * the same file again therefore produces exactly the same ids, which is what
 * makes re-import idempotent.
 */
export function fingerprintOf(t: {
  platform: string; orderId: string; orderItemId: string; eventSubType: string;
  txnDate: string; sku: string; rawQty: number; rawTaxable: number;
}): string {
  return [
    t.platform,
    t.orderId,
    t.orderItemId,
    t.eventSubType.trim().toLowerCase(),
    t.txnDate,
    t.sku,
    String(t.rawQty),
    t.rawTaxable.toFixed(4),
  ].join('␟');
}

/** Assign fingerprint, occurrence and deterministic id to parsed rows (in source-row order). */
export function assignIdentity(txns: Transaction[]): void {
  const seen = new Map<string, number>();
  for (const t of txns) {
    t.fingerprint = fingerprintOf(t);
    const n = (seen.get(t.fingerprint) ?? 0) + 1;
    seen.set(t.fingerprint, n);
    t.occurrence = n;
    t.id = hashString(`${t.fingerprint}#${n}`);
  }
}

export interface ImportOptions {
  /** keep_all (default): identical rows inside one file are all imported and flagged. */
  inFileDuplicates: 'keep_all' | 'keep_first';
  /** skip (default): rows whose id already exists in storage are not appended again. */
  existingDuplicates: 'skip' | 'import_anyway';
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  inFileDuplicates: 'keep_all',
  existingDuplicates: 'skip',
};

export interface ImportPlan {
  toImport: Transaction[];
  /** 2nd+ occurrences of a fingerprint inside the file. */
  duplicateInFile: Transaction[];
  /** Rows whose id is already stored (same record imported earlier). */
  duplicateExisting: Transaction[];
  /** Rows left out because of the chosen options. Never silent: always listed. */
  skipped: Transaction[];
}

export function planImport(
  parsed: Transaction[],
  existingIds: ReadonlySet<string>,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
): ImportPlan {
  const plan: ImportPlan = { toImport: [], duplicateInFile: [], duplicateExisting: [], skipped: [] };
  for (const t of parsed) {
    const inFileDup = t.occurrence > 1;
    const existing = existingIds.has(t.id);
    if (inFileDup) plan.duplicateInFile.push(t);
    if (existing) plan.duplicateExisting.push(t);

    if (inFileDup && options.inFileDuplicates === 'keep_first') {
      plan.skipped.push(t);
      continue;
    }
    if (existing) {
      if (options.existingDuplicates === 'skip') {
        plan.skipped.push(t);
        continue;
      }
      // Explicit override: store as a distinct record tied to this batch.
      plan.toImport.push({ ...t, id: hashString(`${t.fingerprint}#${t.occurrence}#${t.batchId}`) });
      continue;
    }
    plan.toImport.push(t);
  }
  return plan;
}
