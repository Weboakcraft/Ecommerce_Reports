# Calculations, classification rules, assumptions and limitations

This is the reference for every figure the dashboard shows. Where a rule is an
assumption rather than something verified against a real Flipkart file, it says so.

## 1. Data dictionary — Flipkart “Sales Report” sheet

Only these eight columns are read, **by position**. Header text is displayed in
the import preview for a visual check but never used for logic. Every other
column is ignored.

| Field | Excel column | 1-based index | 0-based index in code | Stored as |
|---|---|---:|---:|---|
| Order ID | B | 2 | 1 | `orderId` (text) |
| Order Item ID | C | 3 | 2 | `orderItemId` (text) |
| SKU | F | 6 | 5 | `rawSku` + normalised `sku` |
| Event Sub Type | I | 9 | 8 | `eventSubType` (trimmed) → `txnType` via mapping |
| Item Quantity | N | 14 | 13 | `rawQty` (signed, unchanged) |
| Taxable Value (Final Invoice Amount − Taxes) | Y | 25 | 24 | `rawTaxable` (signed, unchanged) |
| Buyer Invoice Date | AT | 46 | 45 | `rawDate` + `txnDate` (YYYY-MM-DD) |
| Customer's Billing State | AW | 49 | 48 | `rawState` + normalised `state` |

Source: `src/schemas/flipkart.ts`. Sheet name must be exactly `Sales Report`
(CSV files have no sheet names; they are read with the same positions and a
notice is shown). Number of header rows is a setting (default 1).

### Canonical transaction

Every marketplace adapter emits the same record (`src/types/index.ts`):
platform, transaction date, Order ID, Order Item ID, normalised SKU, Event Sub
Type, canonical transaction type, raw quantity, raw taxable value, reporting
state, import batch id, source file name, source row number — plus the original
SKU / date / state values, a fingerprint, an occurrence number and a
deterministic id.

### Validation at import

| Condition | Result |
|---|---|
| Date missing, unparseable, not a real calendar date, or outside 2000–2100 | Row **rejected** with reason |
| Quantity or taxable value missing or not numeric | Row **rejected** with reason |
| Id / SKU / event / state text longer than 300 characters | Row **rejected** with reason |
| All eight cells blank | Counted as a blank row |
| Blank SKU | Imported under `(blank SKU)`, warning |
| Blank Order ID / Order Item ID / Event Sub Type | Imported, warning |
| Quantity not a whole number | Imported as given, warning |
| Numeric text date readable two ways (e.g. 03/04/2026) | Imported using the day/month order setting, warning |
| Id stored as a number beyond 15–16 digits | Imported, warning (Excel may already have lost digits) |
| State not recognised | Imported as written, listed for review |

`source rows = valid + rejected + blank` always holds and is shown on the review
screen. Rejected rows are stored with row number and reasons and can be
downloaded. Warnings never alter a source value.

**Numbers.** Excel numeric cells, or text with optional sign, digits, Western
(`1,234,567`) or Indian (`12,34,567`) grouping and optional decimals, or
accounting parentheses `(1,234.50)` for negatives. Anything else — `1,50`,
`1e5`, `(-5)`, `12abc` — is rejected rather than guessed. The sign is preserved.

**Dates.** Excel serial numbers (1900 and 1904 systems); `2026-06-10`,
`2026/06/10`, with optional time; `10-06-2026`, `10/06/2026`, `10.06.2026`
(order from settings); `10-Jun-2026`, `10 June 2026`, `10-Jun-26`,
`Jun 10, 2026`. A value carrying a UTC offset is converted to the reporting
timezone; a value without one is taken as a wall-clock date. Invalid dates are
rejected, never replaced by today.

**SKU.** Trim, then remove exactly one leading `SKU:` (any letter case), then
trim again. Nothing else is changed. `SKU:OC-07-BLACK` → `OC-07-BLACK`.
If a normalised SKU still starts with a quote or contains `SKU:`, a warning is
raised (the source cell is probably wrapped in quotes) but the value is not
altered further.

**State.** Whitespace collapsed, case ignored, `&` read as `and`, punctuation
ignored; the result must then match the list of Indian states / UTs **exactly**,
or a short table of explicit renames (Orissa → Odisha, Pondicherry → Puducherry,
Uttaranchal → Uttarakhand, New Delhi → Delhi …), or an alias you approved in
Settings. No fuzzy matching. Anything else is kept as written and listed for review.

## 2. Transaction classification

`Event Sub Type` is the only input. Classification is an exact lookup (ignoring
letter case and repeated spaces) in the mapping table. No substring matching.

| Event value | Classified as | Status |
|---|---|---|
| `Sale` | Sale | **Unverified default** |
| `Return` | Return | **Unverified default** |
| `Cancellation` | Cancellation | **Unverified default** |
| anything else | Unmapped | Excluded from every metric until mapped |

The defaults were written without a real Flipkart file. On every import the
*Event mapping* tab lists each distinct value with its row count, sum of source
quantity, sum of source value and the number of negative rows, so they can be
checked. An administrator maps a value to Sale, Return, Cancellation or Exclude;
the rule is stored and applied to later uploads, and all stored transactions are
reprocessed when a rule changes.

A negative quantity or amount never makes a row a return. A Sale row with a
negative value stays a Sale, reduces Gross Sales as it stands, and is raised as
a data-quality warning.

## 3. Raw → reporting conversion

| Type | Reporting value | Reporting quantity |
|---|---|---|
| Sale | raw taxable value (signed) | raw quantity (signed) |
| Return | \|raw taxable value\| | \|raw quantity\| |
| Cancellation | \|raw taxable value\| | \|raw quantity\| |
| Exclude, Unmapped | not counted | not counted |

The absolute value is taken per row, so a source that writes returns as
negatives and one that writes them as positives give the same result, and a
negative return quantity is never subtracted twice. The raw values are stored
unchanged. If Return rows carry mixed signs, a data-quality warning is raised.

## 4. Revenue and quantity

| Metric | Formula |
|---|---|
| Gross Sales Value | Σ reporting value of Sale rows |
| Return Value | Σ reporting value of Return rows |
| Cancellation Value | Σ reporting value of Cancellation rows |
| Net Sales Value | Gross Sales Value − Return Value **− Cancellation Value only under the reversal policy** |
| Gross Sold Units | Σ reporting quantity of Sale rows |
| Returned Units | Σ reporting quantity of Return rows |
| Cancelled Units | Σ reporting quantity of Cancellation rows |
| Net Units | Gross Sold Units − Returned Units (− Cancelled Units under the reversal policy) |
| Unique Orders | distinct (platform, Order ID) among Sale rows |
| Unique Order Items | distinct (platform, Order Item ID) among Sale rows |
| Return Unit Rate | Returned Units ÷ Gross Sold Units × 100; blank if Gross Sold Units ≤ 0 |
| Return Value Rate | Return Value ÷ Gross Sales Value × 100; blank if Gross Sales Value ≤ 0 |
| Avg Selling Value per Sold Unit | Gross Sales Value ÷ Gross Sold Units |
| Avg Revenue per Order Item | Net Sales Value ÷ Unique Order Items |

All values are taxable value in INR (invoice amount excluding taxes).

### Cancellation policy (your decision)

- **Report separately** (default): cancellations are shown on their own and never touch Net Sales. Correct if cancelled orders do **not** appear among Sale rows.
- **Subtract as reversals**: Net Sales = Gross − Returns − Cancellations, subtracted exactly once. Correct if a cancelled order appears as a Sale row *and* a Cancellation row.

Which one matches your reports could not be determined without a real file.
The import screen and Settings → Accounting policy show the evidence from your
own data: how many Cancellation rows share an Order Item ID with a Sale row. A
high share points to *reversal*. The policy can be changed at any time; nothing
is re-imported.

### Dates and periods

- The only date used for Flipkart is Buyer Invoice Date. A return is counted on the return row's date.
- Date filters are inclusive at both ends.
- Previous period = the same number of days immediately before the selected range. If the range is one or more whole calendar months, the previous period is the same number of whole months.
- A percentage change is not shown when the previous value is zero or there is no imported data for the previous period. If imported data only partly covers the previous period, the page says so.
- Weeks start on Monday.

## 5. Duplicates and re-import

Fingerprint = platform + Order ID + Order Item ID + event + reporting date + SKU
+ raw quantity + raw taxable value. Rows with the same fingerprint are
*duplicate candidates*. Rows sharing only an Order ID, Order Item ID or SKU are
not (a sale and its return, or two items of one order, always differ).

Record id = hash(fingerprint + occurrence number within the file), so the same
file always produces the same ids.

- **Inside a file:** identical rows are all imported and flagged (default), or only the first is kept if you choose so.
- **Across files:** a row whose id is already stored is skipped (default), so re-importing a file adds nothing and overlapping files do not double-count. You may override this per import.
- **Overlapping files:** rows shared with an earlier file stay stored under the earlier import. That earlier import cannot be deleted while the later one exists; delete the later one first.
- **Same file, different reading:** if a setting that changes how rows are read (day/month order, timezone, header rows) changed since the file was imported, a re-import is blocked, because it would count the transactions twice.
- **Interrupted import:** marked *Incomplete* until the same file is imported again (rows already saved are skipped) or it is deleted.

Limitation: two genuinely separate transactions that are identical in all eight
fields cannot be told apart from a duplicate.

## 6. Returns: two views

- **Transaction-date view** (always available): each sale and return counted on its own date.
- **Cohort view**: a return is linked to a Sale row with the same platform + Order Item ID (or Order ID + SKU when the item id is blank) dated on or before the return; the earliest such sale is used, and the return is attributed to that sale's month. The share of return rows that link is shown. The cohort table is offered only when that share reaches the configured minimum (default 90%); otherwise the page explains why and keeps the transaction-date view. Unlinked returns are never placed in a cohort.

Assumption: that a return row carries the Order Item ID of its original sale.
This is tested on your data each time, not taken for granted.

## 7. Profitability

The Flipkart fields contain no cost. Profit therefore needs the Product Cost
Master and is otherwise shown as “Profitability unavailable — product cost data required.”

- Unit cost = manufacturing + packaging + other direct cost, from the record **effective on the transaction's date**. A marketplace-specific record overrides an “all marketplaces” record. A date with no record leaves the SKU's profit unavailable; another period's cost is never borrowed.
- Overlapping or duplicate effective periods are rejected when saving.

| Transaction | Cost effect |
|---|---|
| Sale | + quantity × unit cost |
| Return, policy *resalable* (default) | − quantity × unit cost |
| Return, policy *resalable, packaging lost* | − quantity × (manufacturing + other) |
| Return, policy *written off* | none |
| Cancellation, *reversal* policy | − quantity × unit cost |
| Cancellation, *separate* policy | none |

- Net COGS = Σ of the above. Gross Profit = Net Sales Value − Net COGS. Gross Margin % = Gross Profit ÷ Net Sales Value × 100.
- Contribution Profit = Gross Profit − variable expenses. Contribution Margin % = Contribution Profit ÷ Net Sales Value × 100.
- Variable expenses: an expense with a SKU is charged to that SKU; one without is shared across SKUs in proportion to their Gross Sales Value inside the expense period. When the reporting period overlaps only part of the expense period, the amount is pro-rated by days; with no date range selected, each expense counts in full. Shares are decided on the date + marketplace selection only, so a SKU filter never changes how much expense a SKU carries. With a state filter active no expenses are applied (they cannot be attributed to a state) and the page says so. An expense with no sales to carry it is reported as unallocated.
- A SKU is *loss-making* only if its contribution profit is negative **and** every one of its transactions has a cost.
- A total profit for a selection is shown only when every SKU in it is fully costed; otherwise the statement covers the costed SKUs and states the coverage.
- Profit is not shown while a transaction-type filter is active.

Limitations: a return uses the cost effective on the return date (the report
gives no verified link to the original sale); one return-cost policy applies to
all returns (the report does not say whether a unit was resalable).

## 8. Product movement

Measured back from the **reporting date** = the end of the selected date range,
or today when no range is selected. Revenue here is Gross Sales Value of Sale rows.

First / last recorded sale date; days since last sale; units in the last 7, 30,
90 days; revenue in the last 30 days and the 30 days before; growth %; average
daily units over a configurable window.

**Report coverage.** The span from the first to the last imported transaction
of a marketplace is what the reports cover. Rows dated after today are ignored
for this purpose. A stretch of 7 or more consecutive days (configurable) with
no transaction of any kind is treated as a missing report. A window is
*covered* only if it lies inside the span and touches no such stretch. Figures
from an uncovered window are marked incomplete, and inactivity is not judged.

## 9. SKU classification (all thresholds configurable)

| Flag | Rule | Default |
|---|---|---|
| Top revenue | top N by Net Sales Value in the period | N = 10 |
| Top volume | top N by Gross Sold Units | N = 10 |
| High return | Return Unit Rate ≥ X% and Gross Sold Units ≥ M | 20%, 10 units |
| Low movement | 1…U units sold in the last D days (window covered) | ≤ 5 units, 30 days |
| No recent sales | no Sale row in the last D days (window covered) | 30 days |
| Declining | sales value in the last W days down ≥ P% vs the W days before (both covered, earlier > 0) | 30 days, 30% |
| Loss-making | contribution profit < 0 with complete cost data | — |
| Insufficient data | fewer than K Sale rows up to the reporting date, or the movement window is not covered | 5 |

Each flag carries a note stating the numbers that triggered it (select a row in
SKU Analytics). “No recent sales” over a short window is not a statement that
stock is dead.

## 10. Data quality and reconciliation

Checks (report only): rejected rows, unmapped events, missing SKUs, blank ids,
blank events, duplicate candidates, negative Sale rows, zero-value Sale rows,
non-integer quantities, mixed-sign returns, unrecognised states, future-dated
rows, unusually high return rates, dates with no transactions, incomplete cost data.

Reconciliation recomputes each headline figure by independent routes — raw
row sums, and sums of the per-SKU, per-state, per-day and per-marketplace
groups — and compares them with the totals, under the current accounting
policy and filters.

## 11. Known limits

- Not verified against a real Flipkart workbook (see README).
- Amazon, Myntra and Shopify are not implemented.
- One shared access token; no per-user accounts or roles.
- Figures are taxable values. Marketplace fees, shipping and taxes are not in the eight fields and enter only if you record them as variable expenses.
