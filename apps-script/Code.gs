/**
 * E-commerce Analytics Dashboard — Google Sheets backend
 * =====================================================
 * A Google Apps Script web app that stores all dashboard data in THIS
 * spreadsheet. The dashboard (a static site on GitHub Pages) talks to it over
 * HTTPS; nothing else is needed — no server, no database.
 *
 * SETUP (full steps with screenshots-in-words: docs/GOOGLE_SHEETS_SETUP.md)
 *   1. Open your Google Spreadsheet → Extensions → Apps Script.
 *   2. Replace the contents of Code.gs with this file and save.
 *   3. Run the function `setup` once (authorise when asked). It creates the
 *      data sheets and an access token.
 *   4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   5. Copy the web app URL (ends in /exec) and the access token into the
 *      dashboard: Settings → Google Sheets.
 *
 * SECURITY
 *   "Anyone" access is required so a static site can call the script, so every
 *   request must carry the access token. Treat the token like a password. To
 *   revoke access, run `rotateToken` and enter the new token in the dashboard.
 *
 * All text is written into plain-text formatted cells, so a value such as
 * "=1+1" coming from an uploaded report is stored as text and never evaluated.
 */

var BACKEND_VERSION = '1.1.0';
var TXN_PAGE_MAX = 20000;
/** Google Sheets rejects a cell longer than 50,000 characters. */
var MAX_CELL_CHARS = 49000;

/** Table definitions. `num` lists numeric columns; every other column is stored as plain text. */
var TABLES = {
  Transactions: {
    headers: ['id', 'platform', 'txnDate', 'rawDate', 'orderId', 'orderItemId', 'sku', 'rawSku', 'eventSubType',
      'txnType', 'rawQty', 'rawTaxable', 'state', 'rawState', 'batchId', 'sourceFile', 'sourceRow', 'occurrence'],
    num: ['rawQty', 'rawTaxable', 'sourceRow', 'occurrence']
  },
  ImportBatches: {
    headers: ['batchId', 'platform', 'fileName', 'fileHash', 'importedAt', 'importedBy', 'sourceRows', 'emptyRows',
      'acceptedRows', 'rejectedRows', 'duplicateInFile', 'duplicateExisting', 'unmappedEvents', 'dateFrom', 'dateTo',
      'grossSalesValue', 'returnValue', 'cancellationValue', 'grossSoldUnits', 'returnedUnits', 'status', 'dependsOn'],
    num: ['sourceRows', 'emptyRows', 'acceptedRows', 'rejectedRows', 'duplicateInFile', 'duplicateExisting',
      'grossSalesValue', 'returnValue', 'cancellationValue', 'grossSoldUnits', 'returnedUnits']
  },
  RejectedRows: {
    headers: ['batchId', 'sourceFile', 'sourceRow', 'reasons', 'raw'],
    num: ['sourceRow']
  },
  EventMappings: {
    headers: ['platform', 'eventValue', 'txnType', 'source', 'updatedAt'],
    num: [],
    replaceable: true
  },
  ProductCosts: {
    headers: ['id', 'canonicalProductId', 'sku', 'platform', 'effectiveFrom', 'effectiveTo', 'unitCost',
      'packagingCost', 'otherCost', 'notes', 'updatedBy', 'updatedAt'],
    num: ['unitCost', 'packagingCost', 'otherCost'],
    replaceable: true
  },
  Expenses: {
    headers: ['id', 'platform', 'sku', 'type', 'periodFrom', 'periodTo', 'amount', 'notes', 'updatedBy', 'updatedAt'],
    num: ['amount'],
    replaceable: true
  },
  SkuAliases: {
    headers: ['platform', 'platformSku', 'canonicalProductId'],
    num: [],
    replaceable: true
  },
  Settings: {
    headers: ['key', 'value'],
    num: [],
    replaceable: true
  },
  AuditLog: {
    headers: ['at', 'user', 'action', 'detail'],
    num: []
  },
  /** Scratch sheet used only by the selfTest action; created and deleted within one request. */
  _SelfTest: {
    headers: ['text', 'number'],
    num: ['number']
  }
};

/** Sheets that setup() creates. */
var DATA_TABLES = ['Transactions', 'ImportBatches', 'RejectedRows', 'EventMappings', 'ProductCosts', 'Expenses', 'SkuAliases', 'Settings', 'AuditLog'];

/* ------------------------------------------------------------------ */
/* Spreadsheet menu and one-time setup                                  */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Analytics Backend')
    .addItem('Set up / repair data sheets', 'setup')
    .addItem('Show access token', 'showToken')
    .addItem('Create a new access token', 'rotateToken')
    .addToUi();
}

function setup() {
  var ss = getSpreadsheet_();
  for (var i = 0; i < DATA_TABLES.length; i++) ensureSheet_(ss, DATA_TABLES[i]);
  var token = getToken_() || newToken_();
  var msg = 'Data sheets are ready.\n\nAccess token (paste into the dashboard, keep it private):\n\n' + token +
    '\n\nNext: Deploy → New deployment → Web app → Execute as "Me", Who has access "Anyone".';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor: see the execution log */ }
}

function showToken() {
  var token = getToken_() || newToken_();
  Logger.log('Access token: ' + token);
  try { SpreadsheetApp.getUi().alert('Access token:\n\n' + token); } catch (e) { /* see log */ }
}

function rotateToken() {
  var token = newToken_();
  Logger.log('New access token: ' + token);
  try {
    SpreadsheetApp.getUi().alert('New access token (the old one no longer works):\n\n' + token);
  } catch (e) { /* see log */ }
}

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('API_TOKEN');
}

function newToken_() {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  return token;
}

function getSpreadsheet_() {
  // Bound script: the spreadsheet it lives in. Standalone script: set the
  // SPREADSHEET_ID script property to the target spreadsheet's id.
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/* ------------------------------------------------------------------ */
/* HTTP entry points                                                    */
/* ------------------------------------------------------------------ */

function doGet() {
  // No data is ever returned without the token.
  return json_({ ok: true, data: { service: 'ecom-analytics-backend', version: BACKEND_VERSION } });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = getToken_();
    if (!expected) return json_({ ok: false, error: 'Backend is not set up. Run the setup function in Apps Script.' });
    if (!safeEqual_(String(req.token || ''), expected)) return json_({ ok: false, error: 'Invalid access token.' });
    var handler = ACTIONS[req.action];
    if (!handler) return json_({ ok: false, error: 'Unknown action: ' + req.action });
    var payload = req.payload || {};
    // Every action runs under the script lock, reads included, so a page of
    // transactions can never be read while another request is rewriting the sheet.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return json_({ ok: true, data: handler.run(payload) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

var ACTIONS = {
  ping: {
    run: function () {
      var ss = getSpreadsheet_();
      return {
        version: BACKEND_VERSION,
        spreadsheetName: ss.getName(),
        dataVersion: dataVersion_(),
        transactionCount: rowCount_(ensureSheet_(ss, 'Transactions'))
      };
    }
  },

  /** Everything except transactions (which are paged separately). */
  bootstrap: {
    run: function () {
      var ss = getSpreadsheet_();
      var audit = readTable_(ss, 'AuditLog');
      return {
        version: BACKEND_VERSION,
        spreadsheetName: ss.getName(),
        dataVersion: dataVersion_(),
        transactionCount: rowCount_(ensureSheet_(ss, 'Transactions')),
        batches: readTable_(ss, 'ImportBatches'),
        rejected: readTable_(ss, 'RejectedRows'),
        mappings: readTable_(ss, 'EventMappings'),
        costs: readTable_(ss, 'ProductCosts'),
        expenses: readTable_(ss, 'Expenses'),
        aliases: readTable_(ss, 'SkuAliases'),
        settings: readTable_(ss, 'Settings'),
        audit: audit.slice(Math.max(0, audit.length - 500))
      };
    }
  },

  getTransactions: {
    run: function (p) {
      var sheet = ensureSheet_(getSpreadsheet_(), 'Transactions');
      var total = rowCount_(sheet);
      var offset = Math.max(0, Number(p.offset) || 0);
      var limit = Math.min(TXN_PAGE_MAX, Math.max(1, Number(p.limit) || TXN_PAGE_MAX));
      var n = Math.max(0, Math.min(limit, total - offset));
      var rows = n > 0 ? sheet.getRange(2 + offset, 1, n, TABLES.Transactions.headers.length).getValues() : [];
      return { total: total, offset: offset, rows: rows, dataVersion: dataVersion_() };
    }
  },

  /** Append transactions; ids that already exist are skipped, so a retry or re-import cannot double-count. */
  appendTransactions: {
    run: function (p) {
      var sheet = ensureSheet_(getSpreadsheet_(), 'Transactions');
      var rows = p.rows || [];
      var width = TABLES.Transactions.headers.length;
      var existing = {};
      var count = rowCount_(sheet);
      if (count > 0) {
        var ids = sheet.getRange(2, 1, count, 1).getValues();
        for (var i = 0; i < ids.length; i++) existing[ids[i][0]] = true;
      }
      var fresh = [];
      var skipped = 0;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        if (!row || row.length !== width) throw new Error('Transaction row ' + r + ' has ' + (row ? row.length : 0) + ' columns, expected ' + width);
        var id = String(row[0]);
        if (!id) throw new Error('Transaction row ' + r + ' has no id');
        if (existing[id]) { skipped++; continue; }
        existing[id] = true;
        fresh.push(row);
      }
      appendRows_(sheet, 'Transactions', fresh);
      if (fresh.length) bumpDataVersion_();
      return { appended: fresh.length, skipped: skipped, dataVersion: dataVersion_(), transactionCount: rowCount_(sheet) };
    }
  },

  upsertBatch: {
    run: function (p) {
      var ss = getSpreadsheet_();
      var sheet = ensureSheet_(ss, 'ImportBatches');
      var row = p.row;
      if (!row || row.length !== TABLES.ImportBatches.headers.length) throw new Error('Invalid batch row');
      var count = rowCount_(sheet);
      if (count > 0) {
        var ids = sheet.getRange(2, 1, count, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(row[0])) {
            writeRows_(sheet, 'ImportBatches', 2 + i, [row]);
            return { updated: true };
          }
        }
      }
      appendRows_(sheet, 'ImportBatches', [row]);
      return { updated: false };
    }
  },

  /** Replace the rejected-row records of ONE batch (so retrying an import cannot duplicate them). */
  setRejected: {
    run: function (p) {
      var batchId = String(p.batchId || '');
      if (!batchId) throw new Error('batchId is required');
      var rows = p.rows || [];
      for (var r = 0; r < rows.length; r++) {
        if (String(rows[r][0]) !== batchId) throw new Error('Rejected row ' + r + ' belongs to another batch');
      }
      var sheet = ensureSheet_(getSpreadsheet_(), 'RejectedRows');
      cleanRows_('RejectedRows', rows); // validate before anything is removed
      removeWhere_(sheet, 'RejectedRows', 0, batchId);
      appendRows_(sheet, 'RejectedRows', rows);
      return { rows: rows.length };
    }
  },

  /** Remove every transaction and rejected row of a batch and mark the batch deleted (kept for the audit trail). */
  deleteBatch: {
    run: function (p) {
      var batchId = String(p.batchId || '');
      if (!batchId) throw new Error('batchId is required');
      var ss = getSpreadsheet_();
      var removed = removeWhere_(ensureSheet_(ss, 'Transactions'), 'Transactions', TABLES.Transactions.headers.indexOf('batchId'), batchId);
      removeWhere_(ensureSheet_(ss, 'RejectedRows'), 'RejectedRows', 0, batchId);
      var bs = ensureSheet_(ss, 'ImportBatches');
      var count = rowCount_(bs);
      var statusCol = TABLES.ImportBatches.headers.indexOf('status') + 1;
      if (count > 0) {
        var ids = bs.getRange(2, 1, count, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === batchId) bs.getRange(2 + i, statusCol).setValue('deleted');
        }
      }
      if (removed) bumpDataVersion_();
      return { removed: removed, dataVersion: dataVersion_() };
    }
  },

  /** Replace a small configuration table in full. */
  replaceTable: {
    run: function (p) {
      var def = TABLES[p.table];
      if (!def || !def.replaceable) throw new Error('Table cannot be replaced: ' + p.table);
      var rows = p.rows || [];
      for (var r = 0; r < rows.length; r++) {
        if (!rows[r] || rows[r].length !== def.headers.length) throw new Error('Row ' + r + ' of ' + p.table + ' has the wrong number of columns');
      }
      var sheet = ensureSheet_(getSpreadsheet_(), p.table);
      var count = rowCount_(sheet);
      // New rows are written over the old ones first and only the left-over tail is
      // cleared, so a failure part-way never leaves the table empty.
      writeRows_(sheet, p.table, 2, rows);
      if (count > rows.length) sheet.getRange(2 + rows.length, 1, count - rows.length, def.headers.length).clearContent();
      return { rows: rows.length };
    }
  },

  /** Rewrite the stored txnType column from the current EventMappings table. */
  reclassify: {
    run: function () {
      var ss = getSpreadsheet_();
      var maps = readTable_(ss, 'EventMappings');
      var index = {};
      for (var i = 0; i < maps.length; i++) index[eventKey_(maps[i][0], maps[i][1])] = maps[i][2];
      var sheet = ensureSheet_(ss, 'Transactions');
      var count = rowCount_(sheet);
      if (count === 0) return { changed: 0, dataVersion: dataVersion_() };
      var h = TABLES.Transactions.headers;
      var platformCol = h.indexOf('platform') + 1;
      var eventCol = h.indexOf('eventSubType') + 1;
      var typeCol = h.indexOf('txnType') + 1;
      var platforms = sheet.getRange(2, platformCol, count, 1).getValues();
      var events = sheet.getRange(2, eventCol, count, 1).getValues();
      var types = sheet.getRange(2, typeCol, count, 1).getValues();
      var changed = 0;
      for (var r = 0; r < count; r++) {
        var t = index[eventKey_(platforms[r][0], events[r][0])] || 'UNMAPPED';
        if (types[r][0] !== t) { types[r][0] = t; changed++; }
      }
      if (changed) {
        sheet.getRange(2, typeCol, count, 1).setValues(types);
        bumpDataVersion_();
      }
      return { changed: changed, dataVersion: dataVersion_() };
    }
  },

  /** Rewrite the stored `state` column after a state-name alias is approved. `map` is rawState -> state. */
  remapStates: {
    run: function (p) {
      var map = p.map || {};
      var sheet = ensureSheet_(getSpreadsheet_(), 'Transactions');
      var count = rowCount_(sheet);
      if (count === 0) return { changed: 0, dataVersion: dataVersion_() };
      var h = TABLES.Transactions.headers;
      var stateCol = h.indexOf('state') + 1;
      var raws = sheet.getRange(2, h.indexOf('rawState') + 1, count, 1).getValues();
      var states = sheet.getRange(2, stateCol, count, 1).getValues();
      var changed = 0;
      for (var r = 0; r < count; r++) {
        var key = String(raws[r][0]);
        if (Object.prototype.hasOwnProperty.call(map, key) && states[r][0] !== map[key]) {
          states[r][0] = String(map[key]);
          changed++;
        }
      }
      if (changed) {
        sheet.getRange(2, stateCol, count, 1).setValues(states);
        bumpDataVersion_();
      }
      return { changed: changed, dataVersion: dataVersion_() };
    }
  },

  /**
   * Writes awkward values through the same code path as real data, reads them
   * back and reports any that changed. Run automatically when the dashboard
   * connects, so storage fidelity is checked on Google's servers, not assumed.
   */
  selfTest: {
    run: function () {
      var ss = getSpreadsheet_();
      var name = '_SelfTest';
      var old = ss.getSheetByName(name);
      if (old) ss.deleteSheet(old);
      var sheet = ensureSheet_(ss, name);
      var cases = [
        ['=1+1', 1.5], ['+91-9999', -2], ['-ABC', 0], ['@cmd', 1234567.89], ['0012', 0.01], ['1e5', 100000],
        ["'quoted", 1], ['2026-06-10', 2], ['10/06/2026', 3], ['12345678901234567890', 4], ['TRUE', 5],
        ['  padded  ', 6], ['SKU:OC-07-BLACK', -1500.25]
      ];
      appendRows_(sheet, name, cases);
      var back = readTable_(ss, name);
      ss.deleteSheet(sheet);
      var results = [];
      var allOk = back.length === cases.length;
      for (var i = 0; i < cases.length; i++) {
        var got = back[i] || [];
        var ok = got[0] === cases[i][0] && got[1] === cases[i][1];
        if (!ok) allOk = false;
        results.push({ wrote: cases[i], read: [got[0] === undefined ? null : String(got[0]), got[1] === undefined ? null : got[1]], ok: ok });
      }
      return { ok: allOk, results: results };
    }
  },

  appendAudit: {
    run: function (p) {
      appendRows_(ensureSheet_(getSpreadsheet_(), 'AuditLog'), 'AuditLog', p.rows || []);
      return { appended: (p.rows || []).length };
    }
  }
};

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                        */
/* ------------------------------------------------------------------ */

function eventKey_(platform, eventValue) {
  return String(platform) + '|' + String(eventValue).replace(/\s+/g, ' ').trim().toLowerCase();
}

function ensureSheet_(ss, name) {
  var def = TABLES[name];
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  var width = def.headers.length;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  var head = sheet.getRange(1, 1, 1, width);
  var current = head.getValues()[0];
  var same = true;
  for (var i = 0; i < width; i++) if (String(current[i]) !== def.headers[i]) same = false;
  if (!same) {
    if (sheet.getLastRow() > 1) {
      throw new Error('Sheet "' + name + '" has unexpected column headers. Rename or remove that sheet, then run setup again.');
    }
    head.setNumberFormat('@');
    head.setValues([def.headers]);
    head.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Number of data rows (excludes the header). */
function rowCount_(sheet) {
  return Math.max(0, sheet.getLastRow() - 1);
}

function formatsFor_(name, nRows) {
  var def = TABLES[name];
  var one = [];
  for (var c = 0; c < def.headers.length; c++) one.push(def.num.indexOf(def.headers[c]) >= 0 ? '0.############' : '@');
  var out = [];
  for (var r = 0; r < nRows; r++) out.push(one);
  return out;
}

function cleanRows_(name, rows) {
  var def = TABLES[name];
  var isNum = [];
  for (var c = 0; c < def.headers.length; c++) isNum.push(def.num.indexOf(def.headers[c]) >= 0);
  var out = [];
  for (var r = 0; r < rows.length; r++) {
    var row = [];
    for (var k = 0; k < isNum.length; k++) {
      var v = rows[r][k];
      if (isNum[k]) {
        var n = Number(v);
        row.push(v === '' || v === null || v === undefined || isNaN(n) ? '' : n);
      } else {
        var text = v === null || v === undefined ? '' : String(v);
        if (text.length > MAX_CELL_CHARS) {
          throw new Error(name + ' row ' + r + ', column "' + def.headers[k] + '": text is ' + text.length + ' characters; a cell holds at most ' + MAX_CELL_CHARS + '.');
        }
        // Sheets consumes ONE leading apostrophe as a "this is text" marker. Doubling it
        // keeps a value that genuinely starts with an apostrophe intact.
        row.push(text.charAt(0) === "'" ? "'" + text : text);
      }
    }
    out.push(row);
  }
  return out;
}

/** Write rows starting at `startRow`. Formats are set BEFORE values so text is never parsed as a formula. */
function writeRows_(sheet, name, startRow, rows) {
  if (!rows.length) return;
  var width = TABLES[name].headers.length;
  var clean = cleanRows_(name, rows); // validates every cell before the sheet is touched
  var needed = startRow + rows.length - 1;
  if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  var range = sheet.getRange(startRow, 1, rows.length, width);
  range.setNumberFormats(formatsFor_(name, rows.length));
  range.setValues(clean);
}

function appendRows_(sheet, name, rows) {
  writeRows_(sheet, name, sheet.getLastRow() + 1, rows);
}

function readTable_(ss, name) {
  var sheet = ensureSheet_(ss, name);
  var count = rowCount_(sheet);
  if (count === 0) return [];
  return sheet.getRange(2, 1, count, TABLES[name].headers.length).getValues();
}

/** Remove all rows whose column `colIndex0` equals `value`. Returns the number removed. */
function removeWhere_(sheet, name, colIndex0, value) {
  var count = rowCount_(sheet);
  if (count === 0) return 0;
  var width = TABLES[name].headers.length;
  var range = sheet.getRange(2, 1, count, width);
  var values = range.getValues();
  var keep = [];
  for (var i = 0; i < values.length; i++) if (String(values[i][colIndex0]) !== value) keep.push(values[i]);
  var removed = values.length - keep.length;
  if (removed === 0) return 0;
  // Kept rows are written over the top first; only the left-over tail is cleared.
  // If the request dies in between, surviving rows may appear twice but none is lost,
  // and appendTransactions skips ids that already exist.
  writeRows_(sheet, name, 2, keep);
  sheet.getRange(2 + keep.length, 1, removed, width).clearContent();
  return removed;
}

function dataVersion_() {
  return Number(PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || 0);
}

function bumpDataVersion_() {
  PropertiesService.getScriptProperties().setProperty('DATA_VERSION', String(dataVersion_() + 1));
}
