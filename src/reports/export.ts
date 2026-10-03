import Papa from 'papaparse';
import { safeCell } from '../utils/sanitize';
import type { Cell, CellType, Report } from './build';

const stamp = () => {
  const d = new Date().toISOString(); // 2026-10-03T05:34:12.000Z -> 20261003-0534
  return `${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}`;
};
export const fileName = (r: Report, ext: string) => `${r.id}_${stamp()}.${ext}`;

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const NUM_FMT: Record<CellType, string | undefined> = {
  text: undefined, int: '#,##0', money: '#,##0.00', pct: '0.00"%"', dec: '#,##0.00',
};

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ] */
const sheetName = (n: string) => n.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

export async function exportExcel(r: Report): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 30 }, { width: 110 }];
  sum.addRow([safeCell(r.title)]).font = { bold: true, size: 14 };
  sum.addRow([]);
  for (const [k, v] of r.meta) sum.addRow([k, safeCell(v)]);
  sum.addRow([]);
  sum.addRow(['Sheets in this workbook']).font = { bold: true };
  for (const s of r.sheets) sum.addRow([sheetName(s.name), `${s.rows.length} row(s)${s.note ? ` — ${s.note}` : ''}`]);
  sum.addRow([]);
  sum.addRow(['Metric definitions']).font = { bold: true };
  for (const [k, v] of r.definitions) sum.addRow([k, v]);
  sum.getColumn(1).font = { bold: true };
  sum.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  for (const s of r.sheets) {
    const ws = wb.addWorksheet(sheetName(s.name), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({
      header: c.header,
      width: Math.min(60, Math.max(12, c.header.length + 2, ...s.rows.slice(0, 200).map((row) => String(row[s.columns.indexOf(c)] ?? '').length + 2))),
      style: { numFmt: NUM_FMT[c.type], alignment: { horizontal: c.type === 'text' ? 'left' : 'right' } },
    }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EAF3' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.height = 30;
    for (const row of s.rows) {
      ws.addRow(row.map((v, i) => (v === null ? null : s.columns[i].type === 'text' ? safeCell(String(v)) : v)));
    }
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    if (s.note) {
      ws.addRow([]);
      ws.addRow([`Note: ${s.note}`]).font = { italic: true };
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(r, 'xlsx'));
}

const csvCell = (v: Cell, type: CellType): string | number => {
  if (v === null) return '';
  if (type === 'text') return safeCell(String(v));
  return typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : safeCell(String(v));
};

/** One CSV: a metadata block, then each table under its own heading. */
export function exportCsv(r: Report): void {
  const lines: (string | number)[][] = [];
  for (const [k, v] of r.meta) lines.push([k, safeCell(v)]);
  for (const s of r.sheets) {
    lines.push([]);
    lines.push([`Table: ${s.name}`]);
    if (s.note) lines.push([`Note: ${s.note}`]);
    lines.push(s.columns.map((c) => c.header));
    for (const row of s.rows) lines.push(row.map((v, i) => csvCell(v, s.columns[i].type)));
  }
  lines.push([]);
  lines.push(['Metric definitions']);
  for (const [k, v] of r.definitions) lines.push([k, v]);
  const csv = '﻿' + Papa.unparse(lines);
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName(r, 'csv'));
}

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// The built-in PDF fonts have no rupee sign or typographic punctuation, so text is reduced to plain ASCII.
const ascii = (s: string) =>
  s.replace(/[–—−]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/×/g, 'x').replace(/÷/g, '/').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/Σ/g, 'Sum').replace(/₹/g, 'INR ').replace(/…/g, '...').replace(/[^\x20-\x7E]/g, '');
const pdfCell = (v: Cell, type: CellType): string => {
  if (v === null || v === '') return type === 'text' ? '' : '-';
  if (typeof v !== 'number') return ascii(String(v));
  return type === 'int' ? nf0.format(v) : type === 'pct' ? `${nf2.format(v)}%` : nf2.format(v);
};

export async function exportPdf(r: Report): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 32;
  doc.setFont('helvetica', 'bold').setFontSize(15).text(ascii(r.title), margin, 40);
  autoTable(doc, {
    startY: 52, theme: 'plain', margin: { left: margin, right: margin },
    body: r.meta.map(([k, v]) => [k, ascii(v)]),
    styles: { fontSize: 7.5, cellPadding: 1.5, overflow: 'linebreak' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130 } },
  });
  type WithTable = { lastAutoTable?: { finalY: number } };
  for (const s of r.sheets) {
    let y = ((doc as unknown as WithTable).lastAutoTable?.finalY ?? 60) + 22;
    if (y > doc.internal.pageSize.getHeight() - 90) {
      doc.addPage();
      y = 44;
    }
    doc.setFont('helvetica', 'bold').setFontSize(10).text(ascii(s.name), margin, y);
    if (s.note) {
      doc.setFont('helvetica', 'normal').setFontSize(7.5);
      const wrapped = doc.splitTextToSize(ascii(s.note), doc.internal.pageSize.getWidth() - margin * 2) as string[];
      doc.text(wrapped, margin, y + 11);
      y += wrapped.length * 9 + 2;
    }
    const wide = s.columns.length > 12;
    autoTable(doc, {
      startY: y + 6, margin: { left: margin, right: margin },
      head: [s.columns.map((c) => ascii(c.header))],
      body: s.rows.length ? s.rows.map((row) => row.map((v, i) => pdfCell(v, s.columns[i].type))) : [[{ content: 'No rows', colSpan: s.columns.length }]],
      styles: { fontSize: wide ? 5 : 7, cellPadding: wide ? 1.5 : 2.5, overflow: 'linebreak' },
      headStyles: { fillColor: [29, 43, 79], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 246, 243] },
      columnStyles: Object.fromEntries(s.columns.map((c, i) => [i, { halign: c.type === 'text' ? 'left' : 'right' }])),
    });
  }
  doc.addPage();
  doc.setFont('helvetica', 'bold').setFontSize(10).text('Metric definitions', margin, 44);
  autoTable(doc, {
    startY: 52, theme: 'plain', margin: { left: margin, right: margin },
    body: r.definitions.map(([k, v]) => [ascii(k), ascii(v)]),
    styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } },
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(120);
    doc.text(`${ascii(r.title)} - page ${i} of ${pages}`, margin, doc.internal.pageSize.getHeight() - 16);
    doc.setTextColor(0);
  }
  download(doc.output('blob'), fileName(r, 'pdf'));
}
