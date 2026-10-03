# Marketplace Analytics — e-commerce analytics & profitability dashboard

A static web app (React + TypeScript) that turns marketplace sales reports into
revenue, returns, SKU, state and profitability analytics. It is hosted on
**GitHub Pages** and stores all its data in **your Google Spreadsheet** through
a small Google Apps Script web app. There is no other server and no database.

Flipkart is implemented end to end. Amazon, Myntra and Shopify have adapter
slots that are deliberately empty until a real report of each is available.

```
Browser (GitHub Pages, static files)
  ├─ parses the uploaded workbook locally, in a Web Worker
  ├─ calculation engine (TypeScript, unit-tested)
  └─ HTTPS + access token ──►  Google Apps Script web app  ──►  your Google Spreadsheet
                                (apps-script/Code.gs)            Transactions, ImportBatches, RejectedRows,
                                                                 EventMappings, ProductCosts, Expenses,
                                                                 SkuAliases, Settings, AuditLog
```

The uploaded report file itself never leaves the browser. Only the eight
extracted fields per row are sent to your spreadsheet.

---

## Read this first: what has and has not been verified

| | Status |
|---|---|
| Calculation engine, importer, exports | 93 automated tests pass; browser smoke test passes against the production build |
| Flipkart **real** workbook | **Not verified.** No real Flipkart file was available. The importer follows the column positions in the brief and was tested with a clearly labelled synthetic workbook (`fixtures/SYNTHETIC_…`). |
| Default event mapping (`Sale`, `Return`, `Cancellation`) | **Unverified defaults.** Confirm them on the Event mapping tab of your first import. Any other value (e.g. `Return Cancellation`) stays *Unmapped* until you map it. |
| Sign convention of returns | Not assumed. Returns are reported positive whether the source writes them negative or positive. |
| Cancellation treatment | **Your decision.** Default: reported separately. The import screen shows how many cancellation rows match a Sale row so you can choose (Settings → Accounting policy). |
| Google Apps Script backend | Logic tested against an in-memory stand-in for Google Sheets. **Not yet run on Google's servers.** The dashboard runs a storage self-test every time it connects and reports any value that does not round-trip. Do the smoke test in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) after deploying. |
| SheetJS version | `package.json` pins **0.20.3** from SheetJS's own CDN (the npm copy, 0.18.5, has known vulnerabilities when reading untrusted files). The build environment used to develop this could not reach that CDN, so tests here ran against 0.18.5. CI runs the full test suite and smoke test on 0.20.3 before every deploy; a failure blocks the deploy. |
| Deployment | **Not deployed.** This is source code plus instructions. |

---

## Quick start

```bash
npm install
npm test          # 93 unit tests
npm run dev       # http://localhost:5173
```

Try it without any setup: Import Center → upload
`fixtures/SYNTHETIC_flipkart_sales_report.xlsx` (regenerate with `npm run fixture`).
Until Google Sheets is connected, data is kept in the browser only and the app
says so on every page.

Requirements: Node.js 20 or newer.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | 93 unit tests (calculations, importer, backend logic, store) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run smoke` | Browser test of the built app (needs `npm run build` and `npm run fixture`; first run `npx playwright install chromium`) |
| `npm run fixture` | Regenerate the synthetic workbook |

## Set up and deploy

1. **Google Sheets backend** — [docs/GOOGLE_SHEETS_SETUP.md](docs/GOOGLE_SHEETS_SETUP.md) (about 5 minutes).
2. **GitHub Pages** — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), including the checklist and smoke tests.
3. Open the site → Settings → Google Sheets → paste the web app URL and access token → Connect.

No environment variables are required. See `.env.example` for the one optional,
non-secret variable. **Never put the access token in the repository or in an
environment variable**: everything in a static build is public.

## How the numbers are calculated

Every formula, its source fields, classification rules, assumptions and
limitations are in **[docs/CALCULATIONS.md](docs/CALCULATIONS.md)**. In short:

- Gross Sales Value = Σ taxable value of rows classified **Sale**.
- Return Value = Σ |taxable value| of rows classified **Return** (shown positive).
- Net Sales Value = Gross − Returns (− Cancellations only under the *reversal* policy; never twice).
- Classification comes only from the Event Sub Type mapping table. Nothing is inferred from a sign or from words inside a value.
- Profit is shown only when a cost record covers every transaction date of a SKU. Otherwise: “Profitability unavailable — product cost data required.”

## Project structure

```
apps-script/Code.gs        Google Sheets backend (paste into Apps Script)
src/
  adapters/                one adapter per marketplace → canonical Transaction
    flipkart/              implemented
    amazon|myntra|shopify/ prepared, not implemented
  analytics/               pure calculation engine (no UI, no I/O)
    transactions/          classification, duplicate detection, filters
    revenue/ quantities/   totals; raw → reporting conversion
    returns/               cohort linkage
    profitability/         cost lookup, profit, expense allocation
    sku-classification/    SKU rows and rule-based flags
    movement/              velocity windows, report coverage, gaps
    date-ranges/           presets, previous period, time series
    quality/               data-quality checks, reconciliation
  schemas/                 Flipkart column schema, default settings and mappings
  storage/                 store, Sheets client, row codecs, browser cache
  workers/                 file parsing off the main thread
  reports/                 report definitions and Excel / CSV / PDF writers
  app/ components/ modules/ UI
  tests/                   unit tests, Apps Script mock, synthetic fixture generator
scripts/                   fixture generator, browser smoke test
docs/                      calculations, Google Sheets setup, deployment
```

Parsing, calculation and presentation are separate layers: `analytics/` imports
nothing from the UI, and adapters only produce `Transaction` records.

### Adding a marketplace

1. Describe its report in `src/schemas/<platform>.ts`.
2. Implement `checkStructure()` and `parse()` in `src/adapters/<platform>/index.ts`, emitting canonical `Transaction` records.
3. Add its default event mappings in `src/schemas/defaults.ts` (only values verified against a real file).
4. Add adapter tests, then set `implemented: true`. The analytics engine, storage and UI need no change.

## Differences from the original brief

- **Backend:** Google Apps Script + Google Sheets, as requested, instead of FastAPI + PostgreSQL. Consequences: one shared access token rather than per-user accounts (the “Updated by” name is self-declared in Settings); practical ceiling of roughly 500,000 transactions per spreadsheet (Google's 10-million-cell limit); Apps Script requests are limited to 6 minutes, so imports are sent in chunks of 4,000 rows.
- **Components:** small hand-written Tailwind components in the style of shadcn/ui, rather than the shadcn/ui package.
- **Tables:** analysis tables are paginated (one page in the DOM at a time); the transaction explorer is virtualised.
- **Return cost policy:** one policy for all returns, because the report does not say whether a unit came back resalable.
- **Cross-marketplace features** exist (SKU → canonical product mapping, comparison page) but only Flipkart can supply data today.

## Security and privacy

- Report files are parsed in the browser and never uploaded. Only extracted fields go to your spreadsheet.
- The production build carries a Content-Security-Policy that allows scripts only from the site itself and network calls only to Google Apps Script.
- File type is checked by content (magic bytes), not just by extension; size limit is configurable.
- Spreadsheet text is stored in plain-text cells so a value like `=1+1` is never evaluated; exports prefix such text with an apostrophe.
- The access token is typed in at runtime and kept in that browser's storage. Rotate it from the spreadsheet menu (Analytics Backend → Create a new access token).
- Deleting data: delete an import in Import History (removes its rows from the spreadsheet), or delete browser data in Settings.
- The GitHub Pages site is public, but it contains no data: without the token it shows an empty dashboard.
