const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtINR = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : inr.format(n));
export const fmtINR2 = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : inr2.format(n));
export const fmtInt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : int.format(n));
export const fmtDec = (n: number | null | undefined, d = 2): string =>
  n === null || n === undefined ? '—' : (d === 1 ? dec1 : dec2).format(n);
export const fmtPct = (n: number | null | undefined, d = 1): string =>
  n === null || n === undefined ? '—' : `${(d === 1 ? dec1 : dec2).format(n)}%`;

/** Compact Indian-system currency for chart axes: 1.2K, 3.4L, 5.6Cr. */
export function fmtINRCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
}

export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(0)}`;
}

export function fmtDateTime(isoTs: string, tz: string): string {
  if (!isoTs) return '';
  const d = new Date(isoTs);
  if (isNaN(d.getTime())) return isoTs;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}
