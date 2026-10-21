/* Remote settings. Edit this file and push to GitHub: every user gets it on next app open, no APK rebuild.
   Leave NEXUS_API as-is unless your Apps Script web-app URL changes. */
window.NEXUS_API = 'https://script.google.com/macros/s/AKfycbyoUI9XTWBGhkSbduh6Z4ck2WANW3Wcrok7zk4gOqZRePt5zKVAqrU21YM4S6tjW2A5WQ/exec';

/* ---- Ads (Start.io). Works only inside the Android APK (it contains the native Start.io SDK + the "StartIo" plugin). ----
   The Start.io App ID lives in android-startio.json (it is baked into the APK). Start.io has no per-ad-unit IDs.
   testMode:true  -> Start.io TEST ads only. Use this while checking the first build. Never click live ads yourself.
   testMode:false -> real ads (only after your app is approved in the Start.io portal).
   banner / interstitial / launchAd: set any of them to false to switch that format off. */
window.NEXUS_ADS = {
  enabled: true,
  testMode: true,
  banner: true,           // small banner above the bottom tabs
  interstitial: true,     // full-screen ad right after a fresh login
  launchAd: true,         // full-screen ad when the app is opened while already logged in
  appOpenGapMin: 10       // launch ad is shown at most once per this many minutes (set 0 for every open)
};

/* ---- Your OWN ads (v5): you create them inside the app: Profile > Admin dashboard > Ads > New ad (image link or video link).
   ownAds:false           -> switch your own ads off on every phone (the server list is ignored)
   bannerRotateSec        -> if you have several banner ads, change the banner every this many seconds
   Which ads free users see (own / Start.io / both) is chosen in Admin > Settings > "Which ads free users see". */
window.NEXUS_ADS.ownAds = true;
window.NEXUS_ADS.bannerRotateSec = 12;
