import type { EventMapping, Platform, RejectedRow, RowWarning, Settings, Transaction } from '../types';

/** Minimal read-only view of a worksheet. Adapters may only read through `cell`. */
export interface SourceGrid {
  kind: 'excel' | 'csv';
  sheetName: string | null;
  /** Rows in the used range, including header rows. */
  rowCount: number;
  colCount: number;
  date1904: boolean;
  /** 0-based row and column. Returns number | string | boolean | Date | null. */
  cell(row0: number, col0: number): unknown;
}

export interface WorkbookSource {
  kind: 'excel' | 'csv';
  sheetNames: string[];
  grid(sheetName: string | null): SourceGrid;
}

export interface AdapterContext {
  settings: Settings;
  mappings: EventMapping[];
  fileName: string;
  batchId: string;
  onProgress?: (done: number, total: number) => void;
}

export interface StateReview {
  raw: string;
  shownAs: string;
  rows: number;
}

export interface ParseResult {
  platform: Platform;
  sheetName: string | null;
  /** Header text found above each selected column, shown for a visual check. Never used for logic. */
  headers: Record<string, string>;
  /** Data rows examined (excludes header rows). */
  sourceRows: number;
  /** Rows where all selected columns are blank. Counted, never silently dropped. */
  emptyRows: number;
  transactions: Transaction[];
  rejected: RejectedRow[];
  warnings: RowWarning[];
  statesForReview: StateReview[];
}

export interface StructureCheck {
  ok: boolean;
  errors: string[];
  notices: string[];
  sheetName: string | null;
}

export interface PlatformAdapter {
  platform: Platform;
  implemented: boolean;
  /** Shown in the Import Center. */
  formatDescription: string;
  checkStructure(source: WorkbookSource): StructureCheck;
  parse(source: WorkbookSource, ctx: AdapterContext): ParseResult;
}

export class AdapterNotImplementedError extends Error {}
