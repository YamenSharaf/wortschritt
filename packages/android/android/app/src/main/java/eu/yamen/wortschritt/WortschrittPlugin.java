package eu.yamen.wortschritt;

import android.graphics.Color;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the web app needs from the phone beyond Capacitor's own plugins
 * (packages/web/src/lib/native/device.ts): keeping the screen on while reading,
 * and the volume keys as page keys, which Android otherwise keeps for the volume.
 */
@CapacitorPlugin(name = "Wortschritt")
public class WortschrittPlugin extends Plugin {

    /** Set while the reader is open with "Turn pages with the volume keys" on. */
    private volatile boolean pageKeys = false;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            // Hidden bars (the reader's full screen) come back briefly with a swipe from the edge.
            WindowCompat.getInsetsController(window, window.getDecorView())
                .setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            // Until the page paints, show the window's background (the app's colour, light or dark),
            // not a white WebView.
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
            // An app, not a web page: no pinch-zoom of the whole UI.
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
        });
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void setPageKeys(PluginCall call) {
        pageKeys = Boolean.TRUE.equals(call.getBoolean("on", false));
        call.resolve();
    }

    /** From MainActivity: true when the key was a page turn (and must not change the volume). */
    boolean handleKey(KeyEvent event) {
        int code = event.getKeyCode();
        if (!pageKeys || (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN)) {
            return false;
        }
        // One page per press; the release and auto-repeats are swallowed too.
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            JSObject data = new JSObject();
            data.put("key", code == KeyEvent.KEYCODE_VOLUME_UP ? "VolumeUp" : "VolumeDown");
            notifyListeners("pageKey", data);
        }
        return true;
    }
}
