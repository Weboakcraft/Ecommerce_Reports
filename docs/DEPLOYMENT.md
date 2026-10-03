# Deployment — GitHub Pages

Nothing here has been deployed for you. These are the steps and the checks.

## 1. Create the repository

```bash
cd ecom-analytics-dashboard
git init -b main
git add .
git commit -m "Marketplace analytics dashboard"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Commit the `package-lock.json` that your first `npm install` creates, so later
installs are reproducible.

A public repository works on the free plan. GitHub Pages from a private
repository needs a paid plan. Either way the published site contains no data.

## 2. Turn on GitHub Pages

Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions.**

The workflow in `.github/workflows/deploy.yml` then runs on every push to `main`:

1. `npm install`
2. `npm test` — unit tests
3. `npm run build` — type-check and build
4. `npm run smoke` — imports the synthetic workbook in a real browser and checks the figures, filters, exports and the Google Sheets round trip (against a stand-in backend)
5. publishes `dist/`

If any step fails, nothing is published. The site address appears under
Settings → Pages (usually `https://<you>.github.io/<repo>/`). The build uses
relative paths and hash-based navigation, so it works from any sub-path with no
extra configuration.

Manual alternative: `npm run build`, then publish the contents of `dist/` on any
static host.

## 3. Checklist

- [ ] `npm install`, `npm test` and `npm run build` succeed locally
- [ ] Google Sheets backend set up ([GOOGLE_SHEETS_SETUP.md](GOOGLE_SHEETS_SETUP.md)); web app URL ends in `/exec`
- [ ] Pages source set to GitHub Actions; the workflow run is green
- [ ] The access token is **not** in the repository, in `.env`, or in repository secrets used at build time
- [ ] Your name is set in Settings → General (it is written to the audit log)

## 4. Smoke tests on the live site

Do these once after the first deploy. They are the checks that could not be run
during development, because they need Google's servers and a real Flipkart file.

1. **Connect.** Settings → Google Sheets → URL + token → Connect. Expect “Connected to “<your spreadsheet>””, and **no red self-test message**.
2. **Wrong token.** Disconnect, reconnect with one character changed. Expect “Invalid access token.”
3. **Import a real Flipkart Sales Report.**
   - The *Columns read* table shows the header text found above columns B, C, F, I, N, Y, AT, AW. Check each one is the field named beside it.
   - *Event mapping* tab: every Event Sub Type in your file is listed with row counts and the sum of quantity and value. Check `Sale`, `Return` and `Cancellation` are what you expect, and map anything unmapped.
   - Read the *Cancellation check* line and choose the cancellation policy in Settings → Accounting policy.
   - `source rows = valid + rejected + blank` must add up on the review screen.
4. **Compare with Excel.** In the workbook, filter Event Sub Type = Sale and sum column Y and column N. They must equal Gross Sales Value and Gross Sold Units on the Overview (All time, no filters). Do the same for Return.
5. **Spreadsheet.** Open the `Transactions` sheet: row count equals the imported rows; SKUs have no `SKU:` prefix; long order ids are intact; nothing shows as a formula or as scientific notation.
6. **Reload.** Refresh the page: the same figures come back. Open the site in another browser, connect, and see the same data.
7. **Re-import the same file.** Expect “This exact file was already imported” and “Nothing new to import”.
8. **Import Center → Reconciliation.** Expect “All checks reconcile”.
9. **Delete the import** in Import History. The `Transactions` sheet empties; the batch stays in the history as Deleted; the audit log records it.
10. **Exports.** Download one report as Excel, CSV and PDF; check the Summary sheet lists your filters and period.

If step 1 shows a self-test message, or step 5 shows altered values, stop and
fix that before relying on the data — it means Google Sheets is storing some
values differently from what the tests assumed.

## Updating

Push to `main`. For backend changes, paste the new `Code.gs` and publish a
**new version of the existing deployment** (see GOOGLE_SHEETS_SETUP.md) so the
URL does not change.
