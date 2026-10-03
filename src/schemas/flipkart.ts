/**
 * Flipkart "Sales Report" schema, version 1.
 *
 * Fields are read by POSITION, not by header text, because header wording
 * changes between report versions. Column numbers below are 1-based Excel
 * positions; `index0` is the 0-based index used when addressing cells in code.
 * These eight columns are the only source columns the application reads.
 */

export const FLIPKART_SHEET_NAME = 'Sales Report';

export interface ColumnSpec {
  key: FlipkartField;
  label: string;
  letter: string;
  /** 1-based Excel column number. */
  column: number;
  /** 0-based index. */
  index0: number;
}

export type FlipkartField =
  | 'orderId'
  | 'orderItemId'
  | 'sku'
  | 'eventSubType'
  | 'quantity'
  | 'taxableValue'
  | 'buyerInvoiceDate'
  | 'billingState';

const col = (key: FlipkartField, label: string, letter: string, column: number): ColumnSpec => ({
  key,
  label,
  letter,
  column,
  index0: column - 1,
});

export const FLIPKART_COLUMNS: ColumnSpec[] = [
  col('orderId', 'Order ID', 'B', 2),
  col('orderItemId', 'Order Item ID', 'C', 3),
  col('sku', 'SKU', 'F', 6),
  col('eventSubType', 'Event Sub Type', 'I', 9),
  col('quantity', 'Item Quantity', 'N', 14),
  col('taxableValue', 'Taxable Value (Final Invoice Amount - Taxes)', 'Y', 25),
  col('buyerInvoiceDate', 'Buyer Invoice Date', 'AT', 46),
  col('billingState', "Customer's Billing State", 'AW', 49),
];

export const FLIPKART_COLUMN_BY_KEY = Object.fromEntries(
  FLIPKART_COLUMNS.map((c) => [c.key, c]),
) as Record<FlipkartField, ColumnSpec>;

/** The sheet must reach at least this many columns for all fields to be readable. */
export const FLIPKART_MIN_COLUMNS = Math.max(...FLIPKART_COLUMNS.map((c) => c.column));
