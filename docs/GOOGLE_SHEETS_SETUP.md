# Google Sheets backend — setup

All dashboard data is stored in one Google Spreadsheet. A small Apps Script web
app (`apps-script/Code.gs`) is the only thing that reads or writes it.

## 1. Add the script to your spreadsheet

1. Open the Google Spreadsheet you want to use (a new, empty one is best).
2. **Extensions → Apps Script.**
3. Delete whatever is in `Code.gs`, paste the whole of `apps-script/Code.gs` from this project, and press Save.

## 2. Run setup

1. In the function drop-down at the top choose **`setup`** and press **Run**.
2. Google asks for permission the first time. Choose your account → *Advanced* → *Go to (project name)* → *Allow*. The script only needs access to this spreadsheet.
3. Switch back to the spreadsheet tab: a pop-up shows the **access token** (the script keeps “running” until you press OK). You now have nine sheets (`Transactions`, `ImportBatches`, `RejectedRows`, `EventMappings`, `ProductCosts`, `Expenses`, `SkuAliases`, `Settings`, `AuditLog`). Copy the token. (It is also written to the Apps Script execution log, and you can see it again any time: spreadsheet menu **Analytics Backend → Show access token**. Reload the spreadsheet if the menu is not there yet.)

## 3. Deploy as a web app

1. In Apps Script: **Deploy → New deployment**.
2. Click the gear next to *Select type* → **Web app**.
3. *Execute as:* **Me**. *Who has access:* **Anyone**.
4. **Deploy**, then copy the **Web app URL**. It ends in `/exec`.

> Why “Anyone”? A static site cannot sign in to Google on your behalf, so the
> script must accept requests without a Google login. Every request must carry
> the access token, and without it the script returns nothing. Treat the token
> like a password.

## 4. Connect the dashboard

Dashboard → **Settings → Google Sheets** → paste the web app URL and the token →
**Connect**. If the browser already holds imported data you are offered to
upload it.

On connecting, the dashboard runs a storage self-test: it writes awkward values
(`=1+1`, `0012`, `1e5`, a 20-digit id, a leading apostrophe …) to a temporary
sheet, reads them back and deletes the sheet. If any value comes back changed
you get a red message naming it. Please do not ignore that message.

## Updating the script later

Paste the new `Code.gs`, save, then **Deploy → Manage deployments → edit (pencil)
→ Version: New version → Deploy**. The URL stays the same. A *new deployment*
would create a different URL.

## Revoking access

Spreadsheet menu **Analytics Backend → Create a new access token**. The old
token stops working immediately; enter the new one in the dashboard.

## What is stored where

| Sheet | Contents |
|---|---|
| Transactions | One row per imported transaction: id, platform, reporting date, original date value, Order ID, Order Item ID, normalised and original SKU, Event Sub Type, canonical type, raw quantity, raw taxable value, normalised and original state, batch id, source file, source row, occurrence |
| ImportBatches | One row per import with its summary and status (`active`, `incomplete`, `deleted`) |
| RejectedRows | Rows that failed validation, with row number and reasons |
| EventMappings | Event Sub Type → Sale / Return / Cancellation / Exclude |
| ProductCosts, Expenses | Cost master and variable expenses |
| SkuAliases | Marketplace SKU → canonical product ID |
| Settings | Key / JSON value |
| AuditLog | Imports, deletions, mapping, cost and settings changes |

You may read these sheets, build your own pivots on them, or export them.
**Do not edit them by hand** (especially header rows and the `id` column): the
dashboard caches transactions by a version counter that manual edits do not
update. If you do edit, press the reload button in the dashboard afterwards.

## Limits to know about

- A Google Spreadsheet holds 10 million cells. `Transactions` uses 18 columns, so plan for about 500,000 transactions per spreadsheet.
- An Apps Script request may run for 6 minutes. Imports are sent 4,000 rows at a time, and each chunk re-checks existing ids, so very large sheets import more slowly.
- Deleting an import rewrites the `Transactions` sheet; on a very large sheet this can take a minute.
- If an import is interrupted (connection lost), it is marked **Incomplete** and a red banner appears. Import the same file again to finish it: rows already saved are skipped.
- Google applies daily quotas to Apps Script. Normal use (a few imports a day) is far below them.

## Using a standalone script instead of a bound one

If the script is not created from inside the spreadsheet, add a script property
`SPREADSHEET_ID` (Project Settings → Script properties) with the spreadsheet's
id. The custom menu is not available then; run `setup`, `showToken` and
`rotateToken` from the Apps Script editor and read the token in the execution log.
