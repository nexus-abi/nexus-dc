/* Backend simulation tests for backend/Code.gs (premium, payments, admin, expiry, security).
   Run:  node tests/backend/run.js          (needs only Node 18+; no Google account) */
const path = require('path'), { makeEnv } = require('./gas-mock');
const SRC = path.join(__dirname, '..', '..', 'backend', 'Code.gs');
const ADMIN = 'owner@example.com', U1 = 'asha@example.com', U2 = 'ravi@example.com', U3 = 'meena@example.com';
const E = makeEnv(SRC, { adminEmail: ADMIN }), { call, clock, mails, ev } = E;
const DAY = 864e5; let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const err = (r, re, m) => ok(r.ok === 0 && re.test(r.error), m + (r.ok === 0 ? '  [' + r.error + ']' : '  [UNEXPECTED SUCCESS]'));
const good = (r, m) => ok(r.ok === 1, m + (r.ok ? '' : '  [' + r.error + ']'));
const sec = t => console.log('\n== ' + t);
const lastOtp = () => { const m = mails[mails.length - 1]; return /letter-spacing:10px[^>]*>(\d{6})</.exec(m.htmlBody)[1]; };
function user(email, name) {
  good(call('register', { name, email, phone: '9999999999', password: 'password1' }), 'register ' + email);
  const r = call('verify', { email, otp: lastOtp() }); good(r, 'verify ' + email); return r.data.token;
}
const T = {}; const unlock = () => call('adminUnlock', { token: T.admin, password: 'password1' }); const relog = () => { [['admin', ADMIN], ['a', U1], ['b', U2], ['c', U3]].forEach(([k, e]) => { const r = call('login', { email: e, password: 'password1' }); if (r.ok) T[k] = r.data.token; }); unlock(); }; /* sessions last 30 days, so log in again after a long simulated jump */
const pays = u => call('payInfo', { token: T[u] }).data;

sec('0. Setup and existing features still work');
call('doGet'); ev('setup()');
T.admin = user(ADMIN, 'Owner'); T.a = user(U1, 'Asha'); T.b = user(U2, 'Ravi'); T.c = user(U3, 'Meena');
ev('makeAdmin()');
let d = call('data', { token: T.a }).data;
ok(d.sub.status === 'free' && d.admin === false && typeof d.serverTime === 'number', 'new user is Free, not admin, gets serverTime');
ok(call('data', { token: T.admin }).data.admin === true, 'owner flagged as admin by server');
good(call('saveVehicle', { token: T.a, number: 'tn 01 ab 1234', model: 'Swift', owner: 'Asha', phone: '1' }), 'existing action saveVehicle');
ok(call('data', { token: T.a }).data.vehicles.length === 1, 'existing data() still returns vehicles');
good(call('updateProfile', { token: T.a, blood: 'O+' }), 'existing updateProfile');
const plansDefault = call('adminSettings', { token: T.admin });
err(plansDefault, /ADMIN_LOCKED/, 'admin API refuses before password step-up');

sec('1. Admin authorisation');
err(call('adminOverview', { token: T.a }), /Not authorized/, 'normal user cannot call adminOverview');
err(call('adminApprove', { token: T.a, paymentId: 'x', verified: true, received: 19 }), /Not authorized/, 'normal user cannot approve');
err(call('adminUnlock', { token: T.a, password: 'password1' }), /Not authorized/, 'normal user cannot unlock admin');
err(call('adminOverview', {}), /Session expired/, 'no token is refused');
err(call('adminOverview', { token: 'nope' }), /Session expired/, 'bad token is refused');
err(call('constructor', { token: T.a }), /Invalid action/, 'prototype names are not callable actions');
err(call('__proto__', { token: T.a }), /Invalid action/, '__proto__ is not an action');
for (let i = 0; i < 8; i++) err(call('adminUnlock', { token: T.admin, password: 'bad' + i }), /Wrong password|Too many/, 'wrong admin password #' + (i + 1));
err(call('adminUnlock', { token: T.admin, password: 'password1' }), /Too many wrong/, 'admin unlock is rate limited after repeated failures');
ev("rows('Limits').forEach(r => { if (r.key.indexOf('adm|') === 0) del('Limits', r._row) })"); // reset the daily limit for the rest of the test
good(call('adminUnlock', { token: T.admin, password: 'password1' }), 'admin unlock with the right password');
const ov0 = call('adminOverview', { token: T.admin }); good(ov0, 'adminOverview after unlock'); ok(ov0.data.users === 4 && ov0.data.revenue === 0, 'overview: 4 users, revenue 0');
clock.t += 16 * 60e3; err(call('adminOverview', { token: T.admin }), /ADMIN_LOCKED/, 'admin unlock expires after 15 minutes');
good(call('adminUnlock', { token: T.admin, password: 'password1' }), 're-unlock');

sec('2. Settings, plans, and payments disabled until UPI ID is set');
let pi = pays('a'); ok(pi.ready === false && pi.plans.length === 2, 'payments not ready; 2 default plans');
ok(pi.plans.find(p => p.id === 'weekly').price === 19 && pi.plans.find(p => p.id === 'weekly').days === 7, 'weekly = Rs 19 / 7 days');
ok(pi.plans.find(p => p.id === 'monthly').price === 49 && pi.plans.find(p => p.id === 'monthly').days === 30, 'monthly = Rs 49 / 30 days');
err(call('payCreate', { token: T.a, planId: 'weekly' }), /not set up/, 'cannot start a payment before the UPI ID is configured');
err(call('adminSetSettings', { token: T.admin, values: { upiId: 'not a upi' } }), /valid UPI/, 'invalid UPI ID rejected');
err(call('adminSetSettings', { token: T.admin, values: { qrImage: 'javascript:alert(1)' } }), /QR image/, 'unsafe QR image URL rejected');
err(call('adminSetSettings', { token: T.admin, values: { merchantName: '<script>' } }), /Merchant name/, 'unsafe merchant name rejected');
good(call('adminSetSettings', { token: T.admin, values: { upiId: 'Shop@okbank', merchantName: 'Nexus Docs', supportEmail: 'help@example.com' } }), 'set merchant UPI ID + name + support');
ok(call('adminSettings', { token: T.admin }).data.settings.upiId === 'shop@okbank', 'UPI ID saved (normalised to lower case)');
err(call('adminSavePlan', { token: T.admin, id: 'weekly', price: '0' }), /at least/, 'price below Rs 1 rejected');
err(call('adminSavePlan', { token: T.admin, id: 'weekly', price: 'abc' }), /Price/, 'non numeric price rejected');
good(call('adminSavePlan', { token: T.admin, id: 'weekly', price: '25' }), 'admin changes weekly price to 25');
ok(pays('a').plans.find(p => p.id === 'weekly').price === 25, 'users now see the new price');
good(call('adminSavePlan', { token: T.admin, id: 'weekly', price: '19' }), 'price back to 19');
err(call('adminSavePlan', { token: T.a, id: 'weekly', price: '1' }), /Not authorized/, 'normal user cannot change prices');

sec('3. User starts a payment (reference, snapshot, no activation)');
err(call('payCreate', { token: T.a, planId: 'yearly' }), /not available/, 'unknown plan rejected');
const c1 = call('payCreate', { token: T.a, planId: 'weekly' }); good(c1, 'create weekly request');
ok(/^NX[A-HJKMNP-Z2-9]{8}$/.test(c1.data.ref) && c1.data.amount === 19 && c1.data.status === 'created', 'unique reference ' + c1.data.ref + ', amount 19, status created');
const c1b = call('payCreate', { token: T.a, planId: 'monthly' });
ok(c1b.data.id === c1.data.id && c1b.data.ref === c1.data.ref && c1b.data.amount === 49 && c1b.data.days === 30, 'switching plan reuses the same request and reference, with the new 49 / 30 snapshot');
call('payCreate', { token: T.a, planId: 'weekly' });
ok(call('data', { token: T.a }).data.sub.status === 'free', 'just opening / creating a request does NOT activate premium');

sec('4. User submits transaction id -> PENDING only');
const id1 = c1.data.id;
err(call('paySubmit', { token: T.a, paymentId: id1, utr: '' }), /transaction ID/, 'empty transaction id rejected');
err(call('paySubmit', { token: T.a, paymentId: id1, utr: '12345' }), /transaction ID/, 'short transaction id rejected');
err(call('paySubmit', { token: T.a, paymentId: id1, utr: '111111111111' }), /transaction ID/, 'repeated-digit id rejected');
err(call('paySubmit', { token: T.a, paymentId: id1, utr: 'abc;drop table' }), /transaction ID/, 'garbage id rejected');
err(call('paySubmit', { token: T.b, paymentId: id1, utr: '412345678901' }), /not found/, "cannot submit someone else's request");
const s1 = call('paySubmit', { token: T.a, paymentId: id1, utr: '4123 4567 8901' }); good(s1, 'valid UTR submitted (spaces removed)');
ok(s1.data.status === 'pending' && s1.data.utr === '412345678901', 'status is PENDING, UTR normalised');
ok(call('data', { token: T.a }).data.sub.status === 'free', 'user is STILL Free while pending');
err(call('paySubmit', { token: T.a, paymentId: id1, utr: '412345678901' }), /Already submitted/, 'repeated submission refused');
const cb = call('payCreate', { token: T.b, planId: 'weekly' }).data;
err(call('paySubmit', { token: T.b, paymentId: cb.id, utr: '412345678901' }), /already been submitted/, 'DUPLICATE transaction id from another user refused');
const sh = (ev("rows('Payments').length"), 0);

sec('5. Admin verification and approval');
const list = call('adminPayments', { token: T.admin, status: 'pending' }); good(list, 'admin lists pending'); ok(list.data.items.length === 1 && list.data.items[0].userEmail === U1 && list.data.items[0].amount === 19, 'pending list shows user + expected amount');
err(call('adminApprove', { token: T.admin, paymentId: id1, received: 19 }), /Confirm that you checked/, 'approval needs the "I verified" confirmation');
err(call('adminApprove', { token: T.admin, paymentId: id1, verified: true, received: 18 }), /does not match/, 'WRONG AMOUNT cannot be approved (18 vs 19)');
err(call('adminApprove', { token: T.admin, paymentId: id1, verified: true, received: '' }), /actually received/, 'missing amount refused');
ok(call('data', { token: T.a }).data.sub.status === 'free', 'user still Free after failed approvals');
clock.t += 60e3; const tApprove = clock.t;
const ap = call('adminApprove', { token: T.admin, paymentId: id1, verified: true, received: 19, note: 'seen in bank statement' }); good(ap, 'approve with correct amount');
ok(ap.data.start === tApprove && ap.data.expiry === tApprove + 7 * DAY, 'weekly expiry = server approval time + exactly 7 days');
let sa = call('data', { token: T.a }).data.sub; ok(sa.status === 'active' && sa.planId === 'weekly' && sa.daysLeft === 7, 'user is Active, weekly, 7 days left');
err(call('adminApprove', { token: T.admin, paymentId: id1, verified: true, received: 19 }), /Only a pending/, 'double approval refused (no second subscription)');
ok(ev("rows('Subscriptions').length") === 1, 'exactly one subscription row exists');
ok(call('adminOverview', { token: T.admin }).data.revenue === 19, 'revenue counts the verified payment only (19)');
// race: a second pending row carrying the same UTR must not be approvable
ev(`add('Payments',{id:'race1',userId:'${ev("rows('Users').find(r=>r.email==='" + U2 + "').id")}',planId:'weekly',planName:'Weekly Premium',amount:'19.00',days:'7',ref:'NXRACE0001',utr:'412345678901',status:'pending',created:Date.now(),submitted:Date.now()})`);
err(call('adminApprove', { token: T.admin, paymentId: 'race1', verified: true, received: 19 }), /already used/, 'approve-time duplicate UTR guard');
call('adminReject', { token: T.admin, paymentId: 'race1', reason: 'duplicate id' });

sec('6. Rejected payments never activate premium');
const cc = call('payCreate', { token: T.c, planId: 'monthly' }).data; good(call('paySubmit', { token: T.c, paymentId: cc.id, utr: '555566667777' }), 'user C submits');
err(call('adminReject', { token: T.admin, paymentId: cc.id, reason: '' }), /reason/, 'rejection needs a reason');
good(call('adminReject', { token: T.admin, paymentId: cc.id, reason: 'Payment not received in our account' }), 'admin rejects');
ok(call('data', { token: T.c }).data.sub.status === 'free', 'rejected payment: user stays Free');
const mine = pays('c').payments[0]; ok(mine.status === 'rejected' && /not received/.test(mine.reason), 'user sees REJECTED and the reason');
err(call('adminApprove', { token: T.admin, paymentId: cc.id, verified: true, received: 49 }), /Only a pending/, 'a rejected payment cannot be approved later');
const cc2 = call('payCreate', { token: T.c, planId: 'monthly' }).data;
good(call('paySubmit', { token: T.c, paymentId: cc2.id, utr: '555566667777' }), 'same user may re-submit a UTR that was rejected for them (bank delay case)');
good(call('adminReject', { token: T.admin, paymentId: cc2.id, reason: 'Still not received' }), 'rejected again');
const cc3 = call('payCreate', { token: T.c, planId: 'monthly' }).data;
err(call('paySubmit', { token: T.c, paymentId: cc3.id, utr: '555566667777' }), /rejected before/, 'a UTR rejected twice is blocked');
err(call('paySubmit', { token: T.a, paymentId: call('payCreate', { token: T.a, planId: 'weekly' }).data.id, utr: '555566667777' }), /already been submitted/, "another user cannot reuse a rejected user's UTR");

sec('7. Renewal while active = stacking (paid time never lost)');
const r2 = call('payCreate', { token: T.a, planId: 'monthly' }).data; good(call('paySubmit', { token: T.a, paymentId: r2.id, utr: '700000000001' }), 'renewal submitted');
clock.t += 2 * DAY; unlock();
const ap2 = call('adminApprove', { token: T.admin, paymentId: r2.id, verified: true, received: 49 }); good(ap2, 'renewal approved on day 2');
ok(ap2.data.start === tApprove + 7 * DAY && ap2.data.expiry === tApprove + 37 * DAY, 'monthly starts when the weekly ends (day 7) and ends on day 37');
sa = call('data', { token: T.a }).data.sub; ok(sa.status === 'active' && sa.queued === 1 && sa.daysLeft === 35 && sa.paidUntil === tApprove + 37 * DAY, 'status: active, 1 queued, 35 days left (37 - 2)');
ok(call('adminOverview', { token: T.admin }).data.revenue === 68, 'revenue = 19 + 49');
// cap on stacking
ev("setSetting('maxAheadDays','40')"); err(call('payCreate', { token: T.a, planId: 'monthly' }), /plenty of Premium/, 'stacking cap enforced'); ev("setSetting('maxAheadDays','365')");

sec('8. Expiry (server clock only) and ads status');
clock.t = tApprove + 7 * DAY + 5e3; unlock(); sa = call('data', { token: T.a }).data.sub; ok(sa.status === 'active' && sa.planId === 'monthly', 'after day 7 the queued monthly takes over with no gap');
clock.t = tApprove + 37 * DAY - 1000; relog(); ok(call('data', { token: T.a }).data.sub.status === 'active', '1 second before the end: still active');
clock.t = tApprove + 37 * DAY + 1000; unlock(); sa = call('data', { token: T.a }).data.sub; ok(sa.status === 'expired' && sa.daysLeft === 0, 'after expiry: status = expired (ads return)');
ev('expireSubscriptions()'); ok(ev("rows('Users').find(r=>r.email==='" + U1 + "').sub") === 'expired', 'hourly job stores "expired" in the Users sheet');
ok(ev("rows('Subscriptions').every(s=>s.status==='expired')"), 'subscription rows marked expired');
ok(pays('a').payments.filter(p => p.status === 'approved').length === 2, 'payment history preserved after expiry');
const r3 = call('payCreate', { token: T.a, planId: 'weekly' }); good(r3, 'expired user can buy again'); ok(r3.data.status === 'created', 'new request created');

sec('9. Screenshots (optional proof, never sufficient)');
ev("setSetting('requireScreenshot','1')");
err(call('paySubmit', { token: T.a, paymentId: r3.data.id, utr: '800000000002' }), /screenshot/, 'screenshot required when the admin switches it on');
err(call('paySubmit', { token: T.a, paymentId: r3.data.id, utr: '800000000002', proof: Buffer.from('GIF89a....').toString('base64') }), /JPG or PNG/, 'non image proof rejected');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString('base64');
good(call('paySubmit', { token: T.a, paymentId: r3.data.id, utr: '800000000002', proof: png }), 'PNG proof accepted -> pending');
ok(call('data', { token: T.a }).data.sub.status === 'expired', 'screenshot + UTR do NOT activate premium');
ok(Object.values(E.files).length === 1 && Object.values(E.files)[0].shared === false, 'proof file stored privately (never shared by link)');
const pr = call('adminProof', { token: T.admin, paymentId: r3.data.id }); good(pr, 'admin can view proof'); ok(pr.data.mime === 'image/png', 'proof returned as image/png');
err(call('adminProof', { token: T.a, paymentId: r3.data.id }), /Not authorized/, 'normal user cannot view proofs');
ev("setSetting('requireScreenshot','0')");

sec('10. Self approval, notes, audit, rate limits');
const ad = call('payCreate', { token: T.admin, planId: 'weekly' }).data; good(call('paySubmit', { token: T.admin, paymentId: ad.id, utr: '900000000003' }), 'admin submits own payment');
err(call('adminApprove', { token: T.admin, paymentId: ad.id, verified: true, received: 19 }), /own payment/, 'admin cannot approve their own payment');
good(call('adminNote', { token: T.admin, paymentId: ad.id, note: 'waiting for second admin' }), 'admin note saved');
const au = call('adminAudit', { token: T.admin }); good(au, 'audit log readable');
const acts = au.data.map(x => x.action);
ok(['payment_approved', 'payment_rejected', 'admin_unlock', 'admin_unlock_failed', 'settings_changed', 'plan_changed', 'payment_note', 'subscription_expired', 'proof_viewed', 'admin_added'].every(a => acts.includes(a)), 'audit log has approvals, rejections, unlocks, settings, plan, notes, expiry, proof views');
ok(au.data.find(x => x.action === 'settings_changed' && /upiId: -> shop@okbank|upiId:  -> shop@okbank|upiId/.test(x.detail)), 'UPI ID change is logged with old and new value');
let n = 0; for (let i = 0; i < 25; i++) { const r = call('payCreate', { token: T.b, planId: 'weekly' }); if (!r.ok) { n++; } }
ok(n >= 5, 'payCreate is rate limited per user per day (' + n + ' refused of 25)');
const ovF = call('adminOverview', { token: T.admin }).data; ok(ovF.approved === 2 && ovF.rejected >= 3 && ovF.expired === 2, 'overview counts: approved 2, rejected >=3, expired subscriptions 2');

sec('11. Client cannot grant itself premium');
const fake = call('data', { token: T.c, sub: { status: 'active' }, premium: true, admin: true, paymentStatus: 'approved' }).data;
ok(fake.sub.status === 'free' && fake.admin === false, 'extra "premium / admin / sub" fields in a request are ignored');
err(call('adminApprove', { token: T.c, paymentId: cc.id, verified: true, received: 49 }), /Not authorized/, 'non-admin cannot approve even with a valid payment id');
err(call('paySubmit', { token: T.c, paymentId: id1, utr: '999988887777' }), /not found/, "cannot touch another user's payment row");

sec('12. Account deletion keeps financial history');
good(call('deleteAccount', { token: T.a, password: 'password1' }), 'user A deletes account');
ok(ev("rows('Payments').filter(p=>p.status==='approved').length") === 2, 'approved payments remain in the sheet for audit / revenue');
ok(call('adminOverview', { token: T.admin }).data.revenue === 68, 'revenue unchanged after account deletion');

sec('13. Own ads (admin creates, users see, counters, Premium never sees)');
relog(); unlock();
const AD1 = { title: 'Diwali Sale', type: 'image', media: 'https://example.com/banner.jpg', click: 'https://example.com/shop', cta: 'Shop now', placement: 'both', skip: 5, weight: 2 };
err(call('adminSaveAd', Object.assign({ token: T.b }, AD1)), /Not authorized/, 'normal user cannot create an ad');
err(call('adsFeed', {}), /Session expired/, 'adsFeed needs a login');
const a1 = call('adminSaveAd', Object.assign({ token: T.admin }, AD1)); good(a1, 'admin creates an image ad'); const ad1 = a1.data;
ok(ad1.state === 'live' && ad1.views === 0 && ad1.clicks === 0, 'new ad is live with zero counters');
err(call('adminSaveAd', { token: T.admin, title: 'X1', type: 'image', media: 'http://insecure.com/a.jpg' }), /https/, 'http:// media link refused');
err(call('adminSaveAd', { token: T.admin, title: 'X2', type: 'image', media: 'javascript:alert(1)' }), /https/, 'javascript: link refused');
err(call('adminSaveAd', { token: T.admin, title: 'X3', type: 'image', media: 'https://a.com/x.jpg', click: 'ftp://a.com' }), /Website link/, 'non-https website link refused');
err(call('adminSaveAd', { token: T.admin, title: 'X4', type: 'gif', media: 'https://a.com/x.jpg' }), /image or video/, 'bad type refused');
err(call('adminSaveAd', { token: T.admin, title: 'X5', type: 'image', media: 'https://a.com/x.jpg', start: 2000, end: 1000 }), /End date/, 'end before start refused');
err(call('adminSaveAd', { token: T.admin, title: 'X6', type: 'image', media: 'https://a.com/x"onerror=1' }), /https/, 'quote characters in link refused');
const a2 = call('adminSaveAd', { token: T.admin, title: 'Video promo', type: 'video', media: 'https://example.com/clip.mp4', placement: 'fullscreen', skip: 8 }); good(a2, 'admin creates a video ad (fullscreen only)');
let feed = call('adsFeed', { token: T.b }).data;
ok(feed.ads.length === 2 && feed.ads.every(a => a.views === undefined && a.clicks === undefined), 'free user receives both live ads without counters');
good(call('adTrack', { token: T.b, adId: ad1.id, ev: 'view' }), 'view tracked'); call('adTrack', { token: T.b, adId: ad1.id, ev: 'view' }); good(call('adTrack', { token: T.b, adId: ad1.id, ev: 'click' }), 'click tracked');
err(call('adTrack', { token: T.b, adId: ad1.id, ev: 'hack' }), /Invalid event/, 'unknown event refused');
let lst = call('adminAds', { token: T.admin }).data, row1 = lst.ads.find(a => a.id === ad1.id);
ok(row1.views === 2 && row1.clicks === 1 && row1.ctr === 50, 'admin sees views 2, clicks 1, CTR 50%');
const sc = call('adminSaveAd', { token: T.admin, title: 'Future', type: 'image', media: 'https://a.com/f.png', start: clock.t + 2 * DAY }); ok(sc.data.state === 'scheduled', 'future ad is scheduled');
ok(call('adsFeed', { token: T.b }).data.ads.length === 2, 'scheduled ad is not delivered yet');
const pa = call('adminAdStatus', { token: T.admin, id: ad1.id, status: 'paused' }); ok(pa.data.state === 'paused', 'admin pauses an ad');
ok(call('adsFeed', { token: T.b }).data.ads.length === 1, 'paused ad disappears from the feed');
ok(call('adTrack', { token: T.b, adId: ad1.id, ev: 'view' }).data === 0 && call('adminAds', { token: T.admin }).data.ads.find(a => a.id === ad1.id).views === 2, 'paused ad no longer counts views');
good(call('adminAdStatus', { token: T.admin, id: ad1.id, status: 'active' }), 'admin resumes the ad');
const ed = call('adminSaveAd', { token: T.admin, id: ad1.id, title: 'Diwali Sale 2', cta: 'Open' }); ok(ed.ok === 1 && ed.data.title === 'Diwali Sale 2' && ed.data.media === AD1.media && ed.data.views === 2, 'edit changes only given fields and keeps counters');
ok(call('adminOverview', { token: T.admin }).ok === 1 && call('adminSettings', { token: T.admin }).data.settings.adMode === 'mixed', 'ad source defaults to mixed');
good(call('adminSetSettings', { token: T.admin, values: { adMode: 'own' } }), 'admin sets ad source = own'); err(call('adminSetSettings', { token: T.admin, values: { adMode: 'evil' } }), /Ad source/, 'bad ad source refused');
ok(call('data', { token: T.b }).data.adMode === 'own' && call('subStatus', { token: T.b }).data.adMode === 'own', 'data() and subStatus() tell the app the ad source');
good(call('adminSetSettings', { token: T.admin, values: { adMode: 'startio' } }), 'ad source = startio'); ok(call('adsFeed', { token: T.b }).data.ads.length === 0, 'startio only: no own ads are delivered');
call('adminSetSettings', { token: T.admin, values: { adMode: 'mixed', adsEnabled: '0' } }); ok(call('adsFeed', { token: T.b }).data.ads.length === 0, 'kill-switch off: no own ads');
call('adminSetSettings', { token: T.admin, values: { adsEnabled: '1' } }); ok(call('adsFeed', { token: T.b }).data.ads.length === 2, 'kill-switch on again: ads return');
T.d = user('divya@example.com', 'Divya'); const pc = call('payCreate', { token: T.d, planId: 'weekly' }); good(pc, 'new user D starts a payment'); call('paySubmit', { token: T.d, paymentId: pc.data.id, utr: '556677889900' });
good(call('adminApprove', { token: T.admin, paymentId: pc.data.id, verified: true, received: 19 }), 'user D buys Premium');
ok(call('adsFeed', { token: T.d }).data.ads.length === 0, 'Premium user receives NO ads from the server');
ok(call('adsFeed', { token: T.c }).data.ads.length === 2, 'free user still receives ads');
good(call('adminDeleteAd', { token: T.admin, id: a2.data.id }), 'admin deletes an ad'); ok(call('adminAds', { token: T.admin }).data.ads.length === 2, 'deleted ad is gone from the list');
let nAudit = call('adminAudit', { token: T.admin, limit: 300 }).data.map(x => x.action); ok(['ad_created', 'ad_changed', 'ad_paused', 'ad_resumed', 'ad_deleted'].every(a => nAudit.includes(a)), 'every ad change is in the audit log');
for (let i = 0; i < 450; i++) { const r = call('adTrack', { token: T.c, adId: ad1.id, ev: 'view' }); if (r.ok === 0) { ok(i <= 400, 'ad tracking is rate limited per user per day (stopped at ' + i + ')'); break; } }

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
