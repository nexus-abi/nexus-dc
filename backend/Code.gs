/* Nexus Document Hub backend - Google Apps Script (bound to a Google Sheet) */
const SS = SpreadsheetApp.getActiveSpreadsheet(), TZ = 'Asia/Kolkata';
const H = {
  // new profile columns are added at the END so existing data stays safe
  Users: ['id', 'name', 'email', 'phone', 'hash', 'salt', 'verified', 'created', 'photo', 'dob', 'address', 'blood', 'emergency', 'remind', 'rdays'],
  Vehicles: ['id', 'userId', 'number', 'owner', 'phone', 'photo', 'model'],
  Documents: ['id', 'kind', 'vehicleId', 'userId', 'title', 'number', 'issue', 'expiry', 'files', 'notes', 'created', 'holder', 'fav'],
  Otps: ['email', 'purpose', 'hash', 'expires', 'tries'],
  Sessions: ['token', 'userId', 'expires'],
  Limits: ['key', 'count'],
  Vault: ['id', 'userId', 'data', 'updated'] // v3.1 password vault: 'data' is ENCRYPTED on the phone, unreadable here
};

function setup() { // RUN ONCE (or again after updating): creates/upgrades sheets + asks permissions
  Object.keys(H).forEach(n => sh(n));
  MailApp.getRemainingDailyQuota(); DriveApp.getRootFolder();
}
function installTrigger() { // RUN ONCE: daily 8 AM expiry reminder emails
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(8).create();
}
function sh(n) {
  let s = SS.getSheetByName(n);
  const len = H[n].length;
  if (!s) {
    s = SS.insertSheet(n);
    if (s.getMaxColumns() < len) s.insertColumnsAfter(s.getMaxColumns(), len - s.getMaxColumns());
    s.getRange(1, 1, s.getMaxRows(), len).setNumberFormat('@'); s.appendRow(H[n]);
  } else if (s.getLastColumn() < len) { // auto-upgrade older sheets with the new columns
    const old = s.getLastColumn();
    if (s.getMaxColumns() < len) s.insertColumnsAfter(s.getMaxColumns(), len - s.getMaxColumns());
    s.getRange(1, old + 1, s.getMaxRows(), len - old).setNumberFormat('@');
    s.getRange(1, 1, 1, len).setValues([H[n]]);
  }
  return s;
}
function rows(n) {
  const v = sh(n).getDataRange().getValues(), h = v.shift();
  return v.map((r, i) => { const o = { _row: i + 2 }; h.forEach((k, j) => o[k] = String(r[j])); return o; });
}
const add = (n, o) => sh(n).appendRow(H[n].map(k => o[k] === undefined ? '' : o[k]));
const del = (n, r) => sh(n).deleteRow(r);
const delAll = (n, f) => rows(n).filter(f).reverse().forEach(r => del(n, r._row));
function upd(n, row, o) { const s = sh(n); H[n].forEach((k, j) => { if (o[k] !== undefined) s.getRange(row, j + 1).setValue(o[k]); }); }
const uid = () => Utilities.getUuid(), em = e => String(e || '').trim().toLowerCase();
const cl = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
const he = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const hash = s => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s));
function pw(p, salt) { let h = salt + p; for (let i = 0; i < 500; i++) h = hash(h + salt); return h; }
const pub = u => ({
  name: u.name, email: u.email, phone: u.phone, photo: u.photo || '', dob: u.dob || '', address: u.address || '',
  blood: u.blood || '', emergency: u.emergency || '', remind: u.remind !== '0', rdays: u.rdays || '30,7,1,0', created: u.created || ''
});
const pass8 = p => { if (String(p).length < 8) throw 'Password must be at least 8 characters'; };
const files = r => { try { return JSON.parse(r.files || '[]'); } catch (x) { return []; } };
function trash(fs) { fs.forEach(f => { try { DriveApp.getFileById(f.id).setTrashed(true); } catch (x) {} }); }
const PHOTO = 'https://lh3.googleusercontent.com/d/';
const photoId = u => { const m = String(u || '').match(/\/d\/([\w-]+)/); return m ? m[1] : ''; };

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return out({ ok: 1, data: 'Nexus Document Hub API running' }); }
function doPost(e) {
  const L = LockService.getScriptLock(); L.waitLock(25000);
  try {
    const d = JSON.parse(e.postData.contents), f = A[d.action];
    if (!f) throw 'Invalid action';
    return out({ ok: 1, data: f(d) });
  } catch (x) { return out({ ok: 0, error: String(x.message || x) }); }
  finally { L.releaseLock(); }
}

/* ---------- daily limits (per email, per day) ---------- */
function hit(key, max) {
  const r = rows('Limits').find(x => x.key === key), n = r ? +r.count : 0;
  if (n >= max) throw 'Daily limit reached. Please try again tomorrow';
  if (r) upd('Limits', r._row, { count: n + 1 }); else add('Limits', { key, count: 1 });
  return max - n - 1;
}

/* ---------- styled mail ---------- */
function mail(to, subject, title, body, code) {
  const h = '<div style="background:#f3f5fb;padding:24px;font-family:Segoe UI,Arial,sans-serif"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;overflow:hidden">' +
    '<div style="background:linear-gradient(135deg,#0b1b3a,#3b5bfd);padding:22px;color:#fff;font-size:20px;font-weight:700">Nexus Document Hub</div>' +
    '<div style="padding:26px;color:#0b1b3a"><h2 style="margin:0 0 8px">' + title + '</h2><div style="color:#55617e;line-height:1.6">' + body + '</div>' +
    (code ? '<div style="margin:22px 0;text-align:center;font-size:36px;font-weight:800;letter-spacing:10px;background:#eef1ff;color:#3b5bfd;border-radius:12px;padding:16px">' + code + '</div><p style="color:#8a94ad;font-size:13px">Valid for 10 minutes. Never share this code with anyone.</p>' : '') + '</div>' +
    '<div style="padding:14px 26px;background:#f8f9fd;color:#8a94ad;font-size:12px">Automated message from Nexus Document Hub. If this was not you, you can ignore this email.</div></div></div>';
  MailApp.sendEmail({ to, name: 'Nexus Document Hub', subject, htmlBody: h });
}
function sendOtp(e, purpose, key, max) {
  const x = rows('Otps').find(r => r.email === e);
  if (x && +x.expires > Date.now() + 54e4) throw 'Please wait a minute before requesting another code';
  const left = key ? hit(key + '|' + e + '|' + day(), max) : null;
  const o = String(Math.floor(100000 + Math.random() * 900000));
  delAll('Otps', r => r.email === e);
  add('Otps', { email: e, purpose, hash: hash(o + e), expires: Date.now() + 6e5, tries: 0 });
  const v = purpose === 'verify';
  mail(e, 'Nexus Document Hub code: ' + o, v ? 'Verify your email' : 'Reset your password',
    v ? 'Welcome! Use this code to verify your email and activate your account.' : 'We received a request to reset your password. Use this code to continue.', o);
  return { left };
}
function chk(e, o, purpose) {
  const r = rows('Otps').find(x => x.email === e && x.purpose === purpose);
  if (!r || +r.expires < Date.now()) throw 'Code expired. Request a new one';
  if (+r.tries >= 5) { del('Otps', r._row); throw 'Too many attempts. Request a new code'; }
  if (r.hash !== hash(String(o).trim() + e)) { upd('Otps', r._row, { tries: +r.tries + 1 }); throw 'Wrong code'; }
  del('Otps', r._row);
}
function sess(u) {
  const token = uid() + uid();
  add('Sessions', { token, userId: u.id, expires: Date.now() + 2592e6 });
  return { token, user: pub(u) };
}
function auth(d) {
  const s = rows('Sessions').find(r => r.token === d.token && +r.expires > Date.now());
  const u = s && rows('Users').find(r => r.id === s.userId);
  if (!u) throw 'Session expired, please login again';
  return u;
}
const userByMail = e => rows('Users').find(r => r.email === e);
function resetMail(e) { // 5 per day
  const u = userByMail(e);
  return u && u.verified === '1' ? sendOtp(e, 'reset', 'rst', 5) : { left: 5 };
}

/* ---------- v3.1 password vault helpers ---------- */
const VMAX = 40000; // max characters of ciphertext per entry (a Google Sheet cell holds 50000)
const vdata = s => { s = String(s || ''); if (!s || s.length > VMAX || !/^[A-Za-z0-9+\/=]+$/.test(s)) throw 'Invalid vault data'; return s; };
const vmeta = s => { s = String(s || ''); if (!s || s.length > 2000) throw 'Invalid vault data'; JSON.parse(s); return s; };
const vrows = u => rows('Vault').filter(r => r.userId === u.id);

const A = {
  register(d) { // first verification mail is NOT counted in any limit
    const e = em(d.email);
    if (!/^\S+@\S+\.\S+$/.test(e)) throw 'Enter a valid email';
    if (!String(d.name).trim()) throw 'Name required';
    pass8(d.password);
    const u = userByMail(e);
    if (u && u.verified === '1') throw 'Email already registered. Please login';
    if (u) del('Users', u._row);
    const salt = uid();
    add('Users', { id: uid(), name: cl(d.name, 80), email: e, phone: cl(d.phone, 20), salt, hash: pw(d.password, salt), verified: '0', created: new Date().toISOString(), remind: '1' });
    sendOtp(e, 'verify');
    return { verify: 1 };
  },
  verify(d) {
    const e = em(d.email); chk(e, d.otp, 'verify');
    const u = userByMail(e); if (!u) throw 'Account not found';
    upd('Users', u._row, { verified: '1' });
    return sess(u);
  },
  login(d) {
    const e = em(d.email), u = userByMail(e);
    if (!u || u.hash !== pw(d.password, u.salt)) throw 'Wrong email or password';
    if (u.verified !== '1') { try { sendOtp(e, 'verify', 'rsv', 3); } catch (x) {} return { verify: 1 }; }
    return sess(u);
  },
  forgot(d) { return Object.assign({ sent: 1 }, resetMail(em(d.email))); },
  resend(d) { // verification resend: 3/day, password reset: 5/day
    const e = em(d.email);
    if (d.purpose === 'verify') {
      const u = userByMail(e);
      if (!u || u.verified === '1') throw 'Account not found';
      return sendOtp(e, 'verify', 'rsv', 3);
    }
    return resetMail(e);
  },
  reset(d) {
    const e = em(d.email); pass8(d.password); chk(e, d.otp, 'reset');
    const u = userByMail(e); if (!u) throw 'Account not found';
    const salt = uid();
    upd('Users', u._row, { salt, hash: pw(d.password, salt) });
    delAll('Sessions', r => r.userId === u.id);
    return 1;
  },
  logout(d) { delAll('Sessions', r => r.token === d.token); return 1; },
  logoutAll(d) { const u = auth(d); delAll('Sessions', r => r.userId === u.id); return 1; },
  data(d) {
    const u = auth(d);
    return {
      user: pub(u),
      vehicles: rows('Vehicles').filter(r => r.userId === u.id).map(v => ({ id: v.id, number: v.number, owner: v.owner, phone: v.phone, photo: v.photo, model: v.model })),
      docs: rows('Documents').filter(r => r.userId === u.id).map(r => ({ id: r.id, kind: r.kind, vehicleId: r.vehicleId, title: r.title, number: r.number, issue: r.issue, expiry: r.expiry, notes: r.notes, holder: r.holder || '', fav: r.fav === '1', files: files(r) }))
    };
  },
  updateProfile(d) { // partial update: only the fields that are sent are changed
    const u = auth(d), o = {};
    if (d.name !== undefined) { o.name = cl(d.name, 80); if (!o.name) throw 'Name required'; }
    if (d.phone !== undefined) o.phone = cl(d.phone, 20);
    if (d.dob !== undefined) { o.dob = cl(d.dob, 10); if (o.dob && !/^\d{4}-\d{2}-\d{2}$/.test(o.dob)) throw 'Invalid date of birth'; }
    if (d.address !== undefined) o.address = cl(d.address, 250);
    if (d.blood !== undefined) { o.blood = cl(d.blood, 4); if (o.blood && !/^(A|B|AB|O)[+-]$/.test(o.blood)) throw 'Invalid blood group'; }
    if (d.emergency !== undefined) o.emergency = cl(d.emergency, 120);
    if (d.remind !== undefined) o.remind = d.remind === '0' || d.remind === false || d.remind === 0 ? '0' : '1';
    if (d.rdays !== undefined) { // reminder lead times, e.g. "60,30,7,1,0"
      const a = String(d.rdays).split(',').map(x => parseInt(x, 10)).filter(x => !isNaN(x) && x >= 0 && x <= 365);
      o.rdays = Array.from(new Set(a)).sort((x, y) => y - x).join(',') || '30,7,1,0';
    }
    if (d.photo !== undefined) {
      const p = String(d.photo || '');
      if (p && p.indexOf(PHOTO) !== 0) throw 'Invalid photo';
      const old = photoId(u.photo);
      if (old && old !== photoId(p)) trash([{ id: old }]);
      o.photo = p;
    }
    upd('Users', u._row, o); return 1;
  },
  changePass(d) {
    const u = auth(d);
    if (u.hash !== pw(d.oldPassword, u.salt)) throw 'Current password is wrong';
    pass8(d.password);
    const salt = uid(); upd('Users', u._row, { salt, hash: pw(d.password, salt) }); return 1;
  },
  deleteAccount(d) {
    const u = auth(d);
    if (u.hash !== pw(d.password, u.salt)) throw 'Wrong password';
    rows('Documents').filter(r => r.userId === u.id).forEach(r => trash(files(r)));
    rows('Vehicles').filter(r => r.userId === u.id).forEach(r => { const i = photoId(r.photo); if (i) trash([{ id: i }]); });
    const pi = photoId(u.photo); if (pi) trash([{ id: pi }]);
    delAll('Documents', r => r.userId === u.id); delAll('Vehicles', r => r.userId === u.id);
    delAll('Vault', r => r.userId === u.id);
    delAll('Sessions', r => r.userId === u.id); del('Users', u._row); return 1;
  },
  saveVehicle(d) {
    const u = auth(d), o = { number: String(d.number || '').toUpperCase().trim(), model: d.model, owner: d.owner, phone: d.phone };
    if (d.photo !== undefined) o.photo = d.photo;
    if (!o.number) throw 'Vehicle number required';
    if (d.id) {
      const v = rows('Vehicles').find(r => r.id === d.id && r.userId === u.id); if (!v) throw 'Not found';
      if (o.photo && v.photo && o.photo !== v.photo) { const i = photoId(v.photo); if (i) trash([{ id: i }]); }
      upd('Vehicles', v._row, o);
    } else add('Vehicles', Object.assign({ id: uid(), userId: u.id }, o));
    return 1;
  },
  deleteVehicle(d) {
    const u = auth(d);
    rows('Documents').filter(r => r.vehicleId === d.id && r.userId === u.id).forEach(r => trash(files(r)));
    const v = rows('Vehicles').find(r => r.id === d.id && r.userId === u.id);
    if (v) { const i = photoId(v.photo); if (i) trash([{ id: i }]); }
    delAll('Documents', r => r.vehicleId === d.id && r.userId === u.id);
    delAll('Vehicles', r => r.id === d.id && r.userId === u.id); return 1;
  },
  saveDoc(d) {
    const u = auth(d), fl = Array.isArray(d.files) ? d.files.slice(0, 30).map(f => ({ id: String(f.id), n: String(f.n || ''), t: String(f.t || '') })) : [];
    if (!String(d.title || '').trim()) throw 'Document name required';
    if (!fl.length) throw 'Add at least one file';
    const kind = d.kind === 'vehicle' ? 'vehicle' : 'person';
    if (kind === 'vehicle' && !rows('Vehicles').some(r => r.id === d.vehicleId && r.userId === u.id)) throw 'Vehicle not found';
    const o = { kind, vehicleId: kind === 'vehicle' ? d.vehicleId : '', title: d.title, number: d.number, issue: d.issue, expiry: d.expiry, notes: cl(d.notes, 300), holder: kind === 'person' ? cl(d.holder, 60) : '', files: JSON.stringify(fl) };
    if (d.id) {
      const x = rows('Documents').find(r => r.id === d.id && r.userId === u.id); if (!x) throw 'Not found';
      trash(files(x).filter(f => !fl.some(n => n.id === f.id)));
      upd('Documents', x._row, o);
    } else add('Documents', Object.assign({ id: uid(), userId: u.id, created: new Date().toISOString() }, o));
    return 1;
  },
  toggleFav(d) { // star / unstar a document
    const u = auth(d), x = rows('Documents').find(r => r.id === d.id && r.userId === u.id);
    if (!x) throw 'Not found';
    upd('Documents', x._row, { fav: d.fav ? '1' : '0' }); return 1;
  },
  deleteDoc(d) {
    const u = auth(d);
    rows('Documents').filter(r => r.id === d.id && r.userId === u.id).forEach(r => trash(files(r)));
    delAll('Documents', r => r.id === d.id && r.userId === u.id); return 1;
  },
  upload(d) { // any file type: PDF, images, docs...
    auth(d);
    if (String(d.data).length > 13e6) throw 'File too large (max 9 MB)';
    const name = String(d.name || 'file').replace(/[^\w.\- ]/g, '_');
    const f = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(d.data), d.mime || 'application/octet-stream', Date.now() + '_' + name));
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { id: f.getId(), n: name, t: d.mime || '' };
  },
  getFile(d) { // v3.2: returns the real file (base64) so the app can share / download it directly
    const u = auth(d), id = String(d.id || '');
    if (!rows('Documents').some(r => r.userId === u.id && files(r).some(f => f.id === id))) throw 'File not found'; // only YOUR files
    const b = DriveApp.getFileById(id).getBlob(), bytes = b.getBytes();
    if (bytes.length > 9.5e6) throw 'File too large to share (max 9 MB)';
    return { data: Utilities.base64Encode(bytes), mime: b.getContentType() || '' };
  },

  /* ---------- v3.1 PASSWORD VAULT: the server only stores ciphertext, it can never read passwords ---------- */
  vaultGet(d) { // returns the vault setup record ("meta") + all encrypted entries of this user
    const u = auth(d), r = vrows(u), m = r.find(x => x.id === 'meta');
    return { meta: m ? m.data : '', items: r.filter(x => x.id !== 'meta').map(x => ({ id: x.id, data: x.data, updated: x.updated })) };
  },
  vaultMeta(d) { // create the vault (first time) or replace its setup record
    const u = auth(d), data = vmeta(d.meta), m = vrows(u).find(x => x.id === 'meta');
    if (m) upd('Vault', m._row, { data, updated: new Date().toISOString() });
    else add('Vault', { id: 'meta', userId: u.id, data, updated: new Date().toISOString() });
    return 1;
  },
  vaultSave(d) { // add (no id) or update (id) one encrypted entry
    const u = auth(d), data = vdata(d.data), now = new Date().toISOString();
    if (d.id) {
      const x = vrows(u).find(r => r.id === String(d.id) && r.id !== 'meta'); if (!x) throw 'Entry not found';
      upd('Vault', x._row, { data, updated: now }); return { id: x.id };
    }
    if (vrows(u).length > 1000) throw 'Vault is full';
    const id = uid(); add('Vault', { id, userId: u.id, data, updated: now }); return { id };
  },
  vaultDelete(d) {
    const u = auth(d); if (String(d.id) === 'meta') throw 'Invalid entry';
    delAll('Vault', r => r.userId === u.id && r.id === String(d.id)); return 1;
  },
  vaultBulk(d) { // used when the master password is changed: replaces meta + re-encrypted entries in one go
    const u = auth(d), meta = vmeta(d.meta), items = Array.isArray(d.items) ? d.items.slice(0, 1000) : [], mine = vrows(u), now = new Date().toISOString();
    items.forEach(i => vdata(i.data));
    items.forEach(i => { const x = mine.find(r => r.id === String(i.id) && r.id !== 'meta'); if (x) upd('Vault', x._row, { data: i.data, updated: now }); });
    const m = mine.find(r => r.id === 'meta'); if (m) upd('Vault', m._row, { data: meta, updated: now }); else add('Vault', { id: 'meta', userId: u.id, data: meta, updated: now });
    return 1;
  },
  vaultReset(d) { const u = auth(d); delAll('Vault', r => r.userId === u.id); return 1; }
};

/* ---------- daily expiry reminder emails (30, 7, 1 days left & on expiry day) ---------- */
function dailyReminders() {
  const t0 = new Date().setHours(0, 0, 0, 0), docs = rows('Documents'), vs = rows('Vehicles');
  rows('Limits').filter(r => r.key.split('|')[2] !== day()).reverse().forEach(r => del('Limits', r._row));
  rows('Users').filter(u => u.verified === '1' && u.remind !== '0').forEach(u => { // respects the user's reminder toggle
    try {
      const L = docs.filter(d => d.userId === u.id && d.expiry).map(d => ({ d, n: Math.round((new Date(d.expiry + 'T00:00:00') - t0) / 864e5) })).filter(x => (u.rdays ? u.rdays.split(',').map(Number) : [30, 7, 1, 0]).includes(x.n));
      if (!L.length) return;
      const li = L.map(x => { const v = vs.find(v => v.id === x.d.vehicleId); return '<li><b>' + he(x.d.title) + '</b>' + (v ? ' (' + he(v.number) + ')' : '') + ' — ' + (x.n === 0 ? '<span style="color:#e5484d">expires today</span>' : x.n + ' day(s) left') + '</li>'; }).join('');
      mail(u.email, 'Document expiry reminder', 'Hi ' + he(u.name) + ', renewal due soon', '<ul>' + li + '</ul>Please renew them in time to avoid fines.');
    } catch (x) {}
  });
}
