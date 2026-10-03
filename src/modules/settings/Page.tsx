import { CheckCircle2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildCohort } from '../../analytics/returns/cohort';
import { reclassify, summarizeEvents } from '../../analytics/transactions/classify';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge, Button, ConfirmDialog, Field, Notice, PageHeader, Panel, Tabs } from '../../components/ui';
import { DEFAULT_SETTINGS } from '../../schemas/defaults';
import { validateSheetsUrl } from '../../storage/sheetsClient';
import { useStore } from '../../storage/store';
import {
  PLATFORM_LABEL, PLATFORMS, type AuditEntry, type EventMapping, type Platform, type Settings, type SkuAlias, type TxnType,
} from '../../types';
import { fmtDateTime, fmtINR2, fmtInt, fmtPct } from '../../utils/format';
import { BLANK_STATE, CANONICAL_STATES, normalizeState, stateKey } from '../../utils/states';

type Tab = 'sheets' | 'general' | 'policy' | 'rules' | 'mapping' | 'states' | 'skus' | 'audit';

const TIMEZONES: string[] = (() => {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (all?.length) return all.includes('UTC') ? all : ['UTC', ...all];
  } catch { /* fall through */ }
  return ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
})();

export default function SettingsPage() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('sheets');
  const [draft, setDraft] = useState<Settings>(s.settings);
  const [url, setUrl] = useState(s.connection?.url ?? (import.meta.env.VITE_DEFAULT_SHEETS_URL as string | undefined) ?? '');
  const [token, setToken] = useState('');
  const [upload, setUpload] = useState(true);
  const [confirm, setConfirm] = useState<'disconnect' | 'clear' | null>(null);
  const [mapDraft, setMapDraft] = useState<EventMapping[]>(s.mappings);
  const [alias, setAlias] = useState<SkuAlias>({ platform: 'flipkart', platformSku: '', canonicalProductId: '' });
  const tz = s.settings.reportingTimezone;

  const dirty = JSON.stringify(draft) !== JSON.stringify(s.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = () => void s.saveSettings(draft).catch(() => undefined);
  const numInput = (k: keyof Settings, label: string, hint?: string, min = 0) => (
    <Field label={label} hint={hint}>
      <input type="number" min={min} className="field num" value={draft[k] as number}
        onChange={(e) => set(k, Math.max(min, Number(e.target.value) || 0) as never)} />
    </Field>
  );
  const SaveBar = () => (
    <div className="mt-4 flex items-center gap-2">
      <Button variant="primary" disabled={!dirty} onClick={save}>Save settings</Button>
      {dirty && <Button variant="ghost" onClick={() => setDraft(s.settings)}>Discard changes</Button>}
      {!dirty && <span className="flex items-center gap-1 text-xs text-ink-3"><CheckCircle2 size={13} /> Saved</span>}
    </div>
  );

  const urlError = url ? validateSheetsUrl(url) : null;
  const localHasData = s.mode === 'local' && (s.txns.length > 0 || s.costs.length > 0);

  /* transaction mapping */
  const eventRows = useMemo(() => {
    const live = summarizeEvents(reclassify(s.txns, mapDraft));
    const seen = new Set(live.map((e) => `${e.platform}|${e.eventValue.toLowerCase()}`));
    const extra = mapDraft.filter((m) => !seen.has(`${m.platform}|${m.eventValue.trim().toLowerCase()}`))
      .map((m) => ({ platform: m.platform, eventValue: m.eventValue, txnType: m.txnType as TxnType, rows: 0, rawQty: 0, rawTaxable: 0, negativeQtyRows: 0, negativeValueRows: 0 }));
    return [...live, ...extra];
  }, [s.txns, mapDraft]);
  const mapDirty = JSON.stringify(mapDraft) !== JSON.stringify(s.mappings);
  const setEventType = (platform: Platform, eventValue: string, type: TxnType) => {
    const same = (m: EventMapping) => m.platform === platform && m.eventValue.trim().toLowerCase() === eventValue.trim().toLowerCase();
    const rest = mapDraft.filter((m) => !same(m));
    setMapDraft(type === 'UNMAPPED' ? rest : [...rest, { platform, eventValue, txnType: type, source: 'user', updatedAt: new Date().toISOString() }]);
  };
  const linkage = useMemo(() => (tab === 'policy' ? buildCohort(s.txns, null, 0).stats : null), [tab, s.txns]);

  /* state review */
  const stateReview = useMemo(() => {
    if (tab !== 'states') return [];
    const map = new Map<string, number>();
    for (const t of s.txns) {
      if (t.state === BLANK_STATE) continue;
      if (!normalizeState(t.rawState, s.settings.stateAliases).recognised) {
        const k = t.rawState.replace(/\s+/g, ' ').trim();
        map.set(k, (map.get(k) ?? 0) + 1);
      }
    }
    return [...map].sort((x, y) => y[1] - x[1]);
  }, [tab, s.txns, s.settings.stateAliases]);
  const addStateAlias = (raw: string, canonical: string) =>
    stateKey(raw) !== '' && void s.saveSettings({ ...s.settings, stateAliases: { ...s.settings.stateAliases, [stateKey(raw)]: canonical } }).then(() => setDraft(useStore.getState().settings)).catch(() => undefined);
  const removeStateAlias = (key: string) => {
    const next = { ...s.settings.stateAliases };
    delete next[key];
    void s.saveSettings({ ...s.settings, stateAliases: next }).then(() => setDraft(useStore.getState().settings)).catch(() => undefined);
  };

  const auditCols: Column<AuditEntry>[] = [
    { key: 'at', header: 'When', value: (x) => x.at, render: (x) => fmtDateTime(x.at, tz) },
    { key: 'user', header: 'User', value: (x) => x.user },
    { key: 'action', header: 'Action', value: (x) => x.action },
    { key: 'detail', header: 'Detail', value: (x) => x.detail, className: 'whitespace-normal min-w-[20rem]' },
  ];

  return (
    <div className="space-y-3">
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'sheets', label: 'Google Sheets' }, { value: 'general', label: 'General' }, { value: 'policy', label: 'Accounting policy' },
        { value: 'rules', label: 'Classification rules' }, { value: 'mapping', label: 'Transaction mapping' }, { value: 'states', label: 'State names' },
        { value: 'skus', label: 'SKU mapping' }, { value: 'audit', label: 'Audit log', count: s.audit.length },
      ]} />

      {tab === 'sheets' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Google Sheets connection" subtitle="All imports, costs, mappings, settings and the audit log are stored in your spreadsheet.">
            {s.mode === 'sheets' ? (
              <div className="space-y-3">
                <Notice tone="good"><strong className="font-medium">Connected</strong> to “{s.spreadsheetName}”. {fmtInt(s.txns.length)} transactions loaded. Every change is written to the spreadsheet before it appears here.</Notice>
                <p className="break-all text-xs text-ink-3">{s.connection?.url}</p>
                <div className="flex gap-2">
                  <Button onClick={() => void s.reload()}>Reload from spreadsheet</Button>
                  <Button variant="danger" onClick={() => setConfirm('disconnect')}>Disconnect</Button>
                </div>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!urlError && url && token) void s.connect({ url: url.trim(), token: token.trim() }, upload && localHasData).catch(() => undefined); }}>
                <Notice tone="warn">Not connected. Data is kept in this browser only and is lost if site data is cleared.</Notice>
                <Field label="Apps Script web app URL" hint={urlError ?? 'Ends with /exec. From Apps Script: Deploy → Manage deployments.'}>
                  <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" />
                </Field>
                <Field label="Access token" hint="Shown by the spreadsheet menu Analytics Backend → Show access token. Stored in this browser only; never part of the published site.">
                  <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
                </Field>
                {localHasData && (
                  <label className="flex items-start gap-2 text-xs text-ink-2">
                    <input type="checkbox" className="mt-0.5" checked={upload} onChange={(e) => setUpload(e.target.checked)} />
                    <span>Upload the {fmtInt(s.txns.length)} transactions and other data now in this browser to the spreadsheet. Rows already there are skipped.</span>
                  </label>
                )}
                <Button type="submit" variant="primary" disabled={!url || !token || !!urlError}>Connect</Button>
              </form>
            )}
          </Panel>
          <Panel title="Set up the spreadsheet (once)">
            <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
              <li>Open your Google Spreadsheet → Extensions → Apps Script.</li>
              <li>Replace the code with <code className="rounded bg-sunken px-1">apps-script/Code.gs</code> from this project and save.</li>
              <li>Run the function <code className="rounded bg-sunken px-1">setup</code> and authorise it. It creates the data sheets and an access token.</li>
              <li>Deploy → New deployment → Web app. Execute as <strong className="font-medium text-ink">Me</strong>; who has access <strong className="font-medium text-ink">Anyone</strong>.</li>
              <li>Copy the web app URL and the token into the form on this page.</li>
            </ol>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">“Anyone” lets this site reach the script; the token is what protects your data, so treat it like a password. To revoke access, use Analytics Backend → Create a new access token in the spreadsheet. Full steps: docs/GOOGLE_SHEETS_SETUP.md.</p>
          </Panel>
          <Panel title="Data kept in this browser">
            <p className="text-xs leading-relaxed text-ink-2">{s.mode === 'sheets' ? 'A copy of the transactions is cached here so the dashboard opens quickly. Deleting it does not touch the spreadsheet.' : 'In browser-only mode this is the only copy of your data.'} Uploaded report files themselves are never stored or sent anywhere; only the eight extracted fields are kept.</p>
            <Button variant="danger" className="mt-2" onClick={() => setConfirm('clear')}>Delete data stored in this browser</Button>
          </Panel>
        </div>
      )}

      {tab === 'general' && (
        <Panel title="General">
          <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
            <Field label="Your name" hint="Recorded in the audit log and on cost changes."><input className="field" value={draft.userName} onChange={(e) => set('userName', e.target.value)} /></Field>
            <Field label="Reporting timezone" hint="Dates that carry a time offset are converted to this zone; plain dates are used as written. “Today” for date presets is taken in this zone.">
              <select className="field" value={draft.reportingTimezone} onChange={(e) => set('reportingTimezone', e.target.value)}>{TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}</select>
            </Field>
            <Field label="Numeric text dates such as 03/04/2026" hint="Excel date cells and unambiguous formats are unaffected. Applies to new imports.">
              <select className="field" value={draft.dayMonthOrder} onChange={(e) => set('dayMonthOrder', e.target.value as Settings['dayMonthOrder'])}>
                <option value="DMY">Day / month / year (3 April)</option><option value="MDY">Month / day / year (4 March)</option>
              </select>
            </Field>
            {numInput('flipkartHeaderRows', 'Header rows in the Flipkart sheet', 'Rows above the first data row. Usually 1.')}
            {numInput('maxFileSizeMb', 'Maximum upload size (MB)', undefined, 1)}
          </div>
          <SaveBar />
        </Panel>
      )}

      {tab === 'policy' && (
        <Panel title="Accounting policy" subtitle="These choices change how figures are calculated everywhere, including exports. They can be changed at any time without re-importing.">
          <fieldset className="max-w-3xl">
            <legend className="text-[0.8125rem] font-medium">Cancellations</legend>
            <label className="mt-1.5 flex items-start gap-2 text-[0.8125rem]"><input type="radio" className="mt-1" checked={draft.cancellationPolicy === 'separate'} onChange={() => set('cancellationPolicy', 'separate')} />
              <span><strong className="font-medium">Report separately</strong> (default). Net Sales = Gross Sales − Returns. Use when cancelled orders are not among the Sale rows.</span></label>
            <label className="mt-1.5 flex items-start gap-2 text-[0.8125rem]"><input type="radio" className="mt-1" checked={draft.cancellationPolicy === 'reversal'} onChange={() => set('cancellationPolicy', 'reversal')} />
              <span><strong className="font-medium">Subtract as reversals.</strong> Net Sales = Gross Sales − Returns − Cancellations. Use when a cancelled order also appears as a Sale row, so the cancellation row is what removes it. Subtracted once only.</span></label>
            {linkage && linkage.cancellationRows > 0 && (
              <div className="mt-2"><Notice>In your data, {fmtInt(linkage.cancellationLinkedRows)} of {fmtInt(linkage.cancellationRows)} cancellation rows ({fmtPct(linkage.cancellationLinkagePct)}) share an Order Item ID with a Sale row. A high share points to “Subtract as reversals”; a low share points to “Report separately”.</Notice></div>
            )}
          </fieldset>
          <fieldset className="mt-4 max-w-3xl">
            <legend className="text-[0.8125rem] font-medium">Cost of returned units</legend>
            {([
              ['resalable_full', 'Resalable.', 'The full unit cost is reversed when a unit is returned.'],
              ['resalable_packaging_lost', 'Resalable, packaging lost.', 'Unit and other direct costs are reversed; packaging cost stays as an expense.'],
              ['written_off', 'Damaged / written off.', 'No cost is reversed: the sale is reversed but the goods are lost.'],
            ] as [Settings['returnCostPolicy'], string, string][]).map(([v, t, d]) => (
              <label key={v} className="mt-1.5 flex items-start gap-2 text-[0.8125rem]"><input type="radio" className="mt-1" checked={draft.returnCostPolicy === v} onChange={() => set('returnCostPolicy', v)} /><span><strong className="font-medium">{t}</strong> {d}</span></label>
            ))}
            <p className="mt-1.5 text-xs text-ink-3">The report does not say whether a returned unit was resalable, so one policy applies to all returns.</p>
          </fieldset>
          <div className="mt-4 max-w-xs">{numInput('cohortMinLinkagePct', 'Minimum return-to-sale match for the cohort view (%)', 'Share of return rows that must match a sale row by Order Item ID.')}</div>
          <SaveBar />
        </Panel>
      )}

      {tab === 'rules' && (
        <Panel title="Classification rules" subtitle="Thresholds behind the SKU flags. Every flag shows the rule that produced it.">
          <div className="grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {numInput('topN', 'Top revenue / top volume: number of SKUs', undefined, 1)}
            {numInput('highReturnRatePct', 'High return: unit return rate at least (%)')}
            {numInput('highReturnMinUnits', 'High return: minimum sold units', 'Below this, a return rate is too unreliable to flag.')}
            {numInput('lowMovementDays', 'Low movement: observation period (days)', undefined, 1)}
            {numInput('lowMovementMaxUnits', 'Low movement: units sold at most')}
            {numInput('noRecentSalesDays', 'No recent sales: days without a sale', undefined, 1)}
            {numInput('decliningWindowDays', 'Declining: comparison window (days)', undefined, 1)}
            {numInput('decliningPct', 'Declining: sales value down at least (%)')}
            {numInput('minTxnForClassification', 'Insufficient data: fewer sale transactions than')}
            {numInput('velocityWindowDays', 'Average daily sales: window (days)', undefined, 1)}
            {numInput('unusualReturnRatePct', 'Data quality: flag return rates above (%)')}
            {numInput('coverageGapDays', 'Treat as not covered: days in a row with no transactions', 'A stretch this long with no transactions at all is assumed to be a missing report, so SKUs are not called inactive across it.', 1)}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" disabled={!dirty} onClick={save}>Save settings</Button>
            <Button variant="ghost" onClick={() => setDraft({ ...DEFAULT_SETTINGS, userName: draft.userName, stateAliases: draft.stateAliases, reportingTimezone: draft.reportingTimezone })}>Reset thresholds to defaults</Button>
          </div>
        </Panel>
      )}

      {tab === 'mapping' && (
        <Panel title="Transaction mapping" subtitle="How each Event Sub Type is classified. Matching is exact (ignoring letter case and extra spaces); a value with no rule stays Unmapped and is left out of every figure." flush>
          <div className="px-3.5 pt-3"><Notice>The three built-in Flipkart rules (Sale, Return, Cancellation) are defaults that were not verified against a real Flipkart file. Check the row counts and signs before relying on them. Saving a change reprocesses all stored transactions.</Notice></div>
          <div className="overflow-x-auto p-3.5">
            <table className="w-full border-collapse">
              <thead><tr>{['Marketplace', 'Event value', 'Stored rows', 'Σ source quantity', 'Σ source taxable value', 'Negative-value rows', 'Rule', 'Classified as'].map((h, i) => <th key={h} className={`th ${i >= 2 && i <= 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {eventRows.map((e) => {
                  const rule = mapDraft.find((m) => m.platform === e.platform && m.eventValue.trim().toLowerCase() === e.eventValue.trim().toLowerCase());
                  return (
                    <tr key={`${e.platform}|${e.eventValue}`}>
                      <td className="td">{PLATFORM_LABEL[e.platform]}</td><td className="td font-medium">{e.eventValue}</td>
                      <td className="td num text-right">{fmtInt(e.rows)}</td><td className="td num text-right">{fmtInt(e.rawQty)}</td><td className="td num text-right">{fmtINR2(e.rawTaxable)}</td><td className="td num text-right">{fmtInt(e.negativeValueRows)}</td>
                      <td className="td">{rule ? (rule.source === 'default' ? <Badge>Built-in default</Badge> : <Badge tone="accent">Set by you</Badge>) : <Badge tone="warn">No rule</Badge>}</td>
                      <td className="td">
                        <select aria-label={`Classify ${e.eventValue}`} className="field h-7 w-44 text-xs" value={e.txnType} onChange={(ev) => setEventType(e.platform, e.eventValue, ev.target.value as TxnType)}>
                          <option value="UNMAPPED">Unmapped (not counted)</option><option value="SALE">Sale</option><option value="RETURN">Return</option><option value="CANCELLATION">Cancellation</option><option value="EXCLUDE">Exclude</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" disabled={!mapDirty} onClick={() => void s.saveMappings(mapDraft).catch(() => undefined)}>Save mapping and reprocess</Button>
              {mapDirty && <Button variant="ghost" onClick={() => setMapDraft(s.mappings)}>Discard changes</Button>}
            </div>
          </div>
        </Panel>
      )}

      {tab === 'states' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="State values needing review" subtitle="Not recognised after harmless clean-up (spacing, letter case, “&”). Nothing is merged unless you approve it here.">
            {stateReview.length === 0 ? <p className="text-xs text-ink-2">Every state value in the stored data is recognised.</p> : (
              <ul className="space-y-2">
                {stateReview.map(([raw, n]) => (
                  <li key={raw} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                    <span><span className="font-medium">“{raw}”</span> <span className="num text-ink-3">{fmtInt(n)} rows</span></span>
                    <select aria-label={`Map ${raw} to a state`} className="field h-7 w-56 text-xs" value="" onChange={(e) => e.target.value && addStateAlias(raw, e.target.value)}>
                      <option value="">Keep as written</option>
                      {CANONICAL_STATES.map((c) => <option key={c} value={c}>Treat as {c}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Approved aliases">
            {Object.keys(s.settings.stateAliases).length === 0 ? <p className="text-xs text-ink-2">No aliases approved yet.</p> : (
              <ul className="space-y-1">
                {Object.entries(s.settings.stateAliases).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                    <span>{k} → <span className="font-medium">{v}</span></span>
                    <Button size="sm" variant="ghost" aria-label={`Remove alias ${k}`} onClick={() => removeStateAlias(k)}><Trash2 size={13} /></Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === 'skus' && (
        <Panel title="SKU mapping" subtitle="Map a marketplace SKU to a canonical product ID so the same physical product can be compared across marketplaces. Different products are never merged because their names look alike.">
          <form className="grid max-w-3xl items-end gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]" onSubmit={(e) => {
            e.preventDefault();
            if (!alias.platformSku.trim() || !alias.canonicalProductId.trim()) return;
            const rec = { ...alias, platformSku: alias.platformSku.trim(), canonicalProductId: alias.canonicalProductId.trim() };
            void s.saveAliases([...s.aliases.filter((x) => !(x.platform === rec.platform && x.platformSku === rec.platformSku)), rec]).then(() => setAlias({ ...alias, platformSku: '', canonicalProductId: '' })).catch(() => undefined);
          }}>
            <Field label="Marketplace"><select className="field" value={alias.platform} onChange={(e) => setAlias({ ...alias, platform: e.target.value as Platform })}>{PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></Field>
            <Field label="Marketplace SKU"><input className="field" value={alias.platformSku} onChange={(e) => setAlias({ ...alias, platformSku: e.target.value })} /></Field>
            <Field label="Canonical product ID"><input className="field" value={alias.canonicalProductId} onChange={(e) => setAlias({ ...alias, canonicalProductId: e.target.value })} /></Field>
            <Button type="submit" variant="primary">Add mapping</Button>
          </form>
          {s.aliases.length > 0 && (
            <table className="mt-3 w-full max-w-3xl border-collapse">
              <thead><tr><th className="th">Marketplace</th><th className="th">SKU</th><th className="th">Canonical product ID</th><th className="th" /></tr></thead>
              <tbody>
                {s.aliases.map((x) => (
                  <tr key={`${x.platform}|${x.platformSku}`}><td className="td">{PLATFORM_LABEL[x.platform]}</td><td className="td">{x.platformSku}</td><td className="td font-medium">{x.canonicalProductId}</td>
                    <td className="td text-right"><Button size="sm" variant="ghost" aria-label={`Remove mapping for ${x.platformSku}`} onClick={() => void s.saveAliases(s.aliases.filter((y) => y !== x)).catch(() => undefined)}><Trash2 size={13} /></Button></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === 'audit' && (
        <Panel title="Audit log" subtitle="Imports, deletions, mapping, cost and settings changes. Newest first." flush>
          <DataTable rows={[...s.audit].reverse()} columns={auditCols} rowKey={(x) => `${x.at}${x.action}${x.detail.slice(0, 20)}`} searchText={(x) => `${x.action} ${x.detail} ${x.user}`} searchPlaceholder="Search the log" emptyTitle="Nothing recorded yet" />
        </Panel>
      )}

      {confirm === 'disconnect' && <ConfirmDialog title="Disconnect from Google Sheets?" confirmLabel="Disconnect" onClose={() => setConfirm(null)} onConfirm={() => void s.disconnect()}
        body={<p className="text-[0.8125rem]">The spreadsheet keeps all its data. This browser forgets the web app URL and token and goes back to browser-only storage.</p>} />}
      {confirm === 'clear' && <ConfirmDialog danger title="Delete data stored in this browser?" confirmLabel="Delete browser data" onClose={() => setConfirm(null)} onConfirm={() => void s.clearLocalData()}
        body={<p className="text-[0.8125rem]">{s.mode === 'sheets' ? 'Only the local cache is removed; your spreadsheet is not changed and the data is downloaded again on the next visit.' : 'You are in browser-only mode: this permanently deletes all imported transactions, costs, mappings and settings. It cannot be undone.'}</p>} />}
    </div>
  );
}
