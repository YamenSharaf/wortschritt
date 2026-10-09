package eu.yamen.wortschritt;

import android.graphics.Color;
import android.os.Build;
import android.provider.Settings;
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

    /** A Boox's front light and refresh (null elsewhere, and the class is never loaded). */
    private Boox boox;

    private Boox boox() {
        if (boox == null && Boox.isBoox()) boox = new Boox(getContext());
        return boox;
    }

    /**
     * The reader's light: a Boox's front light (brightness, and warmth where the
     * light has it), or on a phone the window's own brightness (null = the
     * system's). Warmth on a phone is a tint the web app draws.
     */
    @PluginMethod
    public void getLight(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            try {
                Boox b = boox();
                if (b != null) {
                    result.put("kind", b.kind());
                    result.put("brightness", b.getBrightness());
                    result.put("warmth", b.getWarmth());
                } else {
                    float own = getActivity().getWindow().getAttributes().screenBrightness;
                    result.put("kind", "screen");
                    result.put("brightness", own >= 0 ? (double) own : systemBrightness());
                    result.put("warmth", null);
                }
                call.resolve(result);
            } catch (Throwable e) {
                call.reject("No light control on this device", e instanceof Exception ? (Exception) e : null);
            }
        });
    }

    private double systemBrightness() {
        try {
            int v = Settings.System.getInt(getContext().getContentResolver(), Settings.System.SCREEN_BRIGHTNESS);
            return Math.max(0, Math.min(1, v / 255.0));
        } catch (Settings.SettingNotFoundException e) {
            return 0.5;
        }
    }

    /** brightness / warmth: 0..1; on a phone, brightness null hands it back to the system. */
    @PluginMethod
    public void setLight(PluginCall call) {
        Double brightness = call.getData().has("brightness") && !call.getData().isNull("brightness")
            ? call.getDouble("brightness")
            : null;
        Double warmth = call.getData().has("warmth") && !call.getData().isNull("warmth") ? call.getDouble("warmth") : null;
        boolean resetBrightness = call.getData().has("brightness") && call.getData().isNull("brightness");
        getActivity().runOnUiThread(() -> {
            try {
                Boox b = boox();
                if (b != null) {
                    b.set(brightness, warmth);
                } else if (brightness != null || resetBrightness) {
                    WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                    lp.screenBrightness = resetBrightness
                        ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                        : (float) Math.max(0.01, Math.min(1, brightness));
                    getActivity().getWindow().setAttributes(lp);
                }
                call.resolve();
            } catch (Throwable e) {
                call.reject("Couldn't change the light", e instanceof Exception ? (Exception) e : null);
            }
        });
    }

    /** A Boox's full e-ink refresh; resolves false elsewhere (the web app flashes instead). */
    @PluginMethod
    public void fullRefresh(PluginCall call) {
        if (!Boox.isBoox()) {
            JSObject result = new JSObject();
            result.put("done", false);
            call.resolve(result);
            return;
        }
        new Thread(() -> {
            JSObject result = new JSObject();
            try {
                Boox.fullRefresh();
                result.put("done", true);
            } catch (Throwable e) {
                result.put("done", false);
            }
            call.resolve(result);
        }).start();
    }

    /** Who made the device: a Boox says ONYX, and starts in e-ink mode. */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("model", Build.MODEL);
        call.resolve(result);
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
