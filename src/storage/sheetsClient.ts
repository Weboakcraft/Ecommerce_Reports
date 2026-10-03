/**
 * Client for the Google Apps Script backend (apps-script/Code.gs).
 *
 * Requests are POSTed as text/plain so the browser sends no CORS preflight
 * (Apps Script web apps cannot answer one). The access token is entered by the
 * user at runtime and kept in this browser only; it is never part of the build.
 */

export interface SheetsConnection {
  url: string;
  token: string;
}

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

/** Only genuine Apps Script web-app URLs are accepted, so data cannot be sent to another host by mistake. */
export function validateSheetsUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return 'Enter the web app URL.';
  if (!URL_RE.test(u)) {
    return 'This must be an Apps Script web app URL: https://script.google.com/macros/s/…/exec';
  }
  return null;
}

export class SheetsError extends Error {}

export interface PingInfo {
  version: string;
  spreadsheetName: string;
  dataVersion: number;
  transactionCount: number;
}

export interface BootstrapData extends PingInfo {
  batches: unknown[][];
  rejected: unknown[][];
  mappings: unknown[][];
  costs: unknown[][];
  expenses: unknown[][];
  aliases: unknown[][];
  settings: unknown[][];
  audit: unknown[][];
}

export class SheetsClient {
  constructor(private conn: SheetsConnection) {}

  private async call<T>(action: string, payload: unknown = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.conn.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: this.conn.token, action, payload }),
        redirect: 'follow',
      });
    } catch (e) {
      throw new SheetsError(
        `Could not reach Google Sheets (${(e as Error).message}). Check your connection and that the web app is deployed with access "Anyone".`,
      );
    }
    const text = await res.text();
    let json: { ok: boolean; data?: T; error?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new SheetsError(
        `Unexpected response from the web app (HTTP ${res.status}). Re-deploy the Apps Script as a web app: Execute as "Me", access "Anyone".`,
      );
    }
    if (!json.ok) throw new SheetsError(json.error || 'The backend reported an error.');
    return json.data as T;
  }

  ping = () => this.call<PingInfo>('ping');
  bootstrap = () => this.call<BootstrapData>('bootstrap');
  getTransactions = (offset: number, limit: number) =>
    this.call<{ total: number; offset: number; rows: unknown[][]; dataVersion: number }>('getTransactions', { offset, limit });
  appendTransactions = (rows: unknown[][]) =>
    this.call<{ appended: number; skipped: number; dataVersion: number; transactionCount: number }>('appendTransactions', { rows });
  upsertBatch = (row: unknown[]) => this.call<{ updated: boolean }>('upsertBatch', { row });
  setRejected = (batchId: string, rows: unknown[][]) => this.call<{ rows: number }>('setRejected', { batchId, rows });
  selfTest = () => this.call<{ ok: boolean; results: { wrote: unknown[]; read: unknown[]; ok: boolean }[] }>('selfTest');
  deleteBatch = (batchId: string) => this.call<{ removed: number; dataVersion: number }>('deleteBatch', { batchId });
  replaceTable = (table: string, rows: unknown[][]) => this.call<{ rows: number }>('replaceTable', { table, rows });
  reclassify = () => this.call<{ changed: number; dataVersion: number }>('reclassify');
  remapStates = (map: Record<string, string>) => this.call<{ changed: number; dataVersion: number }>('remapStates', { map });
  appendAudit = (rows: unknown[][]) => this.call<{ appended: number }>('appendAudit', { rows });
}

const KEY = 'ecom-analytics.sheets-connection';

export function loadConnection(): SheetsConnection | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as SheetsConnection;
    return c.url && c.token && !validateSheetsUrl(c.url) ? c : null;
  } catch {
    return null;
  }
}

export function saveConnection(c: SheetsConnection | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: connection lasts for this session only */
  }
}
