/* End-to-end test for OWN ADS: admin creates an ad in the real UI, a free user sees the banner and the full-screen ad,
   taps are counted, Premium users see nothing.   NODE_PATH=$(npm root -g) CHROME=<chromium> node tests/e2e-ads.js */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const { makeEnv } = require('./backend/gas-mock');
const W = path.join(__dirname, '..', 'www'), E = makeEnv(path.join(__dirname, '..', 'backend', 'Code.gs'), { adminEmail: 'owner@example.com' });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + m) };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let f = path.join(W, q.url.split('?')[0].replace(/\/$/, '/index.html')); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)) });
// a real 1x1-ish PNG served as the "ad image" so the browser can load it
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://localhost:' + srv.address().port + '/';
  E.ev('setup()'); const reg = (e, n) => { E.call('register', { name: n, email: e, phone: '1', password: 'password1' }); const m = E.mails[E.mails.length - 1]; E.call('verify', { email: e, otp: /letter-spacing:10px[^>]*>(\d{6})</.exec(m.htmlBody)[1] }) };
  reg('owner@example.com', 'Owner'); reg('asha@example.com', 'Asha'); reg('ravi@example.com', 'Ravi'); E.ev('makeAdmin()');
  const adm = E.call('login', { email: 'owner@example.com', password: 'password1' }).data.token;
  E.call('adminUnlock', { token: adm, password: 'password1' }); E.call('adminSetSettings', { token: adm, values: { upiId: 'shop@okbank' } });
  const br = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  async function app(email) {
    const pg = await (await br.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' })).newPage();
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() == 'error' && !/fonts|ERR_|favicon|Failed to load resource/.test(m.text())) errs.push(m.text()) });
    await pg.route('https://script.google.com/**', async rt => { const j = JSON.parse(rt.request().postData()); const r = E.call(j.action, j); await rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) }) });
    await pg.route('https://ads.example.com/**', rt => rt.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await pg.route('https://bad.example.com/**', rt => rt.abort());
    await pg.route(/fonts\.(googleapis|gstatic)/, rt => rt.abort());
    await pg.goto(base); await pg.waitForSelector('.auth'); await pg.fill('#e', email); await pg.fill('#p', 'password1'); await pg.click('.auth .btn'); await pg.waitForSelector('#shell.on'); return pg
  }
  const shot = async (pg, n) => { await pg.waitForTimeout(500); return pg.screenshot({ path: '/home/claude/work/ads-' + n + '.png' }) };
  // ---- admin creates an ad in the real UI
  const a = await app('owner@example.com'); await a.waitForTimeout(400);
  await a.click('#tabs [data-n=me]'); await a.click('text=Admin dashboard');
  await a.waitForSelector('#ad_pw'); await a.fill('#ad_pw', 'password1'); await a.click('.md [data-o]');
  await a.waitForSelector('.seg.c5'); ok((await a.locator('.seg.c5 button').allInnerTexts()).includes('Ads'), 'admin dashboard has an Ads tab');
  await a.click('.seg.c5 >> text=Ads'); await a.waitForSelector('text=New ad'); ok(/No ads yet/.test(await a.innerText('#admb')), 'Ads tab starts empty');
  await a.click('text=New ad'); await a.waitForSelector('#ad_t');
  await a.fill('#ad_t', 'Diwali Sale'); await a.fill('#ad_m', 'http://insecure.example.com/a.png'); await a.click('.md [data-o]');
  ok(/https:\/\//.test(await a.innerText('.md .me')), 'http:// link is refused in the form');
  await a.fill('#ad_m', 'https://ads.example.com/banner.png'); await a.fill('#ad_c', 'https://example.com/shop'); await a.fill('#ad_sk', '2');
  await a.click('[data-pv=b]'); await a.waitForSelector('.oapv img'); ok(true, 'banner preview shows the image link');
  await a.click('[data-pv=f]'); await a.waitForSelector('.oaf.on'); await shot(a, 'preview-full'); ok(/Skip in|Close/.test(await a.innerText('.oaf .ofx')), 'full-screen preview opens with a skip timer');
  await a.waitForTimeout(2300); await a.click('.oaf .ofx'); await a.waitForTimeout(400); ok(!(await a.locator('.oaf').count()), 'preview closes after the timer');
  ok(E.ev("rows('Ads').length") == 0, 'previews do not create or count anything');
  await a.click('.md [data-o]'); await a.waitForSelector('text=Ad saved'); await a.waitForSelector('.adp');
  ok(E.ev("rows('Ads').length") == 1 && /Diwali Sale/.test(await a.innerText('#admb')) && /Live/.test(await a.innerText('#admb')), 'ad saved and shown as Live in the list');
  await shot(a, 'admin-list');
  // second ad whose file can not load: app must skip it silently
  E.call('adminSaveAd', { token: adm, title: 'Broken link', type: 'image', media: 'https://bad.example.com/x.png', placement: 'both', weight: 1 });
  // ---- free user sees it
  const u = await app('asha@example.com');
  await u.waitForSelector('.oaf.on', { timeout: 15000 }); ok(true, 'full-screen ad appears right after a fresh login (a broken second ad is skipped)');
  await u.waitForSelector('.oaf .ofx:not([disabled])', { timeout: 9000 }); await u.click('.oaf .ofx'); await u.waitForTimeout(400);
  await u.waitForSelector('#oab img', { timeout: 15000 }); await shot(u, 'user-banner');
  ok(await u.evaluate(() => document.body.classList.contains('adb') && document.body.classList.contains('oa')), 'free user sees the own banner above the tabs');
  ok(/Ad/.test(await u.innerText('#oab')), 'banner is labelled "Ad"');
  ok(E.ev("rows('Ads').find(a=>a.title==='Diwali Sale').views") >= 1, 'banner view counted on the server');
  const vb = +E.ev("rows('Ads').find(a=>a.title==='Diwali Sale').views");
  const popup = u.waitForEvent('popup', { timeout: 3000 }).catch(() => null); await u.click('#oab'); await popup; await u.waitForTimeout(500);
  ok(E.ev("rows('Ads').find(a=>a.title==='Diwali Sale').clicks") == 1, 'tap on banner counted once');
  ok(await u.evaluate(() => { return !document.querySelector('.ov.on') }), 'no stray pop-up');
  // banner hidden on a form/modal screen
  await u.click('#tabs [data-n=me]'); await u.waitForTimeout(800); ok(!(await u.evaluate(() => document.body.classList.contains('oa'))), 'banner is not shown on the Profile screen');
  await u.click('#tabs [data-n=home]'); await u.waitForTimeout(800); ok(await u.evaluate(() => document.body.classList.contains('oa')), 'banner returns on Home');
  // full-screen on login: reload logged-in -> launch ad
  await u.evaluate(() => { localStorage.removeItem('nxao') }); await u.reload(); await u.waitForSelector('.oaf.on', { timeout: 15000 }); await shot(u, 'user-full');
  ok(/Skip in|Close/.test(await u.innerText('.oaf .ofx')) && /Learn more/.test(await u.innerText('.oaf')), 'launch full-screen ad appears with skip timer and button');
  await u.keyboard.press('Escape'); ok(await u.locator('.oaf').count() == 1, 'cannot close before the skip time');
  await u.waitForSelector('.oaf .ofx:not([disabled])', { timeout: 9000 }); await u.click('.oaf .ofx'); await u.waitForTimeout(500); ok(!(await u.locator('.oaf').count()), 'closes after the skip time');
  ok(!errs.length, 'no JavaScript errors so far' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  // pause in admin -> user stops getting it after refresh
  E.call('adminAdStatus', { token: adm, id: E.ev("rows('Ads').find(a=>a.title==='Diwali Sale').id"), status: 'paused' });
  await u.reload(); await u.waitForSelector('#shell.on'); await u.waitForTimeout(2500); ok(!(await u.locator('.oaf').count()) && !(await u.evaluate(() => document.body.classList.contains('oa'))), 'paused ad is gone for users');
  E.call('adminAdStatus', { token: adm, id: E.ev("rows('Ads').find(a=>a.title==='Diwali Sale').id"), status: 'active' });
  // premium user: nothing
  const ravi = E.call('login', { email: 'ravi@example.com', password: 'password1' }).data.token;
  const pc = E.call('payCreate', { token: ravi, planId: 'weekly' }).data; E.call('paySubmit', { token: ravi, paymentId: pc.id, utr: '556677889900' }); E.call('adminApprove', { token: adm, paymentId: pc.id, verified: true, received: 19 });
  const p = await app('ravi@example.com'); await p.waitForTimeout(3500);
  ok(!(await p.locator('#oab img').count()) && !(await p.locator('.oaf').count()) && !(await p.evaluate(() => document.body.classList.contains('oa'))), 'Premium user sees no own ads');
  ok(!errs.length, 'no JavaScript errors in the page' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await br.close(); srv.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2) });
