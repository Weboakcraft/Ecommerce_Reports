import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { WorkbookSource } from './types';

export class FileValidationError extends Error {}

export type FileKind = 'xlsx' | 'xls' | 'csv';

/** Identify the file by its CONTENT (magic bytes), then check it agrees with the extension. */
export function detectFileKind(bytes: Uint8Array, fileName: string): FileKind {
  if (bytes.length === 0) throw new FileValidationError('The file is empty (0 bytes).');
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    throw new FileValidationError(`Unsupported file type ".${ext}". Upload an .xlsx, .xls or .csv file.`);
  }
  if (isZip) {
    if (ext === 'csv') throw new FileValidationError('The file is named .csv but its content is an Excel workbook.');
    return 'xlsx';
  }
  if (isOle) {
    if (ext === 'csv') throw new FileValidationError('The file is named .csv but its content is an Excel workbook.');
    return 'xls';
  }
  if (ext !== 'csv') {
    throw new FileValidationError(`The file is named .${ext} but its content is not a valid Excel workbook.`);
  }
  // CSV must be text: reject obvious binary content.
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (const b of sample) {
    if (b === 0) throw new FileValidationError('The file is named .csv but contains binary data.');
  }
  return 'csv';
}

function excelSource(data: ArrayBuffer): WorkbookSource {
  let names: string[];
  try {
    names = XLSX.read(data, { type: 'array', bookSheets: true }).SheetNames;
  } catch (e) {
    throw new FileValidationError(`The workbook could not be opened: ${(e as Error).message}`);
  }
  return {
    kind: 'excel',
    sheetNames: names,
    grid(sheetName) {
      if (!sheetName) throw new FileValidationError('No sheet selected.');
      let wb: XLSX.WorkBook;
      try {
        // Only the requested sheet is parsed. Formulas, styles and HTML are not evaluated or kept.
        wb = XLSX.read(data, {
          type: 'array', sheets: [sheetName], cellDates: false, cellFormula: false, cellHTML: false,
          cellStyles: false, cellText: false,
        });
      } catch (e) {
        throw new FileValidationError(`The workbook could not be read: ${(e as Error).message}`);
      }
      const ws = wb.Sheets[sheetName];
      if (!ws) throw new FileValidationError(`Sheet "${sheetName}" could not be read.`);
      const ref = ws['!ref'];
      const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
      const date1904 = !!wb.Workbook?.WBProps?.date1904;
      const dense = (ws as unknown as { '!data'?: (XLSX.CellObject | undefined)[][] })['!data'];
      const read = (r: number, c: number): XLSX.CellObject | undefined =>
        dense ? dense[r]?.[c] : (ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined);
      return {
        kind: 'excel',
        sheetName,
        rowCount: range.e.r + 1,
        colCount: range.e.c + 1,
        date1904,
        cell(r, c) {
          const cell = read(r, c);
          if (!cell || cell.v === undefined || cell.v === null) return null;
          if (cell.t === 'e') return `#ERROR(${String(cell.w ?? cell.v)})`;
          return cell.v as unknown;
        },
      };
    },
  };
}

function csvSource(data: ArrayBuffer): WorkbookSource {
  let text = new TextDecoder('utf-8').decode(data);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, dynamicTyping: false });
  const rows = parsed.data as string[][];
  // A trailing newline yields one empty last record; drop only that artefact.
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  let cols = 0;
  for (const r of rows) if (r.length > cols) cols = r.length;
  return {
    kind: 'csv',
    sheetNames: [],
    grid() {
      return {
        kind: 'csv',
        sheetName: null,
        rowCount: rows.length,
        colCount: cols,
        date1904: false,
        cell(r, c) {
          const v = rows[r]?.[c];
          return v === undefined || v === '' ? null : v;
        },
      };
    },
  };
}

export function openSource(data: ArrayBuffer, fileName: string): WorkbookSource {
  const kind = detectFileKind(new Uint8Array(data, 0, Math.min(data.byteLength, 4096)), fileName);
  return kind === 'csv' ? csvSource(data) : excelSource(data);
}
