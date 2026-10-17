# Nexus Docs v3.3 - Android APK (cloud build + live updates)

## v3.3: update the app WITHOUT rebuilding the APK
The APK is now a thin shell. The app screens (`www/`) are served live from GitHub Pages.

ONE-TIME SETUP
1. Repo must be **Public** (free GitHub Pages). Settings > Pages > Source = **GitHub Actions**.
2. Commit everything to `main`. Two workflows run: "Deploy app UI" (Pages) and "Build Android APK".
3. Wait for both to be green, then install the APK from Releases. Share THIS APK with users once.

EVERY LATER UPDATE (new option, new screen, bug fix)
- Edit files in `www/` and commit. "Deploy app UI" runs (about 1 minute). Users get the new version the next time they open the app. No new APK, no reinstall.
- Apps Script change: edit code > Deploy > Manage deployments > pencil > Version: New version > Deploy (URL stays the same).
- If the Apps Script URL ever changes: edit `www/config.js` only and commit.
- Rebuild the APK ONLY when you add a new native plugin, change the app icon, name or permissions (Actions > Build Android APK > Run workflow).

---
# Nexus Docs v3.2 notes

No Android Studio or PC setup needed. GitHub builds the APK for you.

1. Create a free account at github.com and make a new repository (private is fine).
2. Upload everything in this folder (keep the folder layout, including the hidden `.github` folder) and commit to the `main` branch.
3. Open the repo > Actions tab > "Build Android APK". It runs by itself after the upload (about 5 to 8 minutes). You can also press "Run workflow".
4. When it turns green, open the repo > Releases > "Nexus Docs APK" > download NexusDocs.apk on your phone.
5. Open the APK. If Android asks, allow "Install unknown apps" for your browser or Files app.

Notes
- This is a debug-signed APK: fine for your own phone and sharing with family, not for Play Store.
- To update the app later, replace the files in `www/` and commit again. A new APK is built each time.
- Backend (Apps Script) is unchanged from the v2 package: the app talks to the same Google Sheet.

What's new in v3
- Header no longer hides under the status bar / camera cut-out (Android 15 edge-to-edge fix, done in MainActivity via scripts/prep_android.py).
- Phone back button: closes popup > viewer > vehicle detail > goes to Home. Press back twice on Home to exit.
- Documents have a Front and a Back slot. Front + Back is ONE document ("Front + Back"), not "2 files".
- Pull down to refresh, copy document number, share all pages, dark navy header, phone expiry notifications (Profile > Phone notifications).
- New plugins: @capacitor/app, @capacitor/local-notifications (installed automatically by the GitHub build).

What's new in v3.1: Password Vault
- New "Vault" tab: save logins (title, category, website link, username/ID, password, notes) plus any "related details" (security question, PIN, linked email, backup code...).
- Tap "Open website" to open the saved link in the phone browser. Copy username/password with one tap, show/hide, star, search, filter by category.
- Edit anytime. Old passwords are kept in a small history (last 5) so you can always find the previous one.
- Built-in strong password generator + strength meter.
- Everything is encrypted on the phone (AES-256-GCM, key from your master password). The Google Sheet only stores unreadable text. The master password cannot be recovered: if you forget it, use Vault > Reset.
- Auto-locks after 3 minutes idle or 1 minute in the background.

What's new in v3.2: share / download the real file
- Document menu (the ... on a document) now has "Share file" and "Download file" besides "Share link".
- Share file sends the actual PDF / image / any file through the Android share sheet (WhatsApp, Gmail, Drive, Bluetooth...). No link involved.
- If a document has Front + Back or many pages, pick one page or "All pages". Files are named like "Aadhaar - Front.jpg".
- The document viewer has a Share button for the page you are looking at.
- In the APK, "Download file" opens the share sheet so you can Save to Files / Drive. In a browser it downloads directly.

Backend update needed ONCE (backend/Code.gs) - covers the vault (v3.1) and file sharing (v3.2)
1. Open your Google Sheet > Extensions > Apps Script.
2. Replace the whole code with backend/Code.gs from this package. Save.
3. Select the function `setup` > Run (creates the new "Vault" sheet).
4. Deploy > Manage deployments > pencil icon > Version: "New version" > Deploy. (The web app URL stays the same, so the app needs no change.)
Then commit the new files to GitHub as usual to build the new APK.
