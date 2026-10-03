import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { openSource } from '../adapters/source';
import { flipkartAdapter } from '../adapters/flipkart';
import { DEFAULT_EVENT_MAPPINGS, DEFAULT_SETTINGS } from '../schemas/defaults';

/** A minimal "Sales Report" workbook with the eight read columns filled in, as Flipkart writes them (all text). */
function salesWorkbook(): ArrayBuffer {
  const header = Array.from({ length: 60 }, (_, i) => `Col ${i + 1}`);
  const row = (order: string, event: string, amt: string) => {
    const r = Array.from({ length: 60 }, () => 'NA');
    r[1] = `OD${order}`; r[2] = order; r[5] = '"""SKU:OC-HURRICANE-GREY-1"""'; r[8] = event;
    r[13] = '1.0'; r[24] = amt; r[45] = '2026-06-07 00:00:00.0'; r[48] = 'Madhya Pradesh';
    return r;
  };
  const ws = XLSX.utils.aoa_to_sheet([header, row('337659376076106100', 'Sale', '8858.47'), row('437762488314570100', 'Return', '-3220.34')]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['help']]), 'Help');
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Report');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('Flipkart workbook with a wrong <dimension> tag', () => {
  it('reads every data row even when the sheet claims to be one row tall (A1:BH1)', async () => {
    const zip = await JSZip.loadAsync(salesWorkbook());
    const path = 'xl/worksheets/sheet2.xml';
    const xml = await zip.file(path)!.async('string');
    expect(xml).toMatch(/<dimension ref="[^"]+"\/>/);
    zip.file(path, xml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:BH1"/>'));
    const broken = await zip.generateAsync({ type: 'arraybuffer' });

    const src = openSource(broken, 'flipkart.xlsx');
    expect(src.grid('Sales Report').rowCount).toBe(3);
    const res = flipkartAdapter.parse(src, {
      settings: DEFAULT_SETTINGS, mappings: DEFAULT_EVENT_MAPPINGS, fileName: 'flipkart.xlsx', batchId: 'b1',
    });
    expect(res.transactions).toHaveLength(2);
    expect(res.rejected).toHaveLength(0);
    expect(res.transactions[0].sku).toBe('OC-HURRICANE-GREY-1');
    expect(res.transactions[0].rawQty).toBe(1);
    expect(res.transactions[1].rawTaxable).toBe(-3220.34);
    expect(res.warnings.filter((w) => w.code === 'SKU_FORMAT')).toHaveLength(0);
  });
});
