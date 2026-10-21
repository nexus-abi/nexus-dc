"""Runs after `npx cap add android`: installs launcher icons, permissions and the native
status-bar / navigation-bar handling (MainActivity)."""
import glob, os, re, shutil

res = 'android/app/src/main/res'

# 1. launcher icons -------------------------------------------------------------------
for d in os.listdir('android-res'):
    shutil.copytree(os.path.join('android-res', d), os.path.join(res, d), dirs_exist_ok=True)
os.makedirs(os.path.join(res, 'values'), exist_ok=True)
with open(os.path.join(res, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F1B3D</color>\n</resources>\n')

# 2. notification icon (white bell) ---------------------------------------------------
os.makedirs(os.path.join(res, 'drawable'), exist_ok=True)
with open(os.path.join(res, 'drawable', 'ic_stat_nexus.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" '
            'android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FFFFFF" '
            'android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.63,-5.64 -4.5,-6.32V4c0,-0.83 '
            '-0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.64,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/></vector>\n')

# 3. permissions ----------------------------------------------------------------------
m = 'android/app/src/main/AndroidManifest.xml'
t = open(m).read()
extra = ''
if 'android.permission.CAMERA' not in t:
    extra += ('\n    <uses-permission android:name="android.permission.CAMERA" />'
              '\n    <uses-feature android:name="android.hardware.camera" android:required="false" />')
if 'android.permission.POST_NOTIFICATIONS' not in t:
    extra += '\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
if extra:
    t, n = re.subn(r'(<uses-permission android:name="android.permission.INTERNET"\s*/>)', lambda x: x.group(1) + extra, t, count=1)
    if n != 1:
        raise SystemExit('INTERNET permission line not found in AndroidManifest.xml')
    open(m, 'w').write(t)

# 3b. Start.io: app id (manifest + string resource), SDK dependency, minSdk 24 ----------------
import json
ads = json.load(open('android-startio.json'))
app_id = str(ads.get('appId', '')).strip()
if not re.fullmatch(r'\d{6,12}', app_id):
    raise SystemExit('android-startio.json: appId must be the numeric Start.io App ID, e.g. 209780893')
with open(os.path.join(res, 'values', 'startio.xml'), 'w') as f:  # a string resource keeps the id a String (not an Integer) in the manifest
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="startio_app_id" translatable="false">%s</string>\n</resources>\n' % app_id)
t = open(m).read()
if 'com.startapp.sdk.APPLICATION_ID' not in t:
    meta = ('\n        <meta-data android:name="com.startapp.sdk.APPLICATION_ID" android:value="@string/startio_app_id"/>'
            # the JS layer decides when ads are shown (never for Premium), so Start.io's own automatic ads stay off
            '\n        <meta-data android:name="com.startapp.sdk.RETURN_ADS_ENABLED" android:value="false"/>'
            '\n        <meta-data android:name="com.startapp.sdk.SPLASH_ADS_ENABLED" android:value="false"/>')
    t, n = re.subn(r'(<application\b[^>]*>)', lambda x: x.group(1) + meta, t, count=1)
    if n != 1:
        raise SystemExit('<application> tag not found in AndroidManifest.xml')
    open(m, 'w').write(t)
bg = 'android/app/build.gradle'
g = open(bg).read()
if 'com.startapp:inapp-sdk' not in g:
    g, n = re.subn(r'^dependencies\s*\{', lambda x: x.group(0) + "\n    implementation 'com.startapp:inapp-sdk:5.+'", g, count=1, flags=re.M)
    if n != 1:
        raise SystemExit('dependencies block not found in android/app/build.gradle')
    open(bg, 'w').write(g)
pg = 'android/app/proguard-rules.pro'
if os.path.exists(pg) and 'com.startapp' not in open(pg).read():
    with open(pg, 'a') as f:
        f.write('\n-dontwarn com.startapp.**\n')
vg = 'android/variables.gradle'
if os.path.exists(vg):
    g = open(vg).read()
    g2 = re.sub(r'minSdkVersion\s*=\s*(\d+)', lambda x: 'minSdkVersion = 24' if int(x.group(1)) < 24 else x.group(0), g)
    if g2 != g:
        open(vg, 'w').write(g2)
print('Start.io app id set (%s)' % ('DEMO id' if app_id == '205489527' else app_id))

# 4. MainActivity: keeps the app header below the status bar / camera cut-out ----------
found = glob.glob('android/app/src/main/java/**/MainActivity.java', recursive=True)
if not found:
    raise SystemExit('MainActivity.java not found')
path = found[0]
pkg = re.search(r'^package\s+([\w.]+);', open(path).read(), re.M).group(1)
JAVA = '''package %s;

import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Android 15+ draws apps edge-to-edge, so the web page ended up under the status bar / camera.
 * This activity measures the system bars and hands the sizes (in CSS px) to the web page, which
 * pads its header and bottom tab bar with them. While the keyboard is open the web view is
 * simply shrunk so inputs stay visible.
 */
public class MainActivity extends BridgeActivity {
    private volatile String insets = "0,0,0,0";
    private WebView web;
    private WindowInsetsControllerCompat ctl;

    public class InsetsBridge {
        @JavascriptInterface
        public String get() { return insets; }

        @JavascriptInterface
        public void bars(final boolean dark) {
            runOnUiThread(new Runnable() {
                @Override public void run() { ctl.setAppearanceLightNavigationBars(!dark); }
            });
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StartIoPlugin.class); // Start.io ads (must be called before super.onCreate)
        super.onCreate(savedInstanceState);
        web = getBridge().getWebView();
        ctl = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        ctl.setAppearanceLightStatusBars(false); // header is dark navy -> white status icons
        web.addJavascriptInterface(new InsetsBridge(), "NexusInsets");

        final View root = findViewById(android.R.id.content);
        final float d = getResources().getDisplayMetrics().density;
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, w) -> {
            Insets bars = w.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = w.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboard = ime.bottom > 0;
            v.setPadding(0, 0, 0, keyboard ? ime.bottom : 0);
            int bottom = keyboard ? 0 : bars.bottom;
            insets = Math.round(bars.top / d) + "," + Math.round(bottom / d) + "," + Math.round(bars.left / d) + "," + Math.round(bars.right / d);
            final String js = "window.__ins&&window.__ins('" + insets + "')";
            web.post(new Runnable() {
                @Override public void run() { web.evaluateJavascript(js, null); }
            });
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(root);
    }
}
''' % pkg
open(path, 'w').write(JAVA)

PLUGIN = '''package %s;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.startapp.sdk.ads.banner.Banner;
import com.startapp.sdk.adsbase.Ad;
import com.startapp.sdk.adsbase.StartAppAd;
import com.startapp.sdk.adsbase.StartAppSDK;
import com.startapp.sdk.adsbase.adlisteners.AdEventListener;

/**
 * Thin bridge between the web UI and the native Start.io SDK. The web side (www/index.html) decides
 * WHEN an ad may be shown (never for Premium, never on forms...). This class only loads and shows.
 * JS name: "StartIo". Methods: initialize, showBanner, hideBanner, resumeBanner, removeBanner,
 * prepareInterstitial, showInterstitial. Event: bannerAdSizeChanged {height} (CSS px).
 */
@CapacitorPlugin(name = "StartIo")
public class StartIoPlugin extends Plugin {
    private static final int BANNER_DP = 50;
    private volatile boolean inited = false;
    private Banner banner;
    private volatile StartAppAd interstitial;
    private volatile boolean interstitialReady = false;

    private String manifestAppId() {
        try {
            ApplicationInfo ai = getContext().getPackageManager().getApplicationInfo(getContext().getPackageName(), PackageManager.GET_META_DATA);
            Bundle b = ai.metaData;
            if (b != null) {
                Object o = b.get("com.startapp.sdk.APPLICATION_ID");
                if (o != null) return String.valueOf(o);
            }
        } catch (Exception e) { }
        return null;
    }

    @PluginMethod
    public void initialize(final PluginCall call) {
        final boolean test = Boolean.TRUE.equals(call.getBoolean("testMode", false));
        final String appId = manifestAppId();
        final Activity a = getActivity();
        if (appId == null || a == null) { call.reject("Start.io app id missing"); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    if (inited) { call.resolve(); return; }
                    StartAppSDK.setTestAdsEnabled(test);
                    final boolean[] done = { false };
                    final Runnable ok = new Runnable() {
                        @Override public void run() {
                            if (done[0]) return;
                            done[0] = true; inited = true; call.resolve();
                        }
                    };
                    StartAppSDK.initParams(a.getApplicationContext(), appId).setReturnAdsEnabled(false).setCallback(ok).init();
                    new Handler(Looper.getMainLooper()).postDelayed(ok, 4000); // the SDK also auto-starts from the manifest, so do not hang if the callback is late
                } catch (Throwable t) {
                    call.reject("Start.io init failed: " + t.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void showBanner(final PluginCall call) {
        final int margin = call.getInt("margin", 0);
        final Activity a = getActivity();
        if (a == null) { call.reject("no activity"); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    ViewGroup root = a.findViewById(android.R.id.content);
                    float d = a.getResources().getDisplayMetrics().density;
                    if (banner == null) {
                        banner = new Banner(a);
                        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
                        lp.bottomMargin = Math.round(margin * d);
                        root.addView(banner, lp);
                    }
                    banner.setVisibility(View.VISIBLE);
                    banner.bringToFront();
                    JSObject o = new JSObject();
                    o.put("height", BANNER_DP + margin);
                    notifyListeners("bannerAdSizeChanged", o);
                    call.resolve();
                } catch (Throwable t) {
                    call.reject("banner failed: " + t.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void hideBanner(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (banner != null) banner.setVisibility(View.GONE);
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void resumeBanner(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (banner != null) { banner.setVisibility(View.VISIBLE); banner.bringToFront(); }
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void removeBanner(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.resolve(); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    if (banner != null) {
                        ViewGroup p = (ViewGroup) banner.getParent();
                        if (p != null) p.removeView(banner);
                        banner = null;
                    }
                } catch (Throwable t) { }
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void prepareInterstitial(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no activity"); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    final StartAppAd ad = new StartAppAd(a);
                    interstitial = ad;
                    interstitialReady = false;
                    ad.loadAd(new AdEventListener() {
                        @Override public void onReceiveAd(Ad x) {
                            if (interstitial == ad) interstitialReady = true;
                            call.resolve();
                        }
                        @Override public void onFailedToReceiveAd(Ad x) {
                            if (interstitial == ad) { interstitial = null; interstitialReady = false; }
                            call.reject("no ad available");
                        }
                    });
                } catch (Throwable t) {
                    call.reject("interstitial load failed: " + t.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void showInterstitial(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no activity"); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    final StartAppAd ad = interstitial;
                    if (ad == null || !interstitialReady) { call.reject("interstitial not ready"); return; }
                    interstitial = null;
                    interstitialReady = false;
                    ad.showAd();
                    call.resolve();
                } catch (Throwable t) {
                    call.reject("interstitial show failed: " + t.getMessage());
                }
            }
        });
    }
}
''' % pkg
open(os.path.join(os.path.dirname(path), 'StartIoPlugin.java'), 'w').write(PLUGIN)
print('icons, permissions, Start.io plugin and MainActivity applied (package %s)' % pkg)
