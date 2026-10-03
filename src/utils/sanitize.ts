/**
 * Spreadsheet formula-injection guard for exports. A text cell that starts with
 * = + - @ (or a tab / carriage return) can execute as a formula when the export
 * is opened. Such text is prefixed with an apostrophe. Numbers are untouched.
 */
export function safeCell<T>(v: T): T | string {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function safeRow(row: unknown[]): unknown[] {
  return row.map(safeCell);
}
