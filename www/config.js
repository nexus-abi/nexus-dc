/* Remote settings. Edit this file and push to GitHub: every user gets it on next app open, no APK rebuild.
   Leave NEXUS_API as-is unless your Apps Script web-app URL changes. */
window.NEXUS_API = 'https://script.google.com/macros/s/AKfycbyoUI9XTWBGhkSbduh6Z4ck2WANW3Wcrok7zk4gOqZRePt5zKVAqrU21YM4S6tjW2A5WQ/exec';

/* ---- Ads (Google AdMob). Works only inside the Android APK that contains the AdMob plugin. ----
   testMode:true  -> Google's official TEST ads only (safe while developing; never click live ads yourself).
   Before going live: create the app + ad units in AdMob, put the ad unit IDs below, set testMode:false,
   and read MONETIZATION.md ("Going live with ads"). With testMode:false and an empty ID, that ad type is simply not shown. */
window.NEXUS_ADS = {
  enabled: true,
  testMode: true,
  appOpen: { android: '' },   // optional: a real "App open" ad unit. If empty, the interstitial unit below is used for the launch ad too
  interstitial: { android: 'ca-app-pub-3589063278418504/9373866014' },   // AdMob unit "NEXUS DOCS" (check Format = Interstitial in AdMob)
  banner: { android: 'ca-app-pub-3589063278418504/3319593550' },
  appOpenGapMin: 10           // launch ad is shown at most once per this many minutes (set 0 for every open)
};
