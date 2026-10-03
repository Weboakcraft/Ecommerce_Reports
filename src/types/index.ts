/**
 * Canonical data model shared by every marketplace adapter.
 * Adapters convert their own report layout into `Transaction` records; the
 * analytics engine only ever sees this shape.
 */

export type Platform = 'flipkart' | 'amazon' | 'myntra' | 'shopify';

export const PLATFORMS: Platform[] = ['flipkart', 'amazon', 'myntra', 'shopify'];

export const PLATFORM_LABEL: Record<Platform, string> = {
  flipkart: 'Flipkart',
  amazon: 'Amazon',
  myntra: 'Myntra',
  shopify: 'Shopify',
};

/** Canonical transaction type. UNMAPPED = event value with no mapping rule yet. */
export type TxnType = 'SALE' | 'RETURN' | 'CANCELLATION' | 'EXCLUDE' | 'UNMAPPED';

export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  SALE: 'Sale',
  RETURN: 'Return',
  CANCELLATION: 'Cancellation',
  EXCLUDE: 'Excluded',
  UNMAPPED: 'Unmapped',
};

export interface Transaction {
  /** Deterministic id: hash(fingerprint + occurrence). Re-importing a file yields the same ids. */
  id: string;
  platform: Platform;
  /** Reporting date, ISO `YYYY-MM-DD`, in the configured reporting timezone. */
  txnDate: string;
  /** Original source value of the date cell, kept for traceability. */
  rawDate: string;
  orderId: string;
  orderItemId: string;
  /** Normalized SKU (leading `SKU:` removed, trimmed). */
  sku: string;
  rawSku: string;
  /** Source event value, trimmed. Classification is derived from the mapping table. */
  eventSubType: string;
  txnType: TxnType;
  /** Signed quantity exactly as in the source. */
  rawQty: number;
  /** Signed taxable value exactly as in the source. */
  rawTaxable: number;
  /** Normalized reporting state. */
  state: string;
  rawState: string;
  batchId: string;
  sourceFile: string;
  /** 1-based row number in the source sheet. */
  sourceRow: number;
  /** Fingerprint of the business fields; equal fingerprints are duplicate candidates. */
  fingerprint: string;
  /** 1 for the first row with this fingerprint in its file, 2 for the second, ... */
  occurrence: number;
}

export interface EventMapping {
  platform: Platform;
  /** Event value, matched after trim + case-fold. */
  eventValue: string;
  txnType: Exclude<TxnType, 'UNMAPPED'>;
  /** 'default' = shipped with the app (unverified until confirmed), 'user' = set by an administrator. */
  source: 'default' | 'user';
  updatedAt: string;
}

export interface RejectedRow {
  batchId: string;
  sourceFile: string;
  sourceRow: number;
  reasons: string[];
  /** The eight selected source cells as text, for the error report. */
  raw: Record<string, string>;
}

export interface RowWarning {
  sourceRow: number;
  code: WarningCode;
  message: string;
}

export type WarningCode =
  | 'BLANK_SKU'
  | 'BLANK_ORDER_ID'
  | 'BLANK_ORDER_ITEM_ID'
  | 'BLANK_EVENT'
  | 'BLANK_STATE'
  | 'NON_INTEGER_QTY'
  | 'UNEXPECTED_NEGATIVE'
  | 'UNMAPPED_STATE'
  | 'AMBIGUOUS_DATE'
  | 'ID_PRECISION'
  | 'SKU_FORMAT';

export interface ImportBatch {
  batchId: string;
  platform: Platform;
  fileName: string;
  /** SHA-256 of the file bytes; used to recognise the same file being uploaded again. */
  fileHash: string;
  importedAt: string;
  importedBy: string;
  sourceRows: number;
  emptyRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateInFile: number;
  duplicateExisting: number;
  unmappedEvents: string[];
  dateFrom: string;
  dateTo: string;
  grossSalesValue: number;
  returnValue: number;
  cancellationValue: number;
  grossSoldUnits: number;
  returnedUnits: number;
  /**
   * incomplete: the import was interrupted before every row was saved. Its rows
   *             count in the figures, so it is flagged until re-imported or deleted.
   */
  status: 'active' | 'incomplete' | 'deleted';
  /** Batch ids whose stored rows this file also contained (those rows were skipped, not stored twice). */
  dependsOn: string[];
}

export interface ProductCost {
  id: string;
  canonicalProductId: string;
  sku: string;
  /** 'all' applies to every marketplace unless a platform-specific record exists. */
  platform: Platform | 'all';
  effectiveFrom: string;
  /** Empty string = open-ended. Inclusive when set. */
  effectiveTo: string;
  unitCost: number;
  packagingCost: number;
  otherCost: number;
  notes: string;
  updatedBy: string;
  updatedAt: string;
}

export type ExpenseType = 'advertising' | 'shipping' | 'marketplace_fee' | 'packaging' | 'other';

export interface Expense {
  id: string;
  platform: Platform | 'all';
  /** Blank = shared expense, allocated across SKUs by gross sales value. */
  sku: string;
  type: ExpenseType;
  periodFrom: string;
  periodTo: string;
  amount: number;
  notes: string;
  updatedBy: string;
  updatedAt: string;
}

export interface SkuAlias {
  platform: Platform;
  platformSku: string;
  canonicalProductId: string;
}

export type CancellationPolicy = 'separate' | 'reversal';
export type ReturnCostPolicy = 'resalable_full' | 'resalable_packaging_lost' | 'written_off';
export type DayMonthOrder = 'DMY' | 'MDY';

export interface Settings {
  reportingTimezone: string;
  /** How ambiguous numeric text dates such as 03/04/2024 are read. */
  dayMonthOrder: DayMonthOrder;
  /** Number of header rows above the data in the Flipkart sheet. */
  flipkartHeaderRows: number;
  /**
   * separate: cancellations are reported on their own and never touch Net Sales.
   * reversal: cancellation rows reverse sales that are present in Gross Sales, so
   *           Net Sales = Gross - Returns - Cancellations.
   */
  cancellationPolicy: CancellationPolicy;
  returnCostPolicy: ReturnCostPolicy;
  /** SKU classification thresholds. */
  topN: number;
  highReturnRatePct: number;
  highReturnMinUnits: number;
  lowMovementDays: number;
  lowMovementMaxUnits: number;
  noRecentSalesDays: number;
  decliningPct: number;
  decliningWindowDays: number;
  minTxnForClassification: number;
  velocityWindowDays: number;
  /** Minimum share of return rows that must link to a sale row before the cohort view is offered. */
  cohortMinLinkagePct: number;
  /** A run of this many consecutive days with no transactions at all is treated as a period no report covers. */
  coverageGapDays: number;
  /** A return unit rate above this is flagged in the data quality report. */
  unusualReturnRatePct: number;
  maxFileSizeMb: number;
  /** User-approved state name aliases: cleaned source text (upper-case) -> canonical state. */
  stateAliases: Record<string, string>;
  userName: string;
}

export interface Filters {
  dateFrom: string;
  dateTo: string;
  datePreset: string;
  platforms: Platform[];
  skus: string[];
  txnTypes: TxnType[];
  states: string[];
  minSalesUnits: number | null;
  returnRateThresholdPct: number | null;
  profitStatus: 'all' | 'profitable' | 'loss' | 'unavailable';
  classifications: SkuClass[];
}

export type SkuClass =
  | 'TOP_REVENUE'
  | 'TOP_VOLUME'
  | 'HIGH_RETURN'
  | 'LOW_MOVEMENT'
  | 'NO_RECENT_SALES'
  | 'LOSS_MAKING'
  | 'DECLINING'
  | 'INSUFFICIENT_DATA';

export const SKU_CLASS_LABEL: Record<SkuClass, string> = {
  TOP_REVENUE: 'Top revenue',
  TOP_VOLUME: 'Top volume',
  HIGH_RETURN: 'High return',
  LOW_MOVEMENT: 'Low movement',
  NO_RECENT_SALES: 'No recent sales',
  LOSS_MAKING: 'Loss-making',
  DECLINING: 'Declining',
  INSUFFICIENT_DATA: 'Insufficient data',
};

export interface AuditEntry {
  at: string;
  user: string;
  action: string;
  detail: string;
}

/** Totals for any group of transactions. All values are reporting values (returns shown positive). */
export interface Totals {
  grossSalesValue: number;
  returnValue: number;
  cancellationValue: number;
  netSalesValue: number;
  grossSoldUnits: number;
  returnedUnits: number;
  cancelledUnits: number;
  netUnits: number;
  uniqueOrders: number;
  uniqueOrderItems: number;
  saleRows: number;
  returnRows: number;
  cancellationRows: number;
  excludedRows: number;
  unmappedRows: number;
  unmappedValue: number;
  /** Returned units / gross sold units x 100; null when the denominator is zero. */
  returnUnitRatePct: number | null;
  /** Return value / gross sales value x 100; null when the denominator is zero. */
  returnValueRatePct: number | null;
}
