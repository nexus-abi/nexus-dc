/* Nexus Document Hub backend - Google Apps Script (bound to a Google Sheet)
   Matches index.html (UI 1.0.1): documents (Front/Back pages), vehicles, profile, reminders,
   file share/download (getFile) and the end-to-end encrypted password vault. */
const SS = SpreadsheetApp.getActiveSpreadsheet(), TZ = 'Asia/Kolkata';
const H = {
  // new columns are always added at the END so existing data stays safe
  Users: ['id', 'name', 'email', 'phone', 'hash', 'salt', 'verified', 'created', 'photo', 'dob', 'address', 'blood', 'emergency', 'remind', 'rdays', 'sub'], // 'sub' = free/active/expired, a convenience copy for the sheet owner (the real status is computed from Subscriptions)
  Vehicles: ['id', 'userId', 'number', 'owner', 'phone', 'photo', 'model'],
  Documents: ['id', 'kind', 'vehicleId', 'userId', 'title', 'number', 'issue', 'expiry', 'files', 'notes', 'created', 'holder', 'fav'],
  Otps: ['email', 'purpose', 'hash', 'expires', 'tries'],
  Sessions: ['token', 'userId', 'expires', 'adminUntil'], // adminUntil: admin step-up (password re-entry) valid until this time (ms)
  Limits: ['key', 'count'],
  Vault: ['id', 'userId', 'data', 'updated'], // 'data' is ENCRYPTED on the phone, unreadable here
  /* ---- v4 premium / payments (all times are server epoch milliseconds) ---- */
  Plans: ['id', 'name', 'price', 'days', 'active', 'sort'],
  Settings: ['key', 'value'],
  Payments: ['id', 'userId', 'planId', 'planName', 'amount', 'days', 'ref', 'utr', 'status', 'created', 'submitted', 'verified', 'adminId', 'reason', 'note', 'proof', 'received', 'subId'],
  Subscriptions: ['id', 'userId', 'planId', 'planName', 'start', 'expiry', 'status', 'paymentId', 'created'],
  Admins: ['id', 'userId', 'email', 'perms', 'added'],
  Audit: ['id', 'at', 'action', 'adminId', 'target', 'detail'],
  /* ---- v5 own ads: the administrator creates ads in the app (Admin > Ads). Each row is one ad. ---- */
  Ads: ['id', 'title', 'type', 'media', 'click', 'cta', 'placement', 'status', 'start', 'end', 'skip', 'weight', 'views', 'clicks', 'created', 'updated'] // type: image|video, placement: banner|fullscreen|both, status: active|paused, start/end: epoch ms (0 = no limit)
};

function setup() { // RUN ONCE (and again after every update): creates/upgrades sheets + asks permissions
  Object.keys(H).forEach(n => sh(n));
  seedDefaults(); // v4: default plans (Weekly Rs 19 / Monthly Rs 49). Safe to run again.
  MailApp.getRemainingDailyQuota(); DriveApp.getRootFolder();
}
function installTrigger() { // RUN ONCE: daily 8 AM expiry reminder emails + hourly premium expiry check
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('expireSubscriptions').timeBased().everyHours(1).create();
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
  return v.map((r, i) => {
    const o = { _row: i + 2 };
    h.forEach((k, j) => { // if Sheets ever turns a text date into a real Date, convert it back to yyyy-MM-dd
      const x = r[j]; o[k] = x instanceof Date ? Utilities.formatDate(x, TZ, 'yyyy-MM-dd') : String(x);
    });
    return o;
  });
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
  blood: u.blood || '', emergency: u.emergency || '', remind: u.remind === '1', rdays: u.rdays || '30,7,1,0', created: u.created || ''
});
const pass8 = p => { if (String(p).length < 8) throw 'Password must be at least 8 characters'; };
const files = r => { try { return JSON.parse(r.files || '[]'); } catch (x) { return []; } };
function trash(fs) { fs.forEach(f => { try { DriveApp.getFileById(f.id).setTrashed(true); } catch (x) {} }); }
const PHOTO = 'https://lh3.googleusercontent.com/d/';
const photoId = u => { const m = String(u || '').match(/\/d\/([\w-]+)/); return m ? m[1] : ''; };
const dt = s => { s = cl(s, 10); if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw 'Invalid date'; return s; };

/* every uploaded file is tagged with its owner, so nobody can attach (and then download) someone else's Drive file */
function own(u, id) { try { return !!id && DriveApp.getFileById(id).getDescription() === u.id; } catch (x) { return false; } }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return out({ ok: 1, data: 'Nexus Document Hub API running' }); }
function doPost(e) {
  const L = LockService.getScriptLock(); L.waitLock(25000);
  try {
    const d = JSON.parse(e.postData.contents), pick = (o, k) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null, f = pick(A, d.action) || pick(P, d.action); // P = v4 premium actions (bottom of this file)
    if (!f) throw 'Invalid action';
    return out({ ok: 1, data: f(d) });
  } catch (x) { return out({ ok: 0, error: String(x.message || x) }); }
  finally { L.releaseLock(); }
}

/* ---------- daily limits (per email, per day) ---------- */
function hit(key, max, msg) {
  const r = rows('Limits').find(x => x.key === key), n = r ? +r.count : 0;
  if (n >= max) throw msg || 'Daily limit reached. Please try again tomorrow';
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

/* ---------- password vault helpers ---------- */
const VMAX = 40000; // max characters of ciphertext per entry (a Google Sheet cell holds 50000)
const vdata = s => { s = String(s || ''); if (!s || s.length > VMAX || !/^[A-Za-z0-9+\/=]+$/.test(s)) throw 'Invalid vault data'; return s; };
const vmeta = s => { s = String(s || ''); if (!s || s.length > 4000) throw 'Invalid vault data'; JSON.parse(s); return s; }; // meta now holds salt, check, hint and recovery key blob
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
    add('Users', { id: uid(), name: cl(d.name, 80), email: e, phone: cl(d.phone, 20), salt, hash: pw(d.password, salt), verified: '0', created: new Date().toISOString(), remind: '0' }); // reminders OFF by default; user turns them on in Profile
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
    if (!u || u.hash !== pw(d.password, u.salt)) {
      try { hit('lgf|' + e + '|' + day(), 10); } catch (x) { throw 'Too many wrong attempts today. Use Forgot password or try tomorrow'; }
      throw 'Wrong email or password';
    }
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
    const u = auth(d), now = Date.now();
    return {
      user: pub(u),
      sub: userSub(u.id, now), admin: isAdmin(u.id), adsEnabled: settings().adsEnabled === '1', adMode: settings().adMode, serverTime: now, // v4: the ONLY trusted source of premium status
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
      const p = String(d.photo || ''), np = photoId(p), old = photoId(u.photo);
      if (p && (p.indexOf(PHOTO) !== 0 || !np)) throw 'Invalid photo';
      if (np && np !== old && !own(u, np)) throw 'Invalid photo';
      if (old && old !== np) trash([{ id: old }]);
      o.photo = p;
    }
    upd('Users', u._row, o); return 1;
  },
  changePass(d) {
    const u = auth(d);
    if (u.hash !== pw(d.oldPassword, u.salt)) throw 'Current password is wrong';
    pass8(d.password);
    const salt = uid(); upd('Users', u._row, { salt, hash: pw(d.password, salt) });
    delAll('Sessions', r => r.userId === u.id && r.token !== d.token); // sign out other devices, keep this one
    return 1;
  },
  deleteAccount(d) {
    const u = auth(d);
    if (u.hash !== pw(d.password, u.salt)) throw 'Wrong password';
    rows('Documents').filter(r => r.userId === u.id).forEach(r => trash(files(r)));
    rows('Vehicles').filter(r => r.userId === u.id).forEach(r => { const i = photoId(r.photo); if (i) trash([{ id: i }]); });
    const pi = photoId(u.photo); if (pi) trash([{ id: pi }]);
    delAll('Documents', r => r.userId === u.id); delAll('Vehicles', r => r.userId === u.id);
    delAll('Vault', r => r.userId === u.id);
    delAll('Admins', r => r.userId === u.id); // payment + subscription history is kept on purpose (financial records / audit trail)
    delAll('Sessions', r => r.userId === u.id); del('Users', u._row); return 1;
  },
  saveVehicle(d) {
    const u = auth(d), o = { number: cl(String(d.number || '').toUpperCase(), 20), model: cl(d.model, 60), owner: cl(d.owner, 80), phone: cl(d.phone, 20) };
    if (!o.number) throw 'Vehicle number required';
    if (d.photo !== undefined) {
      const np = photoId(d.photo);
      if (d.photo && (String(d.photo).indexOf(PHOTO) !== 0 || !np)) throw 'Invalid photo';
      o.photo = d.photo;
      const cur = d.id && rows('Vehicles').find(r => r.id === d.id && r.userId === u.id);
      if (np && (!cur || photoId(cur.photo) !== np) && !own(u, np)) throw 'Invalid photo';
    }
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
    const u = auth(d);
    if (!String(d.title || '').trim()) throw 'Document name required';
    // keeps the Front / Back label ("lb") so the app can show the two sides
    const fl = Array.isArray(d.files) ? d.files.slice(0, 30).map(f => {
      const x = { id: String(f.id), n: cl(f.n, 150), t: cl(f.t, 100) };
      if (f.lb === 'Front' || f.lb === 'Back') x.lb = f.lb;
      return x;
    }) : [];
    if (!fl.length) throw 'Add at least one file';
    const kind = d.kind === 'vehicle' ? 'vehicle' : 'person';
    if (kind === 'vehicle' && !rows('Vehicles').some(r => r.id === d.vehicleId && r.userId === u.id)) throw 'Vehicle not found';
    const issue = dt(d.issue), expiry = dt(d.expiry);
    if (issue && expiry && expiry < issue) throw 'Expiry date cannot be before the issue date';
    // every file must be one this user already owns or just uploaded
    const mine = {}; rows('Documents').filter(r => r.userId === u.id).forEach(r => files(r).forEach(f => mine[f.id] = 1));
    fl.forEach(f => { if (!mine[f.id] && !own(u, f.id)) throw 'Invalid file'; });
    const o = { kind, vehicleId: kind === 'vehicle' ? d.vehicleId : '', title: cl(d.title, 100), number: cl(d.number, 60), issue, expiry, notes: cl(d.notes, 300), holder: kind === 'person' ? cl(d.holder, 60) : '', files: JSON.stringify(fl) };
    if (d.id) {
      const x = rows('Documents').find(r => r.id === d.id && r.userId === u.id); if (!x) throw 'Not found';
      trash(files(x).filter(f => !fl.some(n => n.id === f.id)));
      upd('Documents', x._row, o);
    } else add('Documents', Object.assign({ id: uid(), userId: u.id, created: new Date().toISOString(), fav: '0' }, o));
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
  upload(d) { // any file type: PDF, images, docs, profile / vehicle photos
    const u = auth(d);
    if (String(d.data).length > 13e6) throw 'File too large (max 9 MB)';
    const name = String(d.name || 'file').replace(/[^\w.\- ]/g, '_');
    const f = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(d.data), d.mime || 'application/octet-stream', Date.now() + '_' + name));
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // needed so images / PDFs show inside the app
    f.setDescription(u.id); // owner tag, checked in saveDoc / updateProfile / saveVehicle
    return { id: f.getId(), n: name, t: d.mime || '' };
  },
  getFile(d) { // returns the real file (base64) so the app can share / download it directly
    const u = auth(d), id = String(d.id || '');
    if (!rows('Documents').some(r => r.userId === u.id && files(r).some(f => f.id === id))) throw 'File not found'; // only YOUR files
    const b = DriveApp.getFileById(id).getBlob(), bytes = b.getBytes();
    if (bytes.length > 9.5e6) throw 'File too large to share (max 9 MB)';
    return { data: Utilities.base64Encode(bytes), mime: b.getContentType() || '' };
  },

  /* ---------- PASSWORD VAULT: the server only stores ciphertext, it can never read passwords ---------- */
  vaultGet(d) { // returns the vault setup record ("meta") + all encrypted entries (logins AND folders) of this user
    const u = auth(d), r = vrows(u), m = r.find(x => x.id === 'meta');
    return { meta: m ? m.data : '', items: r.filter(x => x.id !== 'meta').map(x => ({ id: x.id, data: x.data, updated: x.updated })) };
  },
  vaultMeta(d) { // create the vault (first time) or replace its setup record (hint, recovery key)
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
  vaultBulk(d) { // used when the master password is changed: replaces meta + all re-encrypted entries in one go
    const u = auth(d), meta = vmeta(d.meta), items = Array.isArray(d.items) ? d.items.slice(0, 1000) : [], mine = vrows(u), now = new Date().toISOString();
    items.forEach(i => vdata(i.data));
    items.forEach(i => { const x = mine.find(r => r.id === String(i.id) && r.id !== 'meta'); if (x) upd('Vault', x._row, { data: i.data, updated: now }); });
    const m = mine.find(r => r.id === 'meta'); if (m) upd('Vault', m._row, { data: meta, updated: now }); else add('Vault', { id: 'meta', userId: u.id, data: meta, updated: now });
    return 1;
  },
  vaultReset(d) { const u = auth(d); delAll('Vault', r => r.userId === u.id); return 1; }
};

/* OPTIONAL, run once from the editor: switches reminders OFF for every existing user. Delete after use. */
function turnOffAllReminders() {
  rows('Users').forEach(u => upd('Users', u._row, { remind: '0' }));
}

/* ---------- daily expiry reminder emails (days chosen by each user, default 30, 7, 1 and expiry day) ---------- */
function dailyReminders() {
  const p = day().split('-').map(Number), t0 = Date.UTC(p[0], p[1] - 1, p[2]), docs = rows('Documents'), vs = rows('Vehicles');
  rows('Limits').filter(r => r.key.split('|')[2] !== day()).reverse().forEach(r => del('Limits', r._row));
  const left = x => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return null; const q = x.split('-').map(Number); return Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - t0) / 864e5); };
  rows('Users').filter(u => u.verified === '1' && u.remind === '1').forEach(u => { // only users who switched reminders ON
    try {
      const days = (u.rdays ? u.rdays.split(',').map(Number) : [30, 7, 1, 0]);
      const L = docs.filter(d => d.userId === u.id && d.expiry).map(d => ({ d, n: left(d.expiry) })).filter(x => x.n !== null && days.includes(x.n));
      if (!L.length) return;
      const li = L.map(x => { const v = vs.find(v => v.id === x.d.vehicleId); return '<li><b>' + he(x.d.title) + '</b>' + (v ? ' (' + he(v.number) + ')' : '') + ' — ' + (x.n === 0 ? '<span style="color:#e5484d">expires today</span>' : x.n + ' day(s) left') + '</li>'; }).join('');
      mail(u.email, 'Document expiry reminder', 'Hi ' + he(u.name) + ', renewal due soon', '<ul>' + li + '</ul>Please renew them in time to avoid fines.');
    } catch (x) {}
  });
}


/* =====================================================================================================
   v4  PREMIUM PLANS + MANUAL UPI PAYMENTS + ADMIN DASHBOARD API
   - The server is the ONLY authority for premium status. The app never decides it from local data.
   - A payment is only ever PENDING until an administrator verifies it in the real UPI/bank records.
   - All times are server epoch milliseconds (Date.now() here). The phone clock is never trusted.
   - Admin actions are authorised here on the server: the caller must hold a valid login session, be listed
     in the "Admins" sheet, AND have re-entered their password in the last 15 minutes (adminUnlock).
   ===================================================================================================== */
const DAY_MS = 864e5, DRAFT_MS = 864e5 /* an unsubmitted payment request is dropped after 24 h */, ADMIN_MS = 9e5 /* admin unlock lasts 15 min */;
const PLAN_DEFAULTS = [
  { id: 'weekly', name: 'Weekly Premium', price: '19', days: '7', active: '1', sort: '1' },
  { id: 'monthly', name: 'Monthly Premium', price: '49', days: '30', active: '1', sort: '2' }
];
const SET_DEFAULTS = {
  upiId: '', // EMPTY ON PURPOSE: payments stay switched off until the administrator enters the real merchant UPI ID
  merchantName: 'Nexus Docs', qrImage: '',
  instructions: 'Pay the exact amount shown, using any UPI app. Write the payment reference in the payment note. Then enter the UPI transaction ID (UTR) from your payment receipt and submit it. Premium switches on only after we check the payment in our records, usually within a few hours.',
  supportEmail: '', supportPhone: '', requireScreenshot: '0', maxAheadDays: '365', adsEnabled: '1', allowSelfApprove: '0',
  adMode: 'mixed' // which ads the app shows: own (only your own ads), startio (only Start.io), mixed (your own ad first, Start.io when you have no live ad)
};
const SET_RULES = { // every admin-editable setting is validated here, on the server
  upiId: v => { v = cl(v, 100).toLowerCase(); if (v && !/^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$/.test(v)) throw 'Enter a valid UPI ID, for example name@bank'; return v; },
  merchantName: v => { v = cl(v, 40); if (!/^[A-Za-z0-9 .&'-]{1,40}$/.test(v)) throw 'Merchant name: 1 to 40 letters, numbers, spaces or . & \' -'; return v; },
  qrImage: v => { v = cl(v, 300); if (v && !/^https:\/\/[^\s"'<>]{4,290}$/.test(v) && !/^[\w-]+(\.[\w-]+)*\.(png|jpe?g|webp)$/i.test(v)) throw 'QR image must be an https link or a file name like upi-qr.png'; return v; },
  instructions: v => cl(v, 600),
  supportEmail: v => { v = cl(v, 100).toLowerCase(); if (v && !/^\S+@\S+\.\S+$/.test(v)) throw 'Enter a valid support email'; return v; },
  supportPhone: v => { v = cl(v, 20); if (v && !/^[+\d][\d ()-]{5,19}$/.test(v)) throw 'Enter a valid support phone number'; return v; },
  requireScreenshot: v => (String(v) === '1' || v === true ? '1' : '0'),
  adsEnabled: v => (String(v) === '1' || v === true ? '1' : '0'),
  adMode: v => { v = String(v || ''); if (['mixed', 'own', 'startio'].indexOf(v) < 0) throw 'Ad source must be own, startio or mixed'; return v; },
  allowSelfApprove: v => (String(v) === '1' || v === true ? '1' : '0'),
  maxAheadDays: v => { const n = parseInt(v, 10); if (!(n >= 30 && n <= 1000)) throw 'Maximum stacked Premium time must be between 30 and 1000 days'; return String(n); }
};

/* ---------- small helpers ---------- */
const paise = x => Math.round(parseFloat(x) * 100), money = p => (p / 100).toFixed(2);
const audit = (action, adminId, target, detail) => add('Audit', { id: uid(), at: Date.now(), action, adminId: adminId || 'system', target: target || '', detail: cl(typeof detail === 'string' ? detail : JSON.stringify(detail || ''), 500) });
const isAdmin = id => rows('Admins').some(r => r.userId === id);
function seedDefaults() { if (!rows('Plans').length) PLAN_DEFAULTS.forEach(p => add('Plans', p)); }
const planView = r => ({ id: r.id, name: r.name, price: +r.price, days: +r.days, active: r.active === '1' });
function plans() { seedDefaults(); return rows('Plans').sort((a, b) => +a.sort - +b.sort).map(planView); }
function settings() {
  const o = Object.assign({}, SET_DEFAULTS);
  rows('Settings').forEach(r => { if (Object.prototype.hasOwnProperty.call(SET_DEFAULTS, r.key)) o[r.key] = r.value; });
  return o;
}
function setSetting(k, v) { const r = rows('Settings').find(x => x.key === k); if (r) upd('Settings', r._row, { value: v }); else add('Settings', { key: k, value: v }); }

/* ---------- subscription status (computed from server time, never from stored text) ---------- */
function userSub(uid, now) {
  const mine = rows('Subscriptions').filter(s => s.userId === uid && +s.expiry > 0);
  if (!mine.length) return { status: 'free', serverTime: now };
  const live = mine.filter(s => +s.expiry > now).sort((a, b) => +a.start - +b.start);
  if (!live.length) { const l = mine.sort((a, b) => +b.expiry - +a.expiry)[0]; return { status: 'expired', planId: l.planId, planName: l.planName, start: +l.start, expiry: +l.expiry, daysLeft: 0, serverTime: now }; }
  const cur = live.find(s => +s.start <= now) || live[0], paidUntil = Math.max.apply(null, live.map(s => +s.expiry));
  return { status: 'active', planId: cur.planId, planName: cur.planName, start: +cur.start, expiry: +cur.expiry, paidUntil, daysLeft: Math.ceil((paidUntil - now) / DAY_MS), queued: live.filter(s => +s.start > now).length, serverTime: now };
}
function syncUserSub(id, now) { const u = rows('Users').find(r => r.id === id); if (u) { const s = userSub(id, now).status; if (u.sub !== s) upd('Users', u._row, { sub: s }); } }
function settleSubs(now) { // marks finished subscriptions as expired (the sheet is only a record; status above is computed live)
  const touched = {};
  rows('Subscriptions').forEach(s => {
    if (s.status === 'expired') return;
    if (+s.expiry <= now) { upd('Subscriptions', s._row, { status: 'expired' }); audit('subscription_expired', 'system', s.id, s.userId + ' ' + s.planId); touched[s.userId] = 1; }
    else if (s.status === 'queued' && +s.start <= now) { upd('Subscriptions', s._row, { status: 'active' }); touched[s.userId] = 1; }
  });
  Object.keys(touched).forEach(id => syncUserSub(id, now));
}
function expireSubscriptions() { // hourly trigger (see installTrigger)
  const L = LockService.getScriptLock(); L.waitLock(25000);
  try { settleSubs(Date.now()); } finally { L.releaseLock(); }
}
function activate(p, now) { // idempotent: one subscription per verified payment. Renewal policy = STACKING: a new plan starts when the current paid time ends, so paid time is never lost.
  let s = rows('Subscriptions').find(x => x.paymentId === p.id);
  if (!s) {
    const cur = userSub(p.userId, now), start = Math.max(now, cur.paidUntil || 0);
    s = { id: uid(), userId: p.userId, planId: p.planId, planName: p.planName, start, expiry: start + (+p.days) * DAY_MS, status: start > now ? 'queued' : 'active', paymentId: p.id, created: now };
    add('Subscriptions', s);
  }
  return s;
}

/* ---------- payments ---------- */
const REFCH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I so a reference is easy to read out
function newRef(taken) { let r; do { r = 'NX'; for (let i = 0; i < 8; i++) r += REFCH.charAt(Math.floor(Math.random() * REFCH.length)); } while (taken.has(r)); return r; }
const validUtr = t => (/^\d{12}$/.test(t) && !/^(\d)\1{11}$/.test(t)) || (/^[A-Z][A-Z0-9]{11,34}$/.test(t) && /\d/.test(t)); // 12-digit UPI ref no., or app style ids like T2610...
const payView = p => ({ id: p.id, planId: p.planId, planName: p.planName, amount: +p.amount, days: +p.days, ref: p.ref, utr: p.utr || '', status: p.status, created: +p.created, submitted: +p.submitted || 0, verified: +p.verified || 0, reason: p.status === 'rejected' ? (p.reason || '') : '', hasProof: !!p.proof });
function proofFolder() { const it = DriveApp.getFoldersByName('Nexus Payment Proofs'); return it.hasNext() ? it.next() : DriveApp.createFolder('Nexus Payment Proofs'); } // private: never shared with a link
function saveProof(b64, ref) { // optional payment screenshot. It is only an AID for the administrator, never proof by itself.
  b64 = String(b64 || ''); if (!b64) return '';
  if (b64.length > 4e6 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) throw 'Invalid screenshot';
  const b = Utilities.base64Decode(b64), jpg = b[0] === -1 && b[1] === -40, png = b[0] === -119 && b[1] === 80 && b[2] === 78 && b[3] === 71; // bytes are signed in Apps Script
  if (!jpg && !png) throw 'The screenshot must be a JPG or PNG image';
  if (b.length > 3e6) throw 'The screenshot is too large (max 3 MB)';
  return proofFolder().createFile(Utilities.newBlob(b, jpg ? 'image/jpeg' : 'image/png', ref + '_' + Date.now() + (jpg ? '.jpg' : '.png'))).getId();
}

/* ---------- administrator authorisation (server side, every call) ---------- */
function adminCtx(d, perm, needUnlock) {
  const s = rows('Sessions').find(r => r.token === d.token && +r.expires > Date.now());
  const u = s && rows('Users').find(r => r.id === s.userId);
  if (!u) throw 'Session expired, please login again';
  const a = rows('Admins').find(r => r.userId === u.id);
  if (!a || u.verified !== '1') throw 'Not authorized';
  if (needUnlock !== false && !(+s.adminUntil > Date.now())) throw 'ADMIN_LOCKED';
  const ps = String(a.perms || '').split(',').map(x => x.trim());
  if (perm && ps.indexOf('all') < 0 && ps.indexOf(perm) < 0) throw 'Not authorized for this action';
  return { u, a, s };
}
function adminPayView(p, users, admins) {
  const u = users[p.userId] || {}, a = admins ? (admins[p.adminId] || {}) : {};
  return Object.assign(payView(p), { userId: p.userId, userName: u.name || '(deleted account)', userEmail: u.email || '', userPhone: u.phone || '', adminId: p.adminId || '', adminEmail: a.email || '', note: p.note || '', received: p.received || '', subId: p.subId || '' });
}

/* ---------- v5 own ads (server is the authority: Premium users and the kill-switch get an empty list) ---------- */
const AD_MAX = 60, AD_URL = /^https:\/\/[^\s"'<>\\]{4,480}$/;
const adState = (a, now) => a.status !== 'active' ? 'paused' : (+a.end > 0 && +a.end <= now) ? 'ended' : (+a.start > now) ? 'scheduled' : 'live';
const adView = a => ({ id: a.id, title: a.title, type: a.type, media: a.media, click: a.click, cta: a.cta, placement: a.placement, skip: +a.skip || 5, weight: +a.weight || 1 }); // what the app receives (no counters)
const adAdmin = (a, now) => Object.assign(adView(a), { status: a.status, state: adState(a, now), start: +a.start || 0, end: +a.end || 0, views: +a.views || 0, clicks: +a.clicks || 0, ctr: (+a.views > 0 ? Math.round(1000 * (+a.clicks || 0) / +a.views) / 10 : 0), created: +a.created || 0 });
function adClean(d, cur) { // validates an ad submitted by an administrator; returns the columns to store
  const o = {}, has = k => d[k] !== undefined;
  if (!cur || has('title')) { o.title = cl(d.title, 60); if (o.title.length < 2) throw 'Give the ad a short name (2 to 60 letters)'; }
  if (!cur || has('type')) { o.type = String(d.type || 'image'); if (o.type !== 'image' && o.type !== 'video') throw 'Ad type must be image or video'; }
  if (!cur || has('media')) { o.media = cl(d.media, 500); if (!AD_URL.test(o.media)) throw 'Image / video link must start with https:// (no spaces)'; }
  if (!cur || has('click')) { o.click = cl(d.click, 500); if (o.click && !AD_URL.test(o.click)) throw 'Website link must start with https://'; }
  if (!cur || has('cta')) { o.cta = cl(d.cta, 24) || 'Learn more'; }
  if (!cur || has('placement')) { o.placement = String(d.placement || 'both'); if (['banner', 'fullscreen', 'both'].indexOf(o.placement) < 0) throw 'Placement must be banner, fullscreen or both'; }
  if (!cur || has('status')) { o.status = d.status === 'paused' ? 'paused' : 'active'; }
  if (!cur || has('start')) { o.start = Math.max(0, +d.start || 0); }
  if (!cur || has('end')) { o.end = Math.max(0, +d.end || 0); }
  const st = o.start !== undefined ? o.start : (+(cur || {}).start || 0), en = o.end !== undefined ? o.end : (+(cur || {}).end || 0);
  if (st > 0 && en > 0 && en <= st) throw 'End date must be after the start date';
  if (!cur || has('skip')) { const n = parseInt(d.skip, 10); o.skip = String(isFinite(n) ? Math.min(30, Math.max(0, n)) : 5); }
  if (!cur || has('weight')) { const n = parseInt(d.weight, 10); o.weight = String(isFinite(n) ? Math.min(10, Math.max(1, n)) : 1); }
  return o;
}

const P = {
  subStatus(d) { // tiny re-check used when the app comes back to the foreground
    const u = auth(d), now = Date.now();
    return { sub: userSub(u.id, now), admin: isAdmin(u.id), adsEnabled: settings().adsEnabled === '1', adMode: settings().adMode, serverTime: now };
  },
  /* ---------- user: plans, payment instructions, my payments ---------- */
  payInfo(d) {
    const u = auth(d), now = Date.now(); settleSubs(now);
    const s = settings(), mine = rows('Payments').filter(p => p.userId === u.id && p.status !== 'cancelled' && !(p.status === 'created' && now - +p.created > DRAFT_MS)).sort((a, b) => +b.created - +a.created);
    return { ready: !!s.upiId, upiId: s.upiId, merchantName: s.merchantName, qrImage: s.qrImage, instructions: s.instructions, supportEmail: s.supportEmail, supportPhone: s.supportPhone, requireScreenshot: s.requireScreenshot === '1', adsEnabled: s.adsEnabled === '1', adMode: s.adMode, plans: plans().filter(p => p.active), sub: userSub(u.id, now), payments: mine.slice(0, 30).map(payView), serverTime: now };
  },
  payCreate(d) { // step 1: choose a plan. Creates (or refreshes) ONE unsubmitted request that carries the unique reference and a price snapshot
    const u = auth(d), now = Date.now(), s = settings();
    if (!s.upiId) throw 'Payments are not set up yet. Please contact support';
    const plan = plans().find(p => p.id === String(d.planId) && p.active); if (!plan) throw 'This plan is not available';
    hit('pcr|' + u.id + '|' + day(), 20, 'Too many payment requests today. Please try again tomorrow');
    const all = rows('Payments'), mine = all.filter(p => p.userId === u.id), sub = userSub(u.id, now);
    if ((sub.paidUntil ? Math.max(0, sub.paidUntil - now) / DAY_MS : 0) + plan.days > (+s.maxAheadDays || 365)) throw 'You already have plenty of Premium time. You can renew closer to the expiry date';
    if (mine.filter(p => p.status === 'pending').length >= 3) throw 'You already have payments waiting for verification. Please wait until they are checked';
    mine.filter(p => p.status === 'created' && now - +p.created > DRAFT_MS).forEach(p => upd('Payments', p._row, { status: 'cancelled' }));
    const snap = { planId: plan.id, planName: plan.name, amount: money(paise(plan.price)), days: plan.days, created: now };
    let p = mine.find(x => x.status === 'created' && now - +x.created <= DRAFT_MS);
    if (p) { upd('Payments', p._row, snap); p = Object.assign({}, p, snap); }
    else { p = Object.assign({ id: uid(), userId: u.id, ref: newRef(new Set(all.map(x => x.ref))), status: 'created' }, snap); add('Payments', p); }
    return payView(p);
  },
  paySubmit(d) { // step 2: user says "I paid" and gives the UPI transaction id. This creates a PENDING request only, it never activates anything.
    const u = auth(d), now = Date.now();
    hit('psb|' + u.id + '|' + day(), 12, 'Too many attempts today. Please try again tomorrow or contact support');
    const all = rows('Payments'), p = all.find(x => x.id === String(d.paymentId) && x.userId === u.id);
    if (!p) throw 'Payment request not found';
    if (p.status === 'pending') throw 'Already submitted. Your payment is waiting for verification';
    if (p.status === 'approved') throw 'This payment is already approved';
    if (p.status !== 'created') throw 'This payment request is closed. Please start a new one';
    if (now - +p.created > DRAFT_MS) { upd('Payments', p._row, { status: 'cancelled' }); throw 'This payment request expired. Please start a new one'; }
    const utr = String(d.utr || '').replace(/[\s-]/g, '').toUpperCase();
    if (!validUtr(utr)) throw 'Enter the transaction ID from your UPI receipt. It is usually 12 digits';
    const same = all.filter(x => x.id !== p.id && x.utr === utr), rej = same.filter(x => x.status === 'rejected');
    if (same.some(x => x.status === 'approved' || x.status === 'pending') || rej.some(x => x.userId !== u.id)) throw 'This transaction ID has already been submitted';
    if (rej.length >= 2) throw 'This transaction ID was rejected before. Please contact support';
    if (settings().requireScreenshot === '1' && !d.proof) throw 'Please attach a screenshot of your payment';
    const proof = saveProof(d.proof, p.ref), up = { utr, status: 'pending', submitted: now, proof };
    upd('Payments', p._row, up);
    return payView(Object.assign({}, p, up));
  },
  payCancel(d) {
    const u = auth(d), p = rows('Payments').find(x => x.id === String(d.paymentId) && x.userId === u.id);
    if (!p) throw 'Payment request not found';
    if (p.status !== 'created') throw 'Only a request that has not been submitted can be cancelled';
    upd('Payments', p._row, { status: 'cancelled' }); return 1;
  },

  /* ---------- v5 own ads: user side ---------- */
  adsFeed(d) { // the live ads this user may see. Empty for Premium users, when ads are switched off, or when only Start.io is selected.
    const u = auth(d), now = Date.now(), s = settings();
    if (s.adsEnabled !== '1' || s.adMode === 'startio' || userSub(u.id, now).status === 'active') return { ads: [], adMode: s.adMode, serverTime: now };
    return { ads: rows('Ads').filter(a => adState(a, now) === 'live').slice(0, 20).map(adView), adMode: s.adMode, serverTime: now };
  },
  adTrack(d) { // counts one view or one tap. Rate limited per user per day; unknown / paused ads are ignored.
    const u = auth(d); if (d.ev !== 'view' && d.ev !== 'click') throw 'Invalid event';
    hit('adt|' + u.id + '|' + day(), 400, 'Limit reached');
    const a = rows('Ads').find(x => x.id === String(d.adId)); if (!a || adState(a, Date.now()) !== 'live') return 0;
    if (d.ev === 'view') upd('Ads', a._row, { views: (+a.views || 0) + 1 }); else upd('Ads', a._row, { clicks: (+a.clicks || 0) + 1 });
    return 1;
  },

  /* ---------- admin: step-up login ---------- */
  adminUnlock(d) {
    const c = adminCtx(d, null, false), key = 'adm|' + c.u.id + '|' + day(), tries = rows('Limits').find(x => x.key === key);
    if (tries && +tries.count >= 8) throw 'Too many wrong passwords today. Try again tomorrow'; // checked BEFORE comparing, so even a correct guess is refused once locked out
    if (c.u.hash !== pw(String(d.password || ''), c.u.salt)) { hit(key, 1e9); audit('admin_unlock_failed', c.a.id, c.u.id, ''); throw 'Wrong password'; }
    const until = Date.now() + ADMIN_MS; upd('Sessions', c.s._row, { adminUntil: until }); audit('admin_unlock', c.a.id, c.u.id, ''); return { until, serverTime: Date.now() };
  },
  adminLock(d) { const c = adminCtx(d, null, false); upd('Sessions', c.s._row, { adminUntil: '0' }); return 1; },

  /* ---------- admin: read ---------- */
  adminOverview(d) {
    adminCtx(d, 'view'); const now = Date.now(); settleSubs(now);
    const pays = rows('Payments'), subs = rows('Subscriptions'), cnt = st => pays.filter(p => p.status === st).length;
    const appr = pays.filter(p => p.status === 'approved'), sum = a => a.reduce((t, p) => t + paise(p.amount), 0) / 100; // revenue = VERIFIED (approved) payments only
    return {
      users: rows('Users').filter(u => u.verified === '1').length,
      active: new Set(subs.filter(s => +s.start <= now && +s.expiry > now).map(s => s.userId)).size,
      pending: cnt('pending'), approved: appr.length, rejected: cnt('rejected'), expired: subs.filter(s => +s.expiry <= now).length,
      revenue: sum(appr), revenue30: sum(appr.filter(p => now - +p.verified <= 30 * DAY_MS)), serverTime: now
    };
  },
  adminPayments(d) {
    adminCtx(d, 'view'); const st = String(d.status || 'pending'), q = String(d.q || '').trim().toLowerCase(), users = {}, admins = {};
    rows('Users').forEach(u => users[u.id] = u); rows('Admins').forEach(a => admins[a.id] = a);
    let L = rows('Payments').filter(p => st === 'all' ? p.status !== 'created' && p.status !== 'cancelled' : p.status === st);
    if (q) L = L.filter(p => [p.id, p.ref, p.utr, p.userId, (users[p.userId] || {}).email, (users[p.userId] || {}).name].join(' ').toLowerCase().indexOf(q) >= 0);
    L.sort((a, b) => (+b.submitted || +b.created) - (+a.submitted || +a.created));
    const utrs = {}; rows('Payments').forEach(p => { if (p.utr) utrs[p.utr] = (utrs[p.utr] || 0) + 1; });
    return { items: L.slice(0, 200).map(p => Object.assign(adminPayView(p, users, admins), { dupUtr: !!p.utr && utrs[p.utr] > 1 })), total: L.length, serverTime: Date.now() };
  },
  adminUser(d) { // payment + subscription history of one user
    adminCtx(d, 'view'); const u = rows('Users').find(r => r.id === String(d.userId)), users = {}, admins = {};
    rows('Users').forEach(x => users[x.id] = x); rows('Admins').forEach(a => admins[a.id] = a);
    const now = Date.now();
    return {
      user: u ? { id: u.id, name: u.name, email: u.email, phone: u.phone, created: u.created } : null, sub: userSub(String(d.userId), now),
      payments: rows('Payments').filter(p => p.userId === String(d.userId) && p.status !== 'cancelled').sort((a, b) => +b.created - +a.created).map(p => adminPayView(p, users, admins)),
      subs: rows('Subscriptions').filter(s => s.userId === String(d.userId)).sort((a, b) => +b.start - +a.start).map(s => ({ id: s.id, planName: s.planName, start: +s.start, expiry: +s.expiry, status: +s.expiry <= now ? 'expired' : (+s.start > now ? 'queued' : 'active'), paymentId: s.paymentId })),
      serverTime: now
    };
  },
  adminProof(d) {
    const c = adminCtx(d, 'payments'), p = rows('Payments').find(x => x.id === String(d.paymentId));
    if (!p || !p.proof) throw 'No screenshot attached';
    const b = DriveApp.getFileById(p.proof).getBlob(), by = b.getBytes(); audit('proof_viewed', c.a.id, p.id, ''); return { data: Utilities.base64Encode(by), mime: b.getContentType() || 'image/jpeg' };
  },
  adminAudit(d) {
    adminCtx(d, 'view'); const ad = {}; rows('Admins').forEach(a => ad[a.id] = a.email);
    return rows('Audit').sort((a, b) => +b.at - +a.at).slice(0, Math.min(+d.limit || 100, 300)).map(r => ({ at: +r.at, action: r.action, admin: ad[r.adminId] || r.adminId, target: r.target, detail: r.detail }));
  },
  adminSettings(d) { adminCtx(d, 'view'); return { settings: settings(), plans: plans() }; },

  /* ---------- admin: write ---------- */
  adminApprove(d) {
    const c = adminCtx(d, 'payments'), now = Date.now(), all = rows('Payments'), p = all.find(x => x.id === String(d.paymentId));
    if (!p) throw 'Payment not found';
    if (p.status !== 'pending') throw 'Only a pending payment can be approved (this one is ' + p.status + ')';
    if (d.verified !== true) throw 'Confirm that you checked this payment in your UPI / bank records';
    if (p.userId === c.u.id && settings().allowSelfApprove !== '1') throw 'You cannot approve your own payment. Ask another administrator';
    if (!p.utr) throw 'This request has no transaction ID';
    if (all.some(x => x.id !== p.id && x.utr === p.utr && x.status === 'approved')) throw 'This transaction ID was already used for another approved payment';
    const rcv = paise(d.received); if (!(rcv > 0)) throw 'Enter the amount you actually received';
    if (rcv !== paise(p.amount)) throw 'Received amount (Rs ' + money(rcv) + ') does not match the expected amount (Rs ' + money(paise(p.amount)) + '). Do not approve. Reject it and tell the user';
    if (!rows('Users').some(r => r.id === p.userId)) throw 'This user account no longer exists';
    if (!(+p.days > 0)) throw 'Invalid plan duration on this payment';
    const s = activate(p, now);
    upd('Payments', p._row, { status: 'approved', verified: now, adminId: c.a.id, received: money(rcv), note: cl(d.note, 300) || p.note, subId: s.id });
    syncUserSub(p.userId, now);
    audit('payment_approved', c.a.id, p.id, { user: p.userId, plan: p.planId, amount: p.amount, utr: p.utr, subId: s.id, start: +s.start, expiry: +s.expiry });
    return { subId: s.id, start: +s.start, expiry: +s.expiry };
  },
  adminReject(d) {
    const c = adminCtx(d, 'payments'), p = rows('Payments').find(x => x.id === String(d.paymentId));
    if (!p) throw 'Payment not found';
    if (p.status !== 'pending') throw 'Only a pending payment can be rejected (this one is ' + p.status + ')';
    const reason = cl(d.reason, 200); if (reason.length < 3) throw 'Write a short reason. The user will see it';
    upd('Payments', p._row, { status: 'rejected', verified: Date.now(), adminId: c.a.id, reason, note: cl(d.note, 300) || p.note });
    audit('payment_rejected', c.a.id, p.id, { user: p.userId, utr: p.utr, reason });
    return 1;
  },
  adminNote(d) {
    const c = adminCtx(d, 'payments'), p = rows('Payments').find(x => x.id === String(d.paymentId));
    if (!p) throw 'Payment not found';
    upd('Payments', p._row, { note: cl(d.note, 300) }); audit('payment_note', c.a.id, p.id, cl(d.note, 200)); return 1;
  },
  adminSetSettings(d) {
    const c = adminCtx(d, 'settings'), cur = settings(), vals = d.values || {}, out = {};
    Object.keys(vals).forEach(k => { if (Object.prototype.hasOwnProperty.call(SET_RULES, k)) out[k] = SET_RULES[k](vals[k]); }); // validate everything first
    const changed = Object.keys(out).filter(k => out[k] !== cur[k]);
    changed.forEach(k => setSetting(k, out[k]));
    if (changed.length) audit('settings_changed', c.a.id, '', changed.map(k => (k === 'upiId' || k === 'merchantName' || k === 'qrImage') ? k + ': ' + cur[k] + ' -> ' + out[k] : k).join('; '));
    return { settings: settings() };
  },
  /* ---------- v5 own ads: administrator side ---------- */
  adminAds(d) {
    adminCtx(d, 'view'); const now = Date.now();
    const L = rows('Ads').sort((a, b) => +b.created - +a.created).map(a => adAdmin(a, now));
    return { ads: L, live: L.filter(a => a.state === 'live').length, views: L.reduce((t, a) => t + a.views, 0), clicks: L.reduce((t, a) => t + a.clicks, 0), serverTime: now };
  },
  adminSaveAd(d) { // create (no id) or edit (id)
    const c = adminCtx(d, 'ads'), now = Date.now(), all = rows('Ads'), cur = d.id ? all.find(x => x.id === String(d.id)) : null;
    if (d.id && !cur) throw 'Ad not found';
    const o = adClean(d, cur);
    if (!cur) {
      if (all.length >= AD_MAX) throw 'You have ' + AD_MAX + ' ads already. Delete old ones first';
      const a = Object.assign({ id: uid(), views: 0, clicks: 0, created: now, updated: now }, o); add('Ads', a);
      audit('ad_created', c.a.id, a.id, { title: a.title, type: a.type, placement: a.placement }); return adAdmin(a, now);
    }
    o.updated = now; upd('Ads', cur._row, o);
    audit('ad_changed', c.a.id, cur.id, Object.keys(o).filter(k => k !== 'updated' && String(o[k]) !== String(cur[k])).join(', '));
    return adAdmin(Object.assign({}, cur, o), now);
  },
  adminAdStatus(d) { // pause / resume
    const c = adminCtx(d, 'ads'), a = rows('Ads').find(x => x.id === String(d.id)); if (!a) throw 'Ad not found';
    const st = d.status === 'paused' ? 'paused' : 'active'; upd('Ads', a._row, { status: st, updated: Date.now() });
    audit('ad_' + (st === 'paused' ? 'paused' : 'resumed'), c.a.id, a.id, a.title); return adAdmin(Object.assign({}, a, { status: st }), Date.now());
  },
  adminDeleteAd(d) {
    const c = adminCtx(d, 'ads'), a = rows('Ads').find(x => x.id === String(d.id)); if (!a) throw 'Ad not found';
    del('Ads', a._row); audit('ad_deleted', c.a.id, a.id, { title: a.title, views: a.views, clicks: a.clicks }); return 1;
  },
  adminSavePlan(d) {
    const c = adminCtx(d, 'settings'), r = rows('Plans').find(x => x.id === String(d.id)); if (!r) throw 'Plan not found';
    const o = {};
    if (d.price !== undefined) { const t = String(d.price).trim(); if (!/^\d{1,5}(\.\d{1,2})?$/.test(t) || !(parseFloat(t) >= 1)) throw 'Price must be at least Rs 1 (up to 2 decimals)'; o.price = String(parseFloat(t)); }
    if (d.days !== undefined) { const n = parseInt(d.days, 10); if (!(n >= 1 && n <= 366)) throw 'Duration must be 1 to 366 days'; o.days = String(n); }
    if (d.active !== undefined) { o.active = d.active ? '1' : '0'; if (o.active === '0' && !rows('Plans').some(x => x.id !== r.id && x.active === '1')) throw 'At least one plan must stay active'; }
    upd('Plans', r._row, o); audit('plan_changed', c.a.id, r.id, 'price ' + r.price + '->' + (o.price || r.price) + ', days ' + r.days + '->' + (o.days || r.days) + ', active ' + r.active + '->' + (o.active || r.active));
    return { plans: plans() }; // already-created payment requests keep the price they were created with
  }
};

/* ---------- RUN FROM THE EDITOR (once): make a registered, verified Nexus account an administrator ---------- */
const ADMIN_EMAIL = ''; // <- type the email of YOUR Nexus account here, run makeAdmin() once, then clear it again
function makeAdmin() {
  const e = em(ADMIN_EMAIL); if (!e) throw 'Type your Nexus account email in ADMIN_EMAIL first';
  const u = userByMail(e); if (!u || u.verified !== '1') throw 'No verified account found for ' + e + '. Register and verify it in the app first';
  if (!rows('Admins').some(a => a.userId === u.id)) add('Admins', { id: uid(), userId: u.id, email: e, perms: 'all', added: Date.now() });
  seedDefaults(); audit('admin_added', 'editor', u.id, e);
}
function removeAdmin() { const e = em(ADMIN_EMAIL), u = e && userByMail(e); if (u) { delAll('Admins', a => a.userId === u.id); audit('admin_removed', 'editor', u.id, e); } }
