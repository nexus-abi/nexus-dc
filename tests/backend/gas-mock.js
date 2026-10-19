/* Minimal in-memory mock of the Google Apps Script services that backend/Code.gs uses.
   It lets the REAL Code.gs run under Node so the payment / subscription / admin logic can be tested without Google. */
const crypto = require('crypto'), vm = require('vm'), fs = require('fs');

function makeEnv(srcPath, opts = {}) {
  const clock = { t: opts.start || Date.UTC(2026, 9, 19, 4, 0, 0) };
  class FDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } static now() { return clock.t; } }
  const mails = [], store = {}; // sheet name -> {rows: [][], cols}
  const sheet = name => {
    const S = store[name];
    const api = {
      getMaxColumns: () => S.cols, getMaxRows: () => 1000, getLastColumn: () => (S.rows[0] || []).length,
      insertColumnsAfter: (a, n) => { S.cols += n; },
      getRange: (r, c, nr = 1, nc = 1) => ({
        setNumberFormat() { return this; },
        setValue(v) { while (S.rows.length < r) S.rows.push([]); S.rows[r - 1][c - 1] = typeof v === 'number' ? String(v) : v; return this; },
        setValues(vv) { vv.forEach((row, i) => { while (S.rows.length < r + i) S.rows.push([]); row.forEach((v, j) => { S.rows[r - 1 + i][c - 1 + j] = v; }); }); return this; }
      }),
      getDataRange: () => ({ getValues: () => { const w = Math.max(...S.rows.map(x => x.length), 0); return S.rows.map(r => Array.from({ length: w }, (_, i) => r[i] === undefined ? '' : r[i])); } }),
      appendRow: row => { S.rows.push(row.map(v => typeof v === 'number' ? String(v) : v)); },
      deleteRow: n => { S.rows.splice(n - 1, 1); }
    };
    return api;
  };
  const SpreadsheetApp = { getActiveSpreadsheet: () => ({
    getSheetByName: n => (store[n] ? sheet(n) : null),
    insertSheet: n => { store[n] = { rows: [], cols: 26 }; return sheet(n); }
  }) };
  const files = {}, folders = {};
  const mkBlob = (bytes, mime, name) => ({ getBytes: () => bytes, getContentType: () => mime, getName: () => name });
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'AWL', PRIVATE: 'P' }, Permission: { VIEW: 'V', NONE: 'N' },
    getRootFolder: () => ({}),
    getFoldersByName: n => { const f = folders[n]; let used = !f; return { hasNext: () => !used, next: () => { used = true; return f; } }; },
    createFolder: n => (folders[n] = { name: n, createFile: b => { const id = 'F' + Object.keys(files).length; files[id] = { b, shared: false, id }; return { getId: () => id, setSharing() { files[id].shared = true; } }; } }),
    getFileById: id => { if (!files[id]) throw new Error('no file'); return { getBlob: () => files[id].b, setTrashed() {} }; },
    createFile: b => { const id = 'F' + Object.keys(files).length; files[id] = { b, shared: false, id }; return { getId: () => id, setSharing() { files[id].shared = true; } }; }
  };
  const sb = a => Array.from(a).map(b => (b > 127 ? b - 256 : b));
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, f) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); return p; },
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => sb(crypto.createHash('sha256').update(String(s)).digest()),
    base64Encode: x => Buffer.from(typeof x === 'string' ? Buffer.from(x) : Buffer.from(x.map(b => b & 255))).toString('base64'),
    base64Decode: s => sb(Buffer.from(String(s), 'base64')),
    newBlob: mkBlob
  };
  const ctx = vm.createContext({
    SpreadsheetApp, DriveApp, Utilities, Date: FDate, console, JSON, Math, Object, Array, String, Number, Set, Map, parseInt, parseFloat, isNaN, RegExp, Error, Intl,
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    MailApp: { sendEmail: m => mails.push(m), getRemainingDailyQuota: () => 100 },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }), everyHours: () => ({ create() {} }) }) }) }
  });
  let src = fs.readFileSync(srcPath, 'utf8');
  if (opts.adminEmail) src = src.replace("const ADMIN_EMAIL = '';", `const ADMIN_EMAIL = '${opts.adminEmail}';`);
  vm.runInContext(src, ctx, { filename: 'Code.gs' });
  const call = (action, d = {}) => { const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action, ...d }) } }).s); return r; };
  return { ctx, call, clock, mails, store, files, folders, ev: code => vm.runInContext(code, ctx) };
}
module.exports = { makeEnv };
