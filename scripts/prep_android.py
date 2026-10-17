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
print('icons, permissions and MainActivity applied (package %s)' % pkg)
