import type { DayMonthOrder } from '../types';

export interface ParsedDate {
  /** ISO YYYY-MM-DD in the reporting timezone, or null when invalid. */
  iso: string | null;
  /** True when a numeric text date could be read as either D/M or M/D. */
  ambiguous?: boolean;
  error?: string;
}

const MS_DAY = 86400000;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validYMD(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Excel serial -> calendar date. Excel serials are wall-clock values with no
 * timezone, so the calendar date is taken as-is. The fractional part (time of
 * day) is dropped.
 */
export function excelSerialToISO(serial: number, date1904 = false): ParsedDate {
  if (!Number.isFinite(serial)) return { iso: null, error: 'not a date' };
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  const dt = new Date(Date.UTC(1899, 11, 30) + days * MS_DAY);
  const y = dt.getUTCFullYear();
  // `!(a && b)` rather than `y < 2000 || y > 2100`: an out-of-range serial gives an invalid Date and y = NaN.
  if (!(y >= 2000 && y <= 2100)) {
    return { iso: null, error: `numeric date ${serial} is outside 2000-2100` };
  }
  return { iso: toISO(y, dt.getUTCMonth() + 1, dt.getUTCDate()) };
}

/** Calendar date of an absolute instant in an IANA timezone. */
export function instantToISOInTz(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function todayInTz(tz: string, now: Date = new Date()): string {
  return instantToISOInTz(now, tz);
}

const TIME = String.raw`(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(am|pm)?)?`;
const OFFSET = String.raw`\s*(Z|[+-]\d{2}:?\d{2})?`;
const RE_ISO = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}${OFFSET}$`, 'i');
const RE_NUM = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${TIME}${OFFSET}$`, 'i');
const RE_DMON = new RegExp(String.raw`^(\d{1,2})[-/.\s]+([a-z]{3,9})[-/.,\s]+(\d{4}|\d{2})${TIME}${OFFSET}$`, 'i');
const RE_MOND = new RegExp(String.raw`^([a-z]{3,9})[-/.\s]+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})${TIME}${OFFSET}$`, 'i');

function finish(
  y: number,
  m: number,
  d: number,
  time: (string | undefined)[],
  offset: string | undefined,
  tz: string,
): ParsedDate {
  if (!validYMD(y, m, d)) return { iso: null, error: 'not a valid calendar date (2000-2100)' };
  if (!offset) return { iso: toISO(y, m, d) }; // naive value = wall-clock in the reporting timezone
  let hh = Number(time[0] ?? 0);
  const mi = Number(time[1] ?? 0);
  const ss = Number(time[2] ?? 0);
  const ap = time[3]?.toLowerCase();
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  let offMin = 0;
  if (offset.toUpperCase() !== 'Z') {
    const sign = offset[0] === '-' ? -1 : 1;
    const digits = offset.slice(1).replace(':', '');
    offMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  const utcMs = Date.UTC(y, m - 1, d, hh, mi, ss) - offMin * 60000;
  return { iso: instantToISOInTz(new Date(utcMs), tz) };
}

/**
 * Parse a text date. Supported:
 *   2024-03-05, 2024/03/05, 2024-03-05 14:30:00, 2024-03-05T14:30:00+05:30, ...Z
 *   05-03-2024, 05/03/2024, 05.03.2024 (day/month order from settings)
 *   05-Mar-2024, 5 March 2024, 05-Mar-24, Mar 5, 2024
 * A value with an explicit UTC offset is converted to the reporting timezone.
 * A value without one is treated as a wall-clock date in the reporting timezone.
 */
export function parseTextDate(text: string, tz: string, order: DayMonthOrder = 'DMY'): ParsedDate {
  const s = text.trim().replace(/\s+/g, ' ');
  if (s === '') return { iso: null, error: 'blank date' };
  let m = RE_ISO.exec(s);
  if (m) return finish(+m[1], +m[2], +m[3], m.slice(4, 8), m[8], tz);
  m = RE_NUM.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const [d, mo] = order === 'DMY' ? [a, b] : [b, a];
    const res = finish(+m[3], mo, d, m.slice(4, 8), m[8], tz);
    if (res.iso && a <= 12 && b <= 12 && a !== b) res.ambiguous = true;
    if (!res.iso) res.error = `"${s}" is not a valid ${order === 'DMY' ? 'day/month/year' : 'month/day/year'} date`;
    return res;
  }
  m = RE_DMON.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return { iso: null, error: `unknown month "${m[2]}"` };
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return finish(y, mo, +m[1], m.slice(4, 8), m[8], tz);
  }
  m = RE_MOND.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return { iso: null, error: `unknown month "${m[1]}"` };
    return finish(+m[3], mo, +m[2], m.slice(4, 8), m[8], tz);
  }
  return { iso: null, error: `unsupported date format "${s.slice(0, 40)}"` };
}

/** Parse a date cell: numbers are Excel serials, Date objects are instants, strings are text dates. */
export function parseDateCell(
  value: unknown,
  opts: { tz: string; order: DayMonthOrder; date1904?: boolean },
): ParsedDate {
  if (value === null || value === undefined || value === '') return { iso: null, error: 'blank date' };
  if (typeof value === 'number') return excelSerialToISO(value, opts.date1904);
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { iso: null, error: 'invalid date' };
    return { iso: instantToISOInTz(value, opts.tz) };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    // A numeric string in the date column is an Excel serial that lost its type (common in CSV exports).
    if (/^\d{4,6}(\.\d+)?$/.test(t)) return excelSerialToISO(Number(t), opts.date1904);
    return parseTextDate(t, opts.tz, opts.order);
  }
  return { iso: null, error: 'unsupported date value' };
}

/* ---------- ISO date arithmetic (all pure calendar maths, no local timezone) ---------- */

export function isoToUTC(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
}

export function utcToISO(ms: number): string {
  const d = new Date(ms);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export const addDays = (iso: string, n: number): string => utcToISO(isoToUTC(iso) + n * MS_DAY);

/** b - a in whole days. */
export const diffDays = (a: string, b: string): number => Math.round((isoToUTC(b) - isoToUTC(a)) / MS_DAY);

/** Inclusive day count of a range. */
export const rangeDays = (from: string, to: string): number => diffDays(from, to) + 1;

/** Monday of the ISO week containing the date. */
export function weekStart(iso: string): string {
  const dow = new Date(isoToUTC(iso)).getUTCDay(); // 0 Sun .. 6 Sat
  return addDays(iso, -((dow + 6) % 7));
}

export const monthKey = (iso: string): string => iso.slice(0, 7);

export function monthStart(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function monthEnd(iso: string): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  return utcToISO(Date.UTC(y, m, 0));
}

export function isValidISO(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && validYMD(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso: string): string {
  if (!iso) return '';
  return `${+iso.slice(8, 10)} ${MONTH_ABBR[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
}

export function fmtMonth(key: string): string {
  return `${MONTH_ABBR[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
}

export function fmtDateShort(iso: string): string {
  return `${+iso.slice(8, 10)} ${MONTH_ABBR[+iso.slice(5, 7) - 1]}`;
}
