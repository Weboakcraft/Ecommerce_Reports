/**
 * Browser smoke test against the PRODUCTION build (run `npm run build` first).
 *   npm run smoke
 * It serves dist/, imports the synthetic fixture through the real UI, checks the
 * dashboard figures against the calculation engine, then connects to a mocked
 * Google Sheets backend (apps-script/Code.gs running against an in-memory
 * spreadsheet) and checks that data round-trips through it.
 * Screenshots are written to ./smoke-output/.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { computeTotals } from '../src/analytics/revenue/totals';
import { loadBackend } from '../src/tests/appsScriptMock';
import { demoRows } from '../src/tests/fixtures/synthetic';
import { parseRows } from '../src/tests/helpers';

const OUT = 'smoke-output';
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const FAKE_URL = 'https://script.google.com/macros/s/SMOKETEST/exec';

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const int = (n: number) => new Intl.NumberFormat('en-IN').format(n);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const file = join('dist', path === '/' ? 'index.html' : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(4173, r));

  const problems: string[] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
    if (!ok) problems.push(name);
  };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // Mock Google Sheets backend: the real Code.gs logic over an in-memory spreadsheet.
  const backend = loadBackend();
  backend.api.setup();
  const token = backend.props.get('API_TOKEN')!;
  let backendCalls = 0;
  await ctx.route(FAKE_URL, async (route) => {
    backendCalls++;
    const res = backend.api.doPost({ postData: { contents: route.request().postData() ?? '{}' } });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: res.text });
  });

  const shot = async (name: string, p: Page = page) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const bodyText = async () => (await page.locator('body').innerText()).replace(/ /g, ' ');

  // Expected figures straight from the engine.
  const parsed = parseRows(demoRows());
  const expected = computeTotals(parsed.transactions, 'separate');

  await page.goto('http://localhost:4173/');
  await page.getByText('No sales data yet').waitFor();
  check('Empty state shown before any import', true);
  await shot('01-empty');

  // ---- import through the UI ----
  await page.goto('http://localhost:4173/#/import');
  await page.locator('input[type=file]').setInputFiles('fixtures/SYNTHETIC_flipkart_sales_report.xlsx');
  await page.getByText('Review: SYNTHETIC_flipkart_sales_report.xlsx').waitFor({ timeout: 60000 });
  let text = await bodyText();
  check('Review shows source row count', text.includes(int(parsed.sourceRows)), int(parsed.sourceRows));
  check('Review shows 4 rejected rows', /Rejected rows\s*4/.test(text));
  check('Unmapped event surfaced', text.includes('Return Cancellation'));
  await shot('02-import-review');
  await page.getByRole('tab', { name: /Event mapping/ }).click();
  await shot('03-import-mapping');
  await page.getByRole('tab', { name: /Rejected rows/ }).click();
  check('Rejected rows list reasons', (await bodyText()).includes('Buyer Invoice Date (AT)'));
  await page.getByRole('button', { name: /^Import [\d,]+ rows$/ }).click();
  await page.getByText('Import complete').waitFor({ timeout: 60000 });
  await shot('04-import-done');

  // ---- overview figures must equal the engine ----
  await page.goto('http://localhost:4173/#/overview');
  await page.getByText('Gross Sales Value').first().waitFor();
  text = await bodyText();
  check('Gross Sales Value matches engine', text.includes(inr(expected.grossSalesValue)), inr(expected.grossSalesValue));
  check('Return Value matches engine', text.includes(inr(expected.returnValue)), inr(expected.returnValue));
  check('Net Sales Value matches engine', text.includes(inr(expected.netSalesValue)), inr(expected.netSalesValue));
  check('Gross Sold Units matches engine', text.includes(int(expected.grossSoldUnits)), int(expected.grossSoldUnits));
  check('Unique Orders matches engine', text.includes(int(expected.uniqueOrders)), int(expected.uniqueOrders));
  check('Profit is not fabricated', text.includes('Profitability unavailable — product cost data required.'));
  await page.waitForTimeout(600);
  await shot('05-overview');

  // ---- filters update KPIs ----
  await page.getByLabel('Date range').selectOption('custom');
  await page.getByLabel('From (inclusive)').fill('2026-06-01');
  await page.getByLabel('To (inclusive)').fill('2026-06-30');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  const june = computeTotals(parsed.transactions.filter((t) => t.txnDate >= '2026-06-01' && t.txnDate <= '2026-06-30'), 'separate');
  await page.waitForTimeout(400);
  text = await bodyText();
  check('Date filter: June net sales matches engine', text.includes(inr(june.netSalesValue)), inr(june.netSalesValue));
  check('Previous-period comparison shown', text.includes('prev.'));
  await shot('06-overview-june');

  for (const [id, label] of [['sku', 'SKU Analytics'], ['pnl', 'Profit & Loss'], ['returns', 'Returns Intelligence'], ['movement', 'Product Movement'], ['states', 'State Analytics'], ['marketplaces', 'Marketplace Comparison'], ['reports', 'Reports']] as const) {
    await page.goto(`http://localhost:4173/#/${id}`);
    await page.getByRole('heading', { name: label, level: 1 }).waitFor();
    await page.waitForTimeout(300);
    await shot(`07-${id}`);
    const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`Page renders without horizontal overflow: ${label}`, w <= 1, `${w}px`);
  }

  // cohort view
  await page.goto('http://localhost:4173/#/returns');
  await page.getByRole('button', { name: 'Cohort view' }).click();
  check('Cohort view shows linkage check', (await bodyText()).includes('Linkage check'));
  await shot('08-returns-cohort');

  // ---- exports ----
  await page.goto('http://localhost:4173/#/reports');
  for (const kind of ['Excel', 'CSV', 'PDF']) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: `Download SKU Performance Report as ${kind}` }).click(),
    ]);
    const path = `${OUT}/${dl.suggestedFilename()}`;
    await dl.saveAs(path);
    check(`Export downloads: SKU Performance (${kind})`, readFileSync(path).length > 500, dl.suggestedFilename());
  }
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Executive Summary as CSV' }).click()]);
  await dl2.saveAs(`${OUT}/executive-summary.csv`);
  const csv = readFileSync(`${OUT}/executive-summary.csv`, 'utf8');
  check('Export records the applied filters', csv.includes('1 Jun 2026 to 30 Jun 2026'));
  check('Export figure matches filtered engine value', csv.includes(String(Math.round(june.grossSalesValue * 100) / 100)) || csv.includes(june.grossSalesValue.toFixed(2)), june.grossSalesValue.toFixed(2));

  // ---- re-import is idempotent ----
  await page.goto('http://localhost:4173/#/import');
  await page.locator('input[type=file]').setInputFiles('fixtures/SYNTHETIC_flipkart_sales_report.xlsx');
  await page.getByText('This exact file was already imported').waitFor({ timeout: 60000 });
  check('Re-import of the same file adds nothing', await page.getByRole('button', { name: 'Nothing new to import' }).isDisabled());
  await shot('09-reimport');
  await page.getByRole('button', { name: 'Cancel' }).first().click();

  // ---- reconciliation ----
  await page.getByRole('tab', { name: 'Reconciliation' }).click();
  await page.getByText(/All checks reconcile|Some checks do not reconcile/).waitFor();
  check('Reconciliation panel: all checks reconcile', (await bodyText()).includes('All checks reconcile'));
  await shot('10-reconciliation');

  // ---- costs → profit becomes available for a costed SKU ----
  await page.goto('http://localhost:4173/#/costs');
  await page.getByRole('button', { name: 'Add cost' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('SKU', { exact: false }).first().fill('OC-07-BLACK');
  await dlg.getByLabel('Effective From (inclusive)').fill('2026-01-01');
  await dlg.getByLabel('Unit Manufacturing Cost (₹)').fill('1500');
  await dlg.getByRole('button', { name: 'Save cost' }).click();
  await page.getByRole('cell', { name: 'OC-07-BLACK' }).first().waitFor();
  await shot('11a-costs');
  await page.goto('http://localhost:4173/#/pnl');
  await page.getByText('Cost data is incomplete.').waitFor();
  check('P&L shows partial cost coverage honestly', true);
  await shot('11-pnl-partial');

  // ---- connect Google Sheets (mock) and upload local data ----
  await page.goto('http://localhost:4173/#/settings');
  await page.getByLabel('Apps Script web app URL').fill(FAKE_URL);
  await page.getByLabel('Access token').fill(token);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByText('Connected', { exact: true }).waitFor({ timeout: 120000 });
  await shot('12-settings-connected');
  const stored = backend.call(token, 'ping').data.transactionCount as number;
  check('All transactions written to the spreadsheet backend', stored === parsed.transactions.length, `${stored} of ${parsed.transactions.length}`);
  const boot = backend.call(token, 'bootstrap').data;
  check('Batch, costs, mappings and audit stored in the spreadsheet', boot.batches.length === 1 && boot.costs.length === 1 && boot.mappings.length >= 3 && boot.audit.length > 0);

  // reload: data must come back from the backend, not from the browser
  await page.evaluate(() => indexedDB.deleteDatabase('ecom-analytics'));
  await page.goto('http://localhost:4173/#/overview');
  await page.reload();
  await page.getByText('Gross Sales Value').first().waitFor({ timeout: 60000 });
  text = await bodyText();
  check('After reload, figures load from the spreadsheet', text.includes(inr(june.grossSalesValue)) || text.includes(inr(expected.grossSalesValue)));
  check('Wrong token is rejected by the backend', backend.call('nope', 'ping').ok === false);

  // delete the batch → spreadsheet emptied
  await page.goto('http://localhost:4173/#/import');
  await page.getByRole('tab', { name: /Import history/ }).click();
  await page.getByRole('button', { name: /Delete import/ }).click();
  await page.getByRole('button', { name: 'Delete import', exact: true }).click();
  await page.getByText('Deleted', { exact: true }).waitFor({ timeout: 60000 });
  check('Deleting a batch removes its rows from the spreadsheet', backend.call(token, 'ping').data.transactionCount === 0);
  await shot('13-history-deleted');

  // ---- dark mode + mobile ----
  await page.goto('http://localhost:4173/#/settings');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.waitForTimeout(400);
  await shot('14-dark-settings');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mobile.newPage();
  await mp.goto('http://localhost:4173/#/import');
  await mp.locator('input[type=file]').setInputFiles('fixtures/SYNTHETIC_flipkart_sales_report.xlsx');
  await mp.getByRole('button', { name: /^Import [\d,]+ rows$/ }).click({ timeout: 60000 });
  await mp.getByText('Import complete').waitFor({ timeout: 60000 });
  await mp.goto('http://localhost:4173/#/overview');
  await mp.getByText('Gross Sales Value').first().waitFor();
  await mp.waitForTimeout(500);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Mobile: no horizontal page overflow', overflow <= 1, `${overflow}px`);
  await shot('15-mobile-overview', mp);
  await mp.screenshot({ path: `${OUT}/15b-mobile-top.png` });
  await mp.goto('http://localhost:4173/#/sku');
  await mp.waitForTimeout(400);
  const overflowSku = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('Mobile: SKU table scrolls inside its panel', overflowSku <= 1, `${overflowSku}px`);
  await mp.screenshot({ path: `${OUT}/16-mobile-sku.png` });
  await mp.emulateMedia({ colorScheme: 'dark' });
  await mp.goto('http://localhost:4173/#/overview');
  await mp.getByRole('button', { name: 'Switch to dark theme' }).click();
  await mp.waitForTimeout(500);
  await mp.setViewportSize({ width: 1280, height: 900 });
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: `${OUT}/17-dark-overview.png` });

  check('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  console.log(`\nBackend calls intercepted: ${backendCalls}`);
  await browser.close();
  server.close();
  if (problems.length) {
    console.error(`\n${problems.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
