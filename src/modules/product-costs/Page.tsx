import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { detectFileKind } from '../../adapters';
import { validateCosts, type CostIssue } from '../../analytics/profitability/costs';
import type { Analytics } from '../../app/analytics';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Badge, Button, ConfirmDialog, Field, Modal, Notice, PageHeader, Panel, Tabs } from '../../components/ui';
import { download } from '../../reports/export';
import { useStore } from '../../storage/store';
import { PLATFORM_LABEL, PLATFORMS, type Expense, type ExpenseType, type Platform, type ProductCost } from '../../types';
import { addDays, fmtDate, isValidISO, parseDateCell } from '../../utils/dates';
import { fmtDateTime, fmtINR2, fmtInt } from '../../utils/format';
import { newId } from '../../utils/hash';
import { parseNumber } from '../../utils/numbers';
import { normalizeSku } from '../../utils/sku';

const EXPENSE_LABEL: Record<ExpenseType, string> = {
  advertising: 'Advertising', shipping: 'Shipping', marketplace_fee: 'Marketplace fees', packaging: 'Packaging', other: 'Other',
};
const platformLabel = (p: Platform | 'all') => (p === 'all' ? 'All marketplaces' : PLATFORM_LABEL[p]);

const TEMPLATE_HEADERS = ['SKU', 'Canonical Product ID', 'Platform', 'Effective From', 'Effective To', 'Unit Manufacturing Cost', 'Packaging Cost', 'Other Direct Unit Cost', 'Notes'];

function blankCost(): ProductCost {
  return { id: '', canonicalProductId: '', sku: '', platform: 'all', effectiveFrom: '', effectiveTo: '', unitCost: 0, packagingCost: 0, otherCost: 0, notes: '', updatedBy: '', updatedAt: '' };
}
function blankExpense(): Expense {
  return { id: '', platform: 'all', sku: '', type: 'advertising', periodFrom: '', periodTo: '', amount: 0, notes: '', updatedBy: '', updatedAt: '' };
}

export default function CostsPage({ a }: { a: Analytics }) {
  const s = useStore();
  const [tab, setTab] = useState<'costs' | 'expenses' | 'coverage'>('costs');
  const [edit, setEdit] = useState<ProductCost | null>(null);
  const [closePrev, setClosePrev] = useState(true);
  const [formError, setFormError] = useState<string[]>([]);
  const [del, setDel] = useState<ProductCost | null>(null);
  const [editExp, setEditExp] = useState<Expense | null>(null);
  const [delExp, setDelExp] = useState<Expense | null>(null);
  const [imp, setImp] = useState<{ good: ProductCost[]; bad: string[]; issues: CostIssue[] } | null>(null);
  const [impError, setImpError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const user = s.settings.userName || 'unknown';
  const tz = s.settings.reportingTimezone;
  const issues = useMemo(() => validateCosts(s.costs), [s.costs]);

  /* ---------- cost add / edit ---------- */
  const openPrev = (c: ProductCost) =>
    s.costs.find((x) => x.id !== c.id && x.sku === c.sku && x.platform === c.platform && !x.effectiveTo && x.effectiveFrom < c.effectiveFrom);

  const saveCost = async () => {
    if (!edit) return;
    const rec: ProductCost = { ...edit, sku: normalizeSku(edit.sku), id: edit.id || newId('cost'), updatedBy: user, updatedAt: new Date().toISOString() };
    const errs: string[] = [];
    if (!rec.sku) errs.push('Enter a SKU.');
    if (!isValidISO(rec.effectiveFrom)) errs.push('Enter a valid Effective From date.');
    if (rec.effectiveTo && !isValidISO(rec.effectiveTo)) errs.push('Effective To is not a valid date.');
    let next = edit.id ? s.costs.map((x) => (x.id === rec.id ? rec : x)) : [...s.costs, rec];
    const prev = isValidISO(rec.effectiveFrom) ? openPrev(rec) : undefined;
    if (prev && closePrev) {
      next = next.map((x) => (x.id === prev.id ? { ...x, effectiveTo: addDays(rec.effectiveFrom, -1), updatedBy: user, updatedAt: rec.updatedAt } : x));
    }
    for (const i of validateCosts(next)) if (i.id === rec.id) errs.push(i.message + '.');
    if (errs.length) return setFormError([...new Set(errs)]);
    const before = s.costs.find((x) => x.id === rec.id);
    const detail = before
      ? `Edited cost ${rec.sku} (${platformLabel(rec.platform)}): unit ${before.unitCost}→${rec.unitCost}, packaging ${before.packagingCost}→${rec.packagingCost}, other ${before.otherCost}→${rec.otherCost}, effective ${before.effectiveFrom}..${before.effectiveTo || 'open'}→${rec.effectiveFrom}..${rec.effectiveTo || 'open'}`
      : `Added cost ${rec.sku} (${platformLabel(rec.platform)}): unit ${rec.unitCost}, packaging ${rec.packagingCost}, other ${rec.otherCost}, effective ${rec.effectiveFrom}..${rec.effectiveTo || 'open'}${prev && closePrev ? `; previous record ended ${addDays(rec.effectiveFrom, -1)}` : ''}`;
    try {
      await s.saveCosts(next, detail);
      setEdit(null);
    } catch { /* banner shown by the store */ }
  };

  /* ---------- cost import ---------- */
  const onFile = async (f: File) => {
    setImpError('');
    try {
      const buf = await f.arrayBuffer();
      detectFileKind(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)), f.name);
      const wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
      if (rows.length < 2) throw new Error('The file has no data rows.');
      const head = (rows[0] as unknown[]).map((h) => String(h ?? '').trim().toLowerCase());
      const col = (name: string) => head.indexOf(name.toLowerCase());
      const idx = Object.fromEntries(TEMPLATE_HEADERS.map((h) => [h, col(h)])) as Record<string, number>;
      const missing = ['SKU', 'Effective From', 'Unit Manufacturing Cost'].filter((h) => idx[h] < 0);
      if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}. Download the template for the expected headers.`);
      const good: ProductCost[] = [];
      const bad: string[] = [];
      const now = new Date().toISOString();
      rows.slice(1).forEach((r, i) => {
        const row = r as unknown[];
        const get = (h: string) => (idx[h] >= 0 ? row[idx[h]] : null);
        if (row.every((v) => v === null || String(v).trim() === '')) return;
        const errs: string[] = [];
        const sku = normalizeSku(get('SKU'));
        if (!sku) errs.push('SKU is blank');
        const from = parseDateCell(get('Effective From'), { tz, order: s.settings.dayMonthOrder });
        if (!from.iso) errs.push(`Effective From: ${from.error}`);
        const toRaw = get('Effective To');
        const to = toRaw === null || String(toRaw).trim() === '' ? { iso: '' } : parseDateCell(toRaw, { tz, order: s.settings.dayMonthOrder });
        if (to.iso === null) errs.push('Effective To is not a valid date');
        const unit = parseNumber(get('Unit Manufacturing Cost'));
        if (unit.value === null) errs.push(`Unit Manufacturing Cost: ${unit.error}`);
        const num = (h: string) => { const v = get(h); if (v === null || String(v).trim() === '') return 0; const n = parseNumber(v); if (n.value === null) errs.push(`${h}: ${n.error}`); return n.value ?? 0; };
        const pack = num('Packaging Cost');
        const other = num('Other Direct Unit Cost');
        const pRaw = String(get('Platform') ?? '').trim().toLowerCase();
        const platform = pRaw === '' || pRaw === 'all' ? 'all' : (PLATFORMS.find((p) => p === pRaw || PLATFORM_LABEL[p].toLowerCase() === pRaw) ?? null);
        if (platform === null) errs.push(`Platform "${pRaw}" is not recognised (use all, flipkart, amazon, myntra or shopify)`);
        if (errs.length) return void bad.push(`Row ${i + 2}: ${errs.join('; ')}`);
        good.push({ id: newId('cost'), canonicalProductId: String(get('Canonical Product ID') ?? '').trim(), sku, platform: platform as ProductCost['platform'], effectiveFrom: from.iso!, effectiveTo: to.iso ?? '', unitCost: unit.value!, packagingCost: pack, otherCost: other, notes: String(get('Notes') ?? '').trim(), updatedBy: user, updatedAt: now });
      });
      const ids = new Set(good.map((g) => g.id));
      setImp({ good, bad, issues: validateCosts([...s.costs, ...good]).filter((x) => ids.has(x.id)) });
    } catch (e) {
      setImpError((e as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!imp) return;
    const blocked = new Set(imp.issues.map((i) => i.id));
    const ok = imp.good.filter((g) => !blocked.has(g.id));
    try {
      await s.saveCosts([...s.costs, ...ok], `Imported ${ok.length} cost record(s) from file: ${ok.slice(0, 20).map((c) => `${c.sku}@${c.effectiveFrom}=${c.unitCost + c.packagingCost + c.otherCost}`).join(', ')}${ok.length > 20 ? ' …' : ''}`);
      setImp(null);
    } catch { /* banner */ }
  };

  const issueById = new Map<string, CostIssue[]>();
  for (const i of issues) issueById.set(i.id, [...(issueById.get(i.id) ?? []), i]);

  const costCols: Column<ProductCost>[] = [
    { key: 'sku', header: 'SKU', value: (c) => c.sku, render: (c) => <span className="font-medium">{c.sku}</span> },
    { key: 'pid', header: 'Canonical Product ID', value: (c) => c.canonicalProductId || null },
    { key: 'platform', header: 'Applies to', value: (c) => platformLabel(c.platform) },
    { key: 'from', header: 'Effective From', value: (c) => c.effectiveFrom, render: (c) => fmtDate(c.effectiveFrom) },
    { key: 'to', header: 'Effective To', value: (c) => c.effectiveTo || '9999', render: (c) => (c.effectiveTo ? fmtDate(c.effectiveTo) : <span className="text-ink-2">Open-ended</span>) },
    { key: 'unit', header: 'Unit Mfg Cost', align: 'right', value: (c) => c.unitCost, render: (c) => fmtINR2(c.unitCost) },
    { key: 'pack', header: 'Packaging', align: 'right', value: (c) => c.packagingCost, render: (c) => fmtINR2(c.packagingCost) },
    { key: 'other', header: 'Other Direct', align: 'right', value: (c) => c.otherCost, render: (c) => fmtINR2(c.otherCost) },
    { key: 'total', header: 'Total Unit Cost', align: 'right', value: (c) => c.unitCost + c.packagingCost + c.otherCost, render: (c) => <span className="font-medium">{fmtINR2(c.unitCost + c.packagingCost + c.otherCost)}</span> },
    { key: 'notes', header: 'Notes', value: (c) => c.notes || null, className: 'max-w-[14rem] truncate' },
    { key: 'by', header: 'Updated By', value: (c) => c.updatedBy },
    { key: 'at', header: 'Updated At', value: (c) => c.updatedAt, render: (c) => fmtDateTime(c.updatedAt, tz) },
    { key: 'ok', header: 'Check', value: (c) => (issueById.has(c.id) ? 1 : 0), render: (c) => (issueById.has(c.id) ? <Badge tone="bad" title={issueById.get(c.id)!.map((i) => i.message).join('\n')}>Problem</Badge> : <Badge tone="good">OK</Badge>) },
    {
      key: 'act', header: 'Actions', sortable: false, value: () => '',
      render: (c) => (
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label={`Edit cost for ${c.sku}`} onClick={() => { setFormError([]); setEdit(c); }}><Pencil size={13} /></Button>
          <Button size="sm" variant="ghost" aria-label={`Delete cost for ${c.sku}`} onClick={() => setDel(c)}><Trash2 size={13} /></Button>
        </span>
      ),
    },
  ];

  const expCols: Column<Expense>[] = [
    { key: 'type', header: 'Type', value: (e) => EXPENSE_LABEL[e.type] },
    { key: 'platform', header: 'Marketplace', value: (e) => platformLabel(e.platform) },
    { key: 'sku', header: 'SKU', value: (e) => e.sku || null, render: (e) => e.sku || <span className="text-ink-2">Shared across SKUs</span> },
    { key: 'from', header: 'Period From', value: (e) => e.periodFrom, render: (e) => fmtDate(e.periodFrom) },
    { key: 'to', header: 'Period To', value: (e) => e.periodTo, render: (e) => fmtDate(e.periodTo) },
    { key: 'amt', header: 'Amount', align: 'right', value: (e) => e.amount, render: (e) => fmtINR2(e.amount) },
    { key: 'notes', header: 'Notes', value: (e) => e.notes || null },
    { key: 'by', header: 'Updated By', value: (e) => e.updatedBy },
    {
      key: 'act', header: 'Actions', sortable: false, value: () => '',
      render: (e) => (
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Edit expense" onClick={() => { setFormError([]); setEditExp(e); }}><Pencil size={13} /></Button>
          <Button size="sm" variant="ghost" aria-label="Delete expense" onClick={() => setDelExp(e)}><Trash2 size={13} /></Button>
        </span>
      ),
    },
  ];

  const saveExpense = async () => {
    if (!editExp) return;
    const rec: Expense = { ...editExp, sku: normalizeSku(editExp.sku), id: editExp.id || newId('exp'), updatedBy: user, updatedAt: new Date().toISOString() };
    const errs: string[] = [];
    if (!isValidISO(rec.periodFrom) || !isValidISO(rec.periodTo)) errs.push('Enter valid period dates.');
    else if (rec.periodTo < rec.periodFrom) errs.push('Period To is before Period From.');
    if (!Number.isFinite(rec.amount) || rec.amount <= 0) errs.push('Amount must be greater than zero.');
    if (errs.length) return setFormError(errs);
    const next = editExp.id ? s.expenses.map((x) => (x.id === rec.id ? rec : x)) : [...s.expenses, rec];
    try {
      await s.saveExpenses(next, `${editExp.id ? 'Edited' : 'Added'} expense ${EXPENSE_LABEL[rec.type]} ${rec.amount} for ${rec.periodFrom}..${rec.periodTo}${rec.sku ? ` SKU ${rec.sku}` : ' (shared)'}`);
      setEditExp(null);
    } catch { /* banner */ }
  };

  const coverage = a.allSkuRows.filter((r) => r.saleRows > 0).map((r) => ({
    key: r.key, sku: r.sku, platform: r.platform, saleRows: r.saleRows + r.returnRows, missing: r.profit.missingCostRows,
    status: r.profit.available ? 'Complete' : r.profit.costedRows > 0 ? 'Partial' : 'No cost',
    net: r.netSalesValue,
  }));
  const coverageCols: Column<(typeof coverage)[number]>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.sku, render: (r) => <span className="font-medium">{r.sku}</span> },
    { key: 'platform', header: 'Platform', value: (r) => PLATFORM_LABEL[r.platform] },
    { key: 'net', header: 'Net Sales', align: 'right', value: (r) => r.net, render: (r) => fmtINR2(r.net) },
    { key: 'rows', header: 'Sale + return rows', align: 'right', value: (r) => r.saleRows, render: (r) => fmtInt(r.saleRows) },
    { key: 'missing', header: 'Rows without a cost', align: 'right', value: (r) => r.missing, render: (r) => fmtInt(r.missing) },
    { key: 'status', header: 'Cost data', value: (r) => r.status, render: (r) => <Badge tone={r.status === 'Complete' ? 'good' : r.status === 'Partial' ? 'warn' : 'neutral'}>{r.status}</Badge> },
    { key: 'act', header: '', sortable: false, value: () => '', render: (r) => r.status !== 'Complete' ? <Button size="sm" variant="ghost" onClick={() => { setFormError([]); setClosePrev(true); setEdit({ ...blankCost(), sku: r.sku }); }}><Plus size={13} /> Add cost</Button> : null },
  ];

  const prevForEdit = edit && !edit.id && isValidISO(edit.effectiveFrom) ? openPrev({ ...edit, sku: normalizeSku(edit.sku) }) : undefined;
  const numField = (label: string, key: 'unitCost' | 'packagingCost' | 'otherCost') => (
    <Field label={label}>
      <input type="number" min={0} step="0.01" className="field num" value={edit![key]} onChange={(e) => setEdit({ ...edit!, [key]: e.target.value === '' ? 0 : Number(e.target.value) })} />
    </Field>
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="Product Cost Master"
        lead="Unit costs with effective dates. Profit is calculated only from these records: each transaction uses the cost that was in force on its own date, and a date with no record leaves profit unavailable rather than borrowing another period’s cost."
      />
      {issues.length > 0 && <Notice tone="bad"><strong className="font-medium">{issues.length} cost record problem(s).</strong> {issues.slice(0, 3).map((i) => `${i.sku}: ${i.message}`).join(' · ')}{issues.length > 3 && ' …'} Overlapping records make the applicable cost ambiguous; fix them before relying on profit figures.</Notice>}
      {impError && <Notice tone="bad" onDismiss={() => setImpError('')}>Cost import failed: {impError}</Notice>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'costs', label: 'Unit costs', count: s.costs.length }, { value: 'expenses', label: 'Variable expenses', count: s.expenses.length }, { value: 'coverage', label: 'Cost coverage' }]} />

      {tab === 'costs' && (
        <Panel flush>
          <DataTable
            rows={s.costs} columns={costCols} rowKey={(c) => c.id} searchText={(c) => `${c.sku} ${c.canonicalProductId} ${c.notes}`} searchPlaceholder="Search SKU"
            initialSort={{ key: 'sku', dir: 'asc' }} emptyTitle="No product costs yet"
            emptyBody="Add a cost for each SKU, or import them from Excel. Until then every profit figure shows “Profitability unavailable — product cost data required.”"
            toolbar={
              <>
                <Button size="sm" onClick={() => download(new Blob(['﻿' + TEMPLATE_HEADERS.join(',') + '\nOC-07-BLACK,,all,2026-04-01,,1250.00,80.00,0,Example row - replace\n'], { type: 'text/csv' }), 'product-cost-template.csv')}><Download size={13} /> Template</Button>
                <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
                <Button size="sm" onClick={() => file.current?.click()}><Upload size={13} /> Import from Excel</Button>
                <Button size="sm" variant="primary" onClick={() => { setFormError([]); setClosePrev(true); setEdit(blankCost()); }}><Plus size={13} /> Add cost</Button>
              </>
            }
          />
        </Panel>
      )}

      {tab === 'expenses' && (
        <>
          <Notice>Optional. Advertising, shipping, marketplace fees and similar costs are subtracted from Gross Profit to give Contribution Profit. An expense with a SKU is charged to that SKU; one without is shared across SKUs in proportion to their gross sales value in the expense period, pro-rated by days when the reporting period only partly overlaps.</Notice>
          <Panel flush>
            <DataTable rows={s.expenses} columns={expCols} rowKey={(e) => e.id} initialSort={{ key: 'from', dir: 'desc' }} emptyTitle="No variable expenses recorded" emptyBody="Without expenses, contribution profit equals gross profit."
              toolbar={<Button size="sm" variant="primary" onClick={() => { setFormError([]); setEditExp(blankExpense()); }}><Plus size={13} /> Add expense</Button>} />
          </Panel>
        </>
      )}

      {tab === 'coverage' && (
        <>
          <Notice>SKUs with sales in the current filter selection, and whether every sale and return date has a cost record.</Notice>
          <Panel flush><DataTable rows={coverage} columns={coverageCols} rowKey={(r) => r.key} searchText={(r) => r.sku} searchPlaceholder="Search SKU" initialSort={{ key: 'net', dir: 'desc' }} emptyTitle="No SKUs with sales" /></Panel>
        </>
      )}

      {edit && (
        <Modal title={edit.id ? `Edit cost — ${edit.sku}` : 'Add product cost'} onClose={() => setEdit(null)} wide
          footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={() => void saveCost()}>Save cost</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU" hint="As it appears after normalisation, without the SKU: prefix.">
              <input className="field" list="sku-options" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} />
              <datalist id="sku-options">{a.options.skus.slice(0, 2000).map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
            <Field label="Canonical Product ID (optional)" hint="Links the same product across marketplaces.">
              <input className="field" value={edit.canonicalProductId} onChange={(e) => setEdit({ ...edit, canonicalProductId: e.target.value })} />
            </Field>
            <Field label="Applies to" hint="A marketplace-specific cost overrides an “all marketplaces” cost.">
              <select className="field" value={edit.platform} onChange={(e) => setEdit({ ...edit, platform: e.target.value as ProductCost['platform'] })}>
                <option value="all">All marketplaces</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]} only</option>)}
              </select>
            </Field>
            <span />
            <Field label="Effective From (inclusive)"><input type="date" className="field" value={edit.effectiveFrom} onChange={(e) => setEdit({ ...edit, effectiveFrom: e.target.value })} /></Field>
            <Field label="Effective To (inclusive, optional)" hint="Leave empty while this cost is current."><input type="date" className="field" value={edit.effectiveTo} onChange={(e) => setEdit({ ...edit, effectiveTo: e.target.value })} /></Field>
            {numField('Unit Manufacturing Cost (₹)', 'unitCost')}
            {numField('Packaging Cost (₹ per unit)', 'packagingCost')}
            {numField('Other Direct Unit Cost (₹)', 'otherCost')}
            <Field label="Notes"><input className="field" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
          {prevForEdit && (
            <label className="mt-3 flex items-start gap-2 text-xs text-ink-2">
              <input type="checkbox" className="mt-0.5" checked={closePrev} onChange={(e) => setClosePrev(e.target.checked)} />
              <span>The current cost for this SKU (from {fmtDate(prevForEdit.effectiveFrom)}) is open-ended. End it on {fmtDate(addDays(edit.effectiveFrom, -1))} so the two records do not overlap. Earlier sales keep the earlier cost.</span>
            </label>
          )}
          {formError.length > 0 && <div className="mt-3"><Notice tone="bad">{formError.join(' ')}</Notice></div>}
        </Modal>
      )}

      {editExp && (
        <Modal title={editExp.id ? 'Edit expense' : 'Add variable expense'} onClose={() => setEditExp(null)} wide
          footer={<><Button onClick={() => setEditExp(null)}>Cancel</Button><Button variant="primary" onClick={() => void saveExpense()}>Save expense</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className="field" value={editExp.type} onChange={(e) => setEditExp({ ...editExp, type: e.target.value as ExpenseType })}>
                {(Object.keys(EXPENSE_LABEL) as ExpenseType[]).map((t) => <option key={t} value={t}>{EXPENSE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Marketplace">
              <select className="field" value={editExp.platform} onChange={(e) => setEditExp({ ...editExp, platform: e.target.value as Expense['platform'] })}>
                <option value="all">All marketplaces</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field label="SKU (optional)" hint="Leave empty to share the expense across SKUs by gross sales value.">
              <input className="field" list="sku-options-exp" value={editExp.sku} onChange={(e) => setEditExp({ ...editExp, sku: e.target.value })} />
              <datalist id="sku-options-exp">{a.options.skus.slice(0, 2000).map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
            <Field label="Amount (₹, for the whole period)"><input type="number" min={0} step="0.01" className="field num" value={editExp.amount} onChange={(e) => setEditExp({ ...editExp, amount: Number(e.target.value) })} /></Field>
            <Field label="Period From (inclusive)"><input type="date" className="field" value={editExp.periodFrom} onChange={(e) => setEditExp({ ...editExp, periodFrom: e.target.value })} /></Field>
            <Field label="Period To (inclusive)"><input type="date" className="field" value={editExp.periodTo} onChange={(e) => setEditExp({ ...editExp, periodTo: e.target.value })} /></Field>
            <Field label="Notes"><input className="field" value={editExp.notes} onChange={(e) => setEditExp({ ...editExp, notes: e.target.value })} /></Field>
          </div>
          {formError.length > 0 && <div className="mt-3"><Notice tone="bad">{formError.join(' ')}</Notice></div>}
        </Modal>
      )}

      {imp && (
        <Modal title="Import product costs" onClose={() => setImp(null)} wide
          footer={<><Button onClick={() => setImp(null)}>Cancel</Button><Button variant="primary" disabled={imp.good.length - new Set(imp.issues.map((i) => i.id)).size <= 0} onClick={() => void confirmImport()}>Add {imp.good.length - new Set(imp.issues.map((i) => i.id)).size} record(s)</Button></>}>
          <p className="text-[0.8125rem]">{imp.good.length} valid row(s) read. {imp.bad.length} row(s) rejected. {new Set(imp.issues.map((i) => i.id)).size} row(s) conflict with existing or other imported records and will not be added.</p>
          {imp.bad.length > 0 && <div className="mt-2 max-h-32 overflow-auto rounded border border-line p-2 text-xs text-bad">{imp.bad.map((b) => <p key={b}>{b}</p>)}</div>}
          {imp.issues.length > 0 && <div className="mt-2 max-h-32 overflow-auto rounded border border-line p-2 text-xs text-warn">{imp.issues.map((i, n) => <p key={n}>{i.sku}: {i.message}</p>)}</div>}
          <div className="mt-2 max-h-56 overflow-auto border border-line">
            <table className="w-full border-collapse">
              <thead><tr>{['SKU', 'Applies to', 'From', 'To', 'Unit', 'Packaging', 'Other'].map((h) => <th key={h} className="th sticky top-0">{h}</th>)}</tr></thead>
              <tbody>{imp.good.slice(0, 100).map((c) => <tr key={c.id}><td className="td">{c.sku}</td><td className="td">{platformLabel(c.platform)}</td><td className="td num">{c.effectiveFrom}</td><td className="td num">{c.effectiveTo || 'open'}</td><td className="td num text-right">{c.unitCost}</td><td className="td num text-right">{c.packagingCost}</td><td className="td num text-right">{c.otherCost}</td></tr>)}</tbody>
            </table>
          </div>
        </Modal>
      )}

      {del && <ConfirmDialog danger title="Delete this cost record?" confirmLabel="Delete cost" onClose={() => setDel(null)}
        onConfirm={() => void s.saveCosts(s.costs.filter((x) => x.id !== del.id), `Deleted cost ${del.sku} (${platformLabel(del.platform)}) effective ${del.effectiveFrom}..${del.effectiveTo || 'open'}, total unit cost ${del.unitCost + del.packagingCost + del.otherCost}`).catch(() => undefined)}
        body={<p className="text-[0.8125rem]">{del.sku}, effective {fmtDate(del.effectiveFrom)}{del.effectiveTo ? ` – ${fmtDate(del.effectiveTo)}` : ' onwards'}. Profit for transactions in that period becomes unavailable. The deletion is recorded in the audit log.</p>} />}
      {delExp && <ConfirmDialog danger title="Delete this expense?" confirmLabel="Delete expense" onClose={() => setDelExp(null)}
        onConfirm={() => void s.saveExpenses(s.expenses.filter((x) => x.id !== delExp.id), `Deleted expense ${EXPENSE_LABEL[delExp.type]} ${delExp.amount} for ${delExp.periodFrom}..${delExp.periodTo}`).catch(() => undefined)}
        body={<p className="text-[0.8125rem]">{EXPENSE_LABEL[delExp.type]}, {fmtINR2(delExp.amount)}, {fmtDate(delExp.periodFrom)} – {fmtDate(delExp.periodTo)}.</p>} />}
    </div>
  );
}
