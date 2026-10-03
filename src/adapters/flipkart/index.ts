import { BLANK_EVENT, buildMappingIndex, classifyEvent } from '../../analytics/transactions/classify';
import { assignIdentity } from '../../analytics/transactions/duplicates';
import {
  FLIPKART_COLUMN_BY_KEY as COL, FLIPKART_COLUMNS, FLIPKART_MIN_COLUMNS, FLIPKART_SHEET_NAME,
} from '../../schemas/flipkart';
import type { RejectedRow, RowWarning, Transaction } from '../../types';
import { isValidISO, parseDateCell } from '../../utils/dates';
import { parseNumber } from '../../utils/numbers';
import { BLANK_SKU, normalizeSku, skuLooksDecorated } from '../../utils/sku';
import { normalizeState } from '../../utils/states';
import type { AdapterContext, ParseResult, PlatformAdapter, SourceGrid, StateReview, StructureCheck, WorkbookSource } from '../types';

/** Text of an id-like cell. Numbers are written without exponent or grouping. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v);
  }
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/** Longest text accepted in an id / SKU / event / state cell. */
const MAX_TEXT = 300;

const short = (s: string): string => (s.length > 300 ? `${s.slice(0, 300)}…` : s);

const rawText = (v: unknown): string => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v));

function checkGrid(grid: SourceGrid, headerRows: number): string[] {
  const errors: string[] = [];
  if (grid.rowCount === 0) errors.push('The sheet is empty.');
  else if (grid.rowCount <= headerRows) errors.push(`The sheet has ${grid.rowCount} row(s) and no data rows below the header.`);
  if (grid.rowCount > 0 && grid.colCount < FLIPKART_MIN_COLUMNS) {
    const missing = FLIPKART_COLUMNS.filter((c) => c.column > grid.colCount).map((c) => `${c.label} (column ${c.letter})`);
    errors.push(
      `The sheet has only ${grid.colCount} column(s); the report must reach column AW (${FLIPKART_MIN_COLUMNS}). Not accessible: ${missing.join(', ')}.`,
    );
  }
  return errors;
}

export const flipkartAdapter: PlatformAdapter = {
  platform: 'flipkart',
  implemented: true,
  formatDescription:
    `Flipkart sales workbook with a sheet named exactly "${FLIPKART_SHEET_NAME}". Eight columns are read by position: ` +
    FLIPKART_COLUMNS.map((c) => `${c.letter} ${c.label}`).join(' · ') + '. Every other column is ignored.',

  checkStructure(source: WorkbookSource): StructureCheck {
    const notices: string[] = [];
    if (source.kind === 'csv') {
      notices.push(
        `CSV files have no sheet names, so the "${FLIPKART_SHEET_NAME}" sheet check cannot be applied. The file is read as that sheet, using the same column positions.`,
      );
      return { ok: true, errors: [], notices, sheetName: null };
    }
    if (!source.sheetNames.includes(FLIPKART_SHEET_NAME)) {
      const near = source.sheetNames.find((n) => n.trim().toLowerCase() === FLIPKART_SHEET_NAME.toLowerCase());
      return {
        ok: false,
        errors: [
          `This workbook has no sheet named exactly "${FLIPKART_SHEET_NAME}". Sheets found: ${source.sheetNames.map((n) => `"${n}"`).join(', ') || 'none'}.` +
            (near ? ` "${near}" is close but does not match exactly (check spaces and letter case).` : ''),
        ],
        notices,
        sheetName: null,
      };
    }
    return { ok: true, errors: [], notices, sheetName: FLIPKART_SHEET_NAME };
  },

  parse(source: WorkbookSource, ctx: AdapterContext): ParseResult {
    const check = this.checkStructure(source);
    if (!check.ok) throw new Error(check.errors.join(' '));
    const grid = source.grid(check.sheetName);
    const headerRows = Math.max(0, ctx.settings.flipkartHeaderRows);
    const gridErrors = checkGrid(grid, headerRows);
    if (gridErrors.length) throw new Error(gridErrors.join(' '));

    const mapIdx = buildMappingIndex(ctx.mappings);
    const headers: Record<string, string> = {};
    for (const c of FLIPKART_COLUMNS) {
      headers[c.key] = headerRows > 0 ? rawText(grid.cell(headerRows - 1, c.index0)).trim() : '';
    }

    const transactions: Transaction[] = [];
    const rejected: RejectedRow[] = [];
    const warnings: RowWarning[] = [];
    const stateReview = new Map<string, StateReview>();
    let emptyRows = 0;
    const total = grid.rowCount - headerRows;
    const dateOpts = { tz: ctx.settings.reportingTimezone, order: ctx.settings.dayMonthOrder, date1904: grid.date1904 };

    for (let r = headerRows; r < grid.rowCount; r++) {
      if (ctx.onProgress && (r - headerRows) % 5000 === 0) ctx.onProgress(r - headerRows, total);
      // Only the eight approved columns are ever read.
      const vOrder = grid.cell(r, COL.orderId.index0);
      const vItem = grid.cell(r, COL.orderItemId.index0);
      const vSku = grid.cell(r, COL.sku.index0);
      const vEvent = grid.cell(r, COL.eventSubType.index0);
      const vQty = grid.cell(r, COL.quantity.index0);
      const vAmt = grid.cell(r, COL.taxableValue.index0);
      const vDate = grid.cell(r, COL.buyerInvoiceDate.index0);
      const vState = grid.cell(r, COL.billingState.index0);
      const cells = [vOrder, vItem, vSku, vEvent, vQty, vAmt, vDate, vState];
      if (cells.every((v) => v === null || (typeof v === 'string' && v.trim() === ''))) {
        emptyRows++;
        continue;
      }
      const sourceRow = r + 1;
      const reasons: string[] = [];
      const warn = (code: RowWarning['code'], message: string) => warnings.push({ sourceRow, code, message });

      const date = parseDateCell(vDate, dateOpts);
      if (!date.iso || !isValidISO(date.iso)) reasons.push(`Buyer Invoice Date (AT): ${date.error ?? 'not a valid date'}`);
      const qty = parseNumber(vQty);
      if (qty.value === null) reasons.push(`Item Quantity (N): ${qty.error}`);
      const amt = parseNumber(vAmt);
      if (amt.value === null) reasons.push(`Taxable Value (Y): ${amt.error}`);

      for (const [v, name] of [[vOrder, 'Order ID (B)'], [vItem, 'Order Item ID (C)'], [vSku, 'SKU (F)'], [vEvent, 'Event Sub Type (I)'], [vState, "Customer's Billing State (AW)"]] as const) {
        const len = rawText(v).length;
        if (len > MAX_TEXT) reasons.push(`${name}: ${len} characters is longer than any real value (limit ${MAX_TEXT}); the cell may hold pasted or corrupt content`);
      }

      if (reasons.length) {
        rejected.push({
          batchId: ctx.batchId,
          sourceFile: ctx.fileName,
          sourceRow,
          reasons,
          raw: {
            'Order ID': short(cellText(vOrder)), 'Order Item ID': short(cellText(vItem)), SKU: short(rawText(vSku)),
            'Event Sub Type': short(rawText(vEvent)), 'Item Quantity': short(rawText(vQty)), 'Taxable Value': short(rawText(vAmt)),
            'Buyer Invoice Date': short(rawText(vDate)), "Customer's Billing State": short(rawText(vState)),
          },
        });
        continue;
      }

      const orderId = cellText(vOrder);
      const orderItemId = cellText(vItem);
      const rawSku = rawText(vSku);
      let sku = normalizeSku(vSku);
      const event = rawText(vEvent).replace(/\s+/g, ' ').trim();
      const rawState = rawText(vState);
      const st = normalizeState(vState, ctx.settings.stateAliases);

      if (!orderId) warn('BLANK_ORDER_ID', 'Order ID is blank');
      if (!orderItemId) warn('BLANK_ORDER_ITEM_ID', 'Order Item ID is blank');
      for (const [v, name] of [[vOrder, 'Order ID'], [vItem, 'Order Item ID']] as const) {
        if (typeof v === 'number' && Math.abs(v) > Number.MAX_SAFE_INTEGER) {
          warn('ID_PRECISION', `${name} is stored as a number larger than Excel can hold exactly; trailing digits may already be lost in the source file`);
        }
      }
      if (!sku) {
        warn('BLANK_SKU', 'SKU is blank');
        sku = BLANK_SKU;
      } else if (skuLooksDecorated(sku)) {
        warn('SKU_FORMAT', `SKU "${sku}" still contains quotes or an inner "SKU:"; only an exact leading "SKU:" prefix is removed`);
      }
      if (!event) warn('BLANK_EVENT', 'Event Sub Type is blank');
      if (!Number.isInteger(qty.value!)) warn('NON_INTEGER_QTY', `Quantity ${qty.value} is not a whole number`);
      if (date.ambiguous) warn('AMBIGUOUS_DATE', `Date "${rawText(vDate)}" could be day/month or month/day; read as ${ctx.settings.dayMonthOrder}`);
      if (!st.recognised) {
        const k = rawState.trim() || '(blank)';
        const e = stateReview.get(k);
        if (e) e.rows++;
        else stateReview.set(k, { raw: k, shownAs: st.state, rows: 1 });
      }

      const eventValue = event || BLANK_EVENT;
      transactions.push({
        id: '',
        platform: 'flipkart',
        txnDate: date.iso!,
        rawDate: rawText(vDate),
        orderId,
        orderItemId,
        sku,
        rawSku,
        eventSubType: eventValue,
        txnType: classifyEvent('flipkart', eventValue, mapIdx),
        rawQty: qty.value!,
        rawTaxable: amt.value!,
        state: st.state,
        rawState,
        batchId: ctx.batchId,
        sourceFile: ctx.fileName,
        sourceRow,
        fingerprint: '',
        occurrence: 0,
      });
    }
    ctx.onProgress?.(total, total);
    assignIdentity(transactions);

    return {
      platform: 'flipkart',
      sheetName: check.sheetName,
      headers,
      sourceRows: total,
      emptyRows,
      transactions,
      rejected,
      warnings,
      statesForReview: [...stateReview.values()].sort((a, b) => b.rows - a.rows),
    };
  },
};
