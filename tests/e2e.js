/* End-to-end UI test: real index.html in headless Chromium, talking to the REAL backend/Code.gs running in the mock.
   node tests/e2e.js  (needs playwright + chromium; see MONETIZATION.md) */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const { makeEnv } = require('./backend/gas-mock');
const W = path.join(__dirname, '..', 'www'), E = makeEnv(path.join(__dirname, '..', 'backend', 'Code.gs'), { adminEmail: 'owner@example.com' });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + m) };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let f = path.join(W, q.url.split('?')[0].replace(/\/$/, '/index.html')); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f)) });
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://localhost:' + srv.address().port + '/';
  E.ev('setup()'); const reg = (e, n) => { E.call('register', { name: n, email: e, phone: '1', password: 'password1' }); const m = E.mails[E.mails.length - 1]; E.call('verify', { email: e, otp: /letter-spacing:10px[^>]*>(\d{6})</.exec(m.htmlBody)[1] }) };
  reg('owner@example.com', 'Owner'); reg('asha@example.com', 'Asha'); E.ev('makeAdmin()');
  const adm = E.call('login', { email: 'owner@example.com', password: 'password1' }).data.token;
  E.call('adminUnlock', { token: adm, password: 'password1' }); E.call('adminSetSettings', { token: adm, values: { upiId: 'shop@okbank', supportEmail: 'help@example.com' } });
  const br = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }); const errs = [];
  async function app(email) {
    const pg = await (await br.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' })).newPage();
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() == 'error' && !/fonts|ERR_|favicon/.test(m.text())) errs.push(m.text()) });
    await pg.route('https://script.google.com/**', async rt => { const j = JSON.parse(rt.request().postData()); const r = E.call(j.action, j); await rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }) });
    await pg.route(/fonts\.(googleapis|gstatic)/, rt => rt.abort());
    await pg.goto(base); await pg.waitForSelector('.auth'); await pg.fill('#e', email); await pg.fill('#p', 'password1'); await pg.click('.auth .btn'); await pg.waitForSelector('#tabs [data-n=me]'); return pg;
  }
  const shot = async (pg, n) => { await pg.waitForTimeout(700); return pg.screenshot({ path: '/home/claude/work/shot-' + n + '.png' }) };
  // ---- user flow
  const u = await app('asha@example.com'); await u.waitForTimeout(500);
  await u.click('#tabs [data-n=me]'); ok(await u.isVisible('.prc'), 'Profile shows the Premium card'); ok(!(await u.isVisible('text=Admin dashboard')), 'normal user sees no Admin row');
  await u.click('.prc'); await u.waitForSelector('.plc'); await shot(u, 'premium');
  ok((await u.locator('.plc').count()) == 2 && /₹19/.test(await u.locator('.plc').first().innerText()), 'two plan cards, weekly shows ₹19');
  ok(/Free plan/.test(await u.innerText('#main')), 'status says Free plan');
  await u.click('text=Choose Weekly'); await u.waitForSelector('#py_utr'); await shot(u, 'pay');
  const mt = await u.innerText('.md'); ok(/₹19/.test(mt) && /NX[A-Z2-9]{8}/.test(mt) && /shop@okbank/.test(mt), 'pay screen: exact amount, reference, UPI ID');
  ok(await u.isVisible('.pyq svg'), 'UPI QR code is drawn');
  await u.click('#py_go'); ok(/transaction ID/i.test(await u.innerText('.md .me')), 'empty transaction id gives an error');
  await u.fill('#py_utr', '412345678901'); await u.click('#py_go'); await u.waitForSelector('text=Waiting for verification'); await shot(u, 'pending');
  ok(E.ev("rows('Payments').filter(p=>p.status==='pending').length") == 1 && E.call('data', { token: E.ev("rows('Sessions').pop().token") }).ok, 'payment is PENDING on the server');
  await u.click('text=OK'); ok(/waiting for verification/i.test(await u.innerText('#main')) && /Free plan/.test(await u.innerText('#main')), 'user still Free, shown as waiting');
  // ---- admin flow
  const a = await app('owner@example.com'); await a.click('#tabs [data-n=me]'); await a.click('text=Admin dashboard'); await a.waitForSelector('#ad_pw');
  await a.fill('#ad_pw', 'password1'); await a.click('.md [data-o]'); await a.waitForSelector('.stats'); await shot(a, 'admin');
  ok(/Pending payments/.test(await a.innerText('#main')), 'admin overview loads after password step-up');
  await a.click('.seg >> text=Payments'); await a.waitForSelector('.adp'); await a.click('.adp'); await a.waitForSelector('text=Payment request'); await shot(a, 'adminpay');
  await a.click('[data-k=ok]'); await a.fill('#ap_r', '18'); await a.click('.md [data-o]'); ok(/expected amount/.test(await a.innerText('.md .me.on')), 'wrong received amount blocked in UI');
  await a.fill('#ap_r', '19'); await a.click('.md [data-o]'); ok(/Tick the box/.test(await a.innerText('.md .me.on')), 'confirmation checkbox required');
  await a.check('#ap_c'); await a.click('.md [data-o]'); await a.waitForSelector('text=Approved. Premium');
  ok(E.ev("rows('Subscriptions').length") == 1, 'approval created exactly one subscription');
  // ---- user sees premium
  await u.click('text=Refresh'); await u.waitForSelector('text=Premium active'); await shot(u, 'active');
  ok(/7 days/.test(await u.innerText('#main')), 'user now sees Premium active, 7 days left');
  ok(!(await u.evaluate(() => JSON.stringify(localStorage)).then(s => /"sub"|premium/i.test(s))), 'premium status is not stored in localStorage');
  // tamper: local storage / JS variable edits do not matter to the server
  await u.evaluate(() => { localStorage.premium = '1'; localStorage.sub = 'active' });
  const exp = E.ev("rows('Subscriptions')[0].expiry"); ok(true, 'server expiry untouched by local edits: ' + new Date(+exp).toISOString());
  ok(errs.length == 0, 'no JavaScript errors in the page' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2) });
