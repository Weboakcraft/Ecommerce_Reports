/**
 * A small in-memory stand-in for the Google Apps Script services used by
 * apps-script/Code.gs, so the backend's LOGIC can be exercised in Node.
 * It mimics the documented behaviour that matters here (1-based ranges,
 * getLastRow, plain-text formats keeping text literal). It cannot prove the
 * script runs on Google's servers — that is checked in the deployment smoke test.
 */
import { readFileSync } from 'node:fs';

class MockRange {
  constructor(private sheet: MockSheet, private r: number, private c: number, private nr: number, private nc: number) {}
  getValues(): unknown[][] {
    const out: unknown[][] = [];
    for (let i = 0; i < this.nr; i++) {
      const row: unknown[] = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.cells[this.r - 1 + i]?.[this.c - 1 + j] ?? '');
      out.push(row);
    }
    return out;
  }
  setValues(values: unknown[][]) {
    if (values.length !== this.nr || values.some((v) => v.length !== this.nc)) throw new Error('setValues: dimensions do not match the range');
    for (let i = 0; i < this.nr; i++) {
      for (let j = 0; j < this.nc; j++) {
        const fmt = this.sheet.formats[this.r - 1 + i]?.[this.c - 1 + j];
        let v = values[i][j];
        if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
        if (typeof v === 'string' && v.startsWith('=') && fmt !== '@') throw new Error('MOCK: a formula would have been evaluated');
        // Sheets consumes one leading apostrophe as a text marker.
        if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
        // In a number-formatted cell a numeric string becomes a number; in a text cell a number is shown as text.
        if (fmt === '@' && typeof v === 'number') v = String(v);
        this.sheet.ensure(this.r + i, this.c + j);
        this.sheet.cells[this.r - 1 + i][this.c - 1 + j] = v;
      }
    }
    return this;
  }
  setValue(v: unknown) {
    return this.setValues([[v]]);
  }
  setNumberFormats(f: string[][]) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      this.sheet.ensureFmt(this.r + i, this.c + j);
      this.sheet.formats[this.r - 1 + i][this.c - 1 + j] = f[i][j];
    }
    return this;
  }
  setNumberFormat(f: string) {
    return this.setNumberFormats(Array.from({ length: this.nr }, () => Array.from({ length: this.nc }, () => f)));
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      if (this.sheet.cells[this.r - 1 + i]) this.sheet.cells[this.r - 1 + i][this.c - 1 + j] = '';
    }
    return this;
  }
  setFontWeight() {
    return this;
  }
}

class MockSheet {
  cells: unknown[][] = [];
  formats: string[][] = [];
  maxRows = 1000;
  maxCols = 26;
  constructor(public name: string) {}
  ensure(r: number, c: number) {
    while (this.cells.length < r) this.cells.push([]);
    while (this.cells[r - 1].length < c) this.cells[r - 1].push('');
  }
  ensureFmt(r: number, c: number) {
    while (this.formats.length < r) this.formats.push([]);
    while (this.formats[r - 1].length < c) this.formats[r - 1].push('');
  }
  getRange(r: number, c: number, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`getRange: invalid range ${r},${c},${nr},${nc}`);
    if (r + nr - 1 > this.maxRows || c + nc - 1 > this.maxCols) throw new Error('getRange: outside sheet dimensions');
    return new MockRange(this, r, c, nr, nc);
  }
  getLastRow() {
    for (let i = this.cells.length - 1; i >= 0; i--) if (this.cells[i].some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after: number, n: number) { this.maxRows += n; }
  insertColumnsAfter(_after: number, n: number) { this.maxCols += n; }
  setFrozenRows() {}
}

export function loadBackend() {
  const sheets = new Map<string, MockSheet>();
  const props = new Map<string, string>();
  let uuid = 0;
  const globals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getName: () => 'Mock Spreadsheet',
        getSheetByName: (n: string) => sheets.get(n) ?? null,
        insertSheet: (n: string) => {
          const s = new MockSheet(n);
          sheets.set(n, s);
          return s;
        },
        deleteSheet: (sheet: MockSheet) => void sheets.delete(sheet.name),
      }),
      openById: () => { throw new Error('not used'); },
      getUi: () => { throw new Error('no UI in web app context'); },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => void props.set(k, v),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
    Utilities: { getUuid: () => `0000${++uuid}-aaaa-bbbb-cccc-dddddddddddd` },
    Logger: { log() {} },
  };
  const code = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
  const names = Object.keys(globals);
  const factory = new Function(...names, `${code}\nreturn { doPost, doGet, setup, rotateToken };`);
  const api = factory(...names.map((n) => (globals as Record<string, unknown>)[n])) as {
    doPost(e: unknown): { text: string };
    doGet(): { text: string };
    setup(): void;
    rotateToken(): void;
  };
  const call = (token: string, action: string, payload: unknown = {}) =>
    JSON.parse(api.doPost({ postData: { contents: JSON.stringify({ token, action, payload }) } }).text) as {
      ok: boolean; data?: any; error?: string;
    };
  return { api, call, sheets, props };
}
