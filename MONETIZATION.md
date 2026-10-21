# Nexus Docs v4: Premium, UPI payments, admin dashboard, ads

Everything here was added **on top of** your app. No existing screen, action or data was removed.

## 1. What I found (analysis before editing)
| Item | Finding |
|---|---|
| App entry | `www/index.html` (one file: CSS + JS). `www/config.js` holds the Apps Script URL. |
| Android wrapper | **Capacitor 7** (not a bare WebView). The APK loads the UI live from GitHub Pages (`server.url`), so `www/` changes need **no APK rebuild**. Native plugins (Share, Filesystem, LocalNotifications) are already used through the Capacitor bridge. |
| Backend | **Google Apps Script bound to a Google Sheet** (`backend/Code.gs`), email + password accounts, 30-day sessions. Reused as is. |
| Hosting / CI | GitHub Pages (UI) + GitHub Actions (APK). `scripts/prep_android.py` patches the generated Android project. |
| Local storage | Used only for session token, cached data, prefs. |
| Base file | Built on your latest `Code.gs` (login limit, file-owner checks, UTC reminders) and your latest `index.html`. |

**Integration approach:** new sheets + new actions in the same `Code.gs` (same URL, so no APK change for the backend); new screens in `index.html` using the existing modal/card/row styles; Start.io through a small native Capacitor plugin (the SDK cannot run in page JavaScript).

## 2. Files
**Modified:** `backend/Code.gs`, `www/index.html`, `www/config.js`, `www/sw.js`, `package.json`, `scripts/prep_android.py`, `.github/workflows/main.yml`
**New:** `www/qr.js` (offline QR generator), `android-startio.json`, `MONETIZATION.md`, `tests/backend/*` (mock + 124 checks), `tests/qr/*`, `tests/e2e.js`

## 3. How it works
* **Server is the only authority.** The app asks `data`/`subStatus`/`payInfo`; the answer is kept in memory only. Local-storage edits, JS variable edits, URL parameters, screenshots and "success" messages cannot activate anything. Server time (`Date.now()` on Apps Script) is used for every start/expiry; the phone clock is never used (the app counts elapsed time with the monotonic clock and re-checks on resume).
* **Flow:** Upgrade → choose plan → server creates ONE draft request (reference `NXxxxxxxxx`, price snapshot) → user pays by UPI (QR with exact amount, UPI link, copy UPI ID/reference) → enters UTR (+ optional screenshot) → status **Pending**. Nothing activates.
* **Admin approval:** admin finds the UTR in the real UPI/bank records, types the amount actually received, ticks the confirmation, approves. The server re-checks: pending only, amount equals the snapshot, UTR not already approved, not your own payment (setting), then creates the subscription and writes the audit log.
* **Renewal policy = stacking.** Buying while active starts the new plan when the current one ends; no paid time is lost (cap: 365 days ahead, configurable).
* **Expiry:** computed live from server time; an hourly trigger also marks rows `expired`. History is kept. Ads return automatically.
* **No auto-renewal.** Every payment is one-time; the UI says so.
* **Statuses:** payment = pending / approved / rejected (+ internal `created`, `cancelled`); user = free / active / expired.

## 4. Sheets created (automatically by `setup()` or on first use)
Plans, Settings, Payments, Subscriptions, Admins, Audit (+ `adminUntil` column on Sessions, `sub` column on Users). Time values are epoch milliseconds.

## 5. Deploy the backend
1. Google Sheet → Extensions → Apps Script → replace all code with `backend/Code.gs` → Save.
2. Run `setup()` (creates sheets, default plans Weekly ₹19/7 days and Monthly ₹49/30 days; approve permissions).
3. Run `installTrigger()` (adds the hourly expiry job next to the 8 AM reminders).
4. Deploy → Manage deployments → pencil → Version **New version** → Deploy. **The URL stays the same.**
5. **Make yourself admin:** register + verify your account in the app. In `Code.gs` set `const ADMIN_EMAIL = 'you@gmail.com';`, run `makeAdmin()` once, then clear the constant. (Or add a row to the `Admins` sheet: id, userId, email, `all`, any number.) There is deliberately **no way to become admin from the app**.
6. Commit `www/` etc. to GitHub (Pages deploys). Because `package.json`/`prep_android.py` changed, the **APK workflow rebuilds once** (needed for the ads plugin). Existing APKs keep working without ads/premium-ads logic.

## 6. UPI setup (admin)
App → Profile → **Admin dashboard** (asks your password again, valid 15 min) → Settings: merchant UPI ID, display name, support email/phone, optional QR image, instructions, "require screenshot", prices. Until a UPI ID is set, payments stay **off**. Changing the UPI ID asks for confirmation and is audit-logged with old/new value.
Notes: a personal UPI ID works for P2P links/QR; merchants UPI IDs behave the same. Payments are matched by **UTR + amount** in your UPI app/bank statement, the reference in the note helps you find it.

## 7. Admin dashboard
Overview (users, active premium, pending/approved/rejected, expired subscriptions, verified revenue + last 30 days), Payments (filter, search, approve, reject with user-visible reason, internal notes, screenshot viewer, user history), Settings & prices, Audit log. Revenue counts **approved** payments only. Screenshots are stored in a private Drive folder "Nexus Payment Proofs" (never shared by link).

## 8. Ads (Start.io): how it works and honest limits
* Ads come from **Start.io** (portal.start.io). The Android SDK `com.startapp:inapp-sdk:5.+` is added to the APK by `scripts/prep_android.py`, together with a small native Capacitor plugin called `StartIo` (`StartIoPlugin.java`, written into the generated Android project). The Start.io **App ID** is in `android-startio.json` (currently `209780893`). Start.io has no ad-unit IDs, only the App ID.
* The web UI (`www/index.html`) decides when an ad may appear; the plugin only loads and shows it. Start.io's own automatic *return ads* and *splash ads* are switched off in the manifest, so nothing can bypass Premium.
* **Banner:** above the tab bar on Home, Documents, Vehicles, Tools, Calendar, Insights only; hidden on forms, pop-ups, viewer, vault, profile, premium and admin screens.
* **Full-screen (interstitial):** once right after a fresh login, and when the app is opened while already logged in (at most once per `appOpenGapMin` minutes, never on the first launch after install, never while a pop-up/viewer/lock/vault/loader is open, dropped if it loads too slowly). Start.io has no separate "App Open" format, so the interstitial is used for both.
* Never shown to a user whose active Premium was confirmed by the server, and never before the server has answered. A server kill-switch ("Ads enabled") is in admin settings. Load failures are swallowed.
* `www/config.js`: `testMode:true` shows Start.io **test ads** (use for the first build, never click live ads). Set `testMode:false` for real ads. `banner`, `interstitial`, `launchAd` can each be set to `false`. config.js is served live, so changing it needs no APK rebuild.
* **Consent:** Start.io shows its own disclosure/consent box shortly after the app starts. Mention advertising and Start.io in your privacy policy.
* **Not verified here:** the APK could not be built in the environment where this was written (no Android SDK / Maven access). **Do not consider ads working until you test the built APK on a phone** (test banner at the bottom above the tabs; test full-screen ad after login / reopening the app). The in-app diagnostic (Profile > tap the version line) lists the usual reasons why no ad is shown.
* A newly added app can take time to be reviewed in the Start.io portal before real ads fill well; "Missing URL" in the portal is only the store link and can be added later.

### Distribution reality (important)
* **Google Play:** if you ever publish on Play, Play's payments policy generally requires Play Billing for digital subscriptions, and manual UPI for an in-app premium would not be allowed there (check the current policy). The manual UPI design is for direct distribution only.
* Check Start.io's current publisher policies for apps distributed outside a store.

### Going live with ads (checklist)
1. Start.io portal: app added (App ID in `android-startio.json`), later add the store URL and `app-ads.txt` if you have a developer website.
2. Rebuild the APK (GitHub Actions) and test with `testMode:true` on a real phone.
3. Publish a privacy policy that mentions advertising / Start.io.
4. Set `testMode:false` in `www/config.js` and push (no rebuild needed).

## 9. Build the APK
Commit to GitHub as before. Actions → "Build Android APK" runs automatically (package.json changed) or press Run workflow. Install from Releases. UI-only changes later deploy without a rebuild.

## 10. Testing
Run on any PC with Node: `node tests/backend/run.js` (124 checks of the real `Code.gs` in a mock: pending-only, wrong amount, duplicate UTR, admin protection, stacking, expiry, rate limits, audit). `node tests/qr/make.js out.json && python3 tests/qr/decode.py out.json` (QR decodes with OpenCV). `node tests/e2e.js` (headless Chromium: real UI against the real backend code; needs `playwright`).
**Manual checklist on a phone:** new user sees ads only after the first launch; free user sees test banner; choose weekly and monthly; submit UTR → Pending and still free; admin approves → premium active, ads gone; wrong amount refused; duplicate UTR refused; reject → still free with reason; edit localStorage → no change; airplane mode → app works, no premium granted; wait for / simulate expiry → ads return; existing features (documents, vault, reminders) unchanged.

## 11. Known limitations
* Manual verification means premium is not instant. Automatic UPI verification needs a payment gateway with webhooks (Razorpay/Cashfree etc.); a server-side verifier can later call the same `adminApprove` logic.
* Ad hiding is decided on the phone from the server's answer. On a rooted/debuggable device someone could hide ads locally; they gain nothing else (Premium only removes ads). Server data and approvals cannot be forged.
* No revoke/refund action yet (edit the sheet and add an Audit row manually).
* Apps Script is a small database: fine for hundreds/thousands of users; very large volumes need a real DB.
* Existing behaviour I noticed but did not change: `login` has no brute-force limit (admin step-up does).
* Payment records are intentionally kept when a user deletes their account.

## 12. Production checklist
- [ ] `setup()`, `installTrigger()`, new deployment version
- [ ] Admin created, UPI ID, name, support contact set; send a ₹ test payment and approve it
- [ ] `allowSelfApprove` OFF; only trusted people in `Admins`; sheet itself shared with nobody
- [ ] Test ads checked on a phone; privacy policy ready; `testMode:false` only after review
- [ ] APK rebuilt from this version and distributed
