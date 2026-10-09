package eu.yamen.wortschritt;

import android.content.Context;
import android.os.Build;
import com.onyx.android.sdk.api.device.brightness.BaseBrightnessProvider;
import com.onyx.android.sdk.api.device.brightness.BrightnessController;
import com.onyx.android.sdk.api.device.epd.EpdController;
import com.onyx.android.sdk.api.device.epd.UpdateMode;
import com.onyx.android.sdk.device.BaseDevice;
import org.lsposed.hiddenapibypass.HiddenApiBypass;

/**
 * A Boox's front light and e-ink refresh, through the Onyx SDK (as in
 * github.com/onyx-intl/OnyxAndroidDemo). Only ever loaded on an ONYX device:
 * WortschrittPlugin checks the manufacturer before touching this class.
 *
 * Brightness and warmth are 0..1. With separate warm and cold LEDs, warmth sets
 * their balance (0 all cold, 0.5 both, 1 all warm) and brightness scales both.
 */
final class Boox {

    static boolean isBoox() {
        return "onyx".equalsIgnoreCase(Build.MANUFACTURER);
    }

    private final String type;
    private BaseBrightnessProvider brightness; // FL, or CTM brightness
    private BaseBrightnessProvider temperature; // CTM temperature
    private BaseBrightnessProvider warm; // WARM_AND_COLD
    private BaseBrightnessProvider cold;

    Boox(Context context) {
        // The SDK reaches into the system's e-ink and light services (hidden APIs).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HiddenApiBypass.addHiddenApiExemptions("");
        type = String.valueOf(BrightnessController.getBrightnessType(context));
        switch (type) {
            case "FL":
                brightness = BrightnessController.getBrightnessProvider(context, BaseDevice.LIGHT_TYPE_FL);
                break;
            case "CTM":
                brightness = BrightnessController.getBrightnessProvider(context, BaseDevice.LIGHT_TYPE_CTM_BRIGHTNESS);
                temperature = BrightnessController.getBrightnessProvider(context, BaseDevice.LIGHT_TYPE_CTM_TEMPERATURE);
                break;
            case "WARM_AND_COLD":
                warm = BrightnessController.getBrightnessProvider(context, BaseDevice.LIGHT_TYPE_CTM_WARM);
                cold = BrightnessController.getBrightnessProvider(context, BaseDevice.LIGHT_TYPE_CTM_COLD);
                break;
            default:
                break;
        }
    }

    /** "boox-fl", "boox-ctm", "boox-warm-cold" or "boox-none". */
    String kind() {
        switch (type) {
            case "FL":
                return "boox-fl";
            case "CTM":
                return "boox-ctm";
            case "WARM_AND_COLD":
                return "boox-warm-cold";
            default:
                return "boox-none";
        }
    }

    private static double read(BaseBrightnessProvider p) {
        int max = p.getMaxIndex();
        return max > 0 ? Math.max(0, Math.min(1, p.getIndex() / (double) max)) : 0;
    }

    private static void write(BaseBrightnessProvider p, double value) {
        int index = (int) Math.round(Math.max(0, Math.min(1, value)) * p.getMaxIndex());
        if (index > 0 && !p.isLightOn()) p.toggle();
        p.setIndex(index);
    }

    /** Null when the device has no front light. */
    Double getBrightness() {
        if (brightness != null) return read(brightness);
        if (warm != null) return Math.max(read(warm), read(cold));
        return null;
    }

    /** Null when the light has no colour temperature. */
    Double getWarmth() {
        if (temperature != null) return read(temperature);
        if (warm == null) return null;
        double w = read(warm), c = read(cold), b = Math.max(w, c);
        if (b == 0) return 0.5;
        return w >= c ? 1 - (c / b) / 2 : (w / b) / 2;
    }

    void set(Double newBrightness, Double newWarmth) {
        if (brightness != null) {
            if (newBrightness != null) write(brightness, newBrightness);
            if (newWarmth != null && temperature != null) write(temperature, newWarmth);
            return;
        }
        if (warm == null) return;
        Double cb = getBrightness(), cw = getWarmth();
        double b = newBrightness != null ? newBrightness : (cb != null ? cb : 0);
        double t = newWarmth != null ? newWarmth : (cw != null ? cw : 0.5);
        write(warm, b * Math.min(1, 2 * t));
        write(cold, b * Math.min(1, 2 * (1 - t)));
    }

    /** One full (GC) refresh of the screen, clearing ghosting. Blocks until done. */
    static void fullRefresh() {
        EpdController.repaintEveryThing(UpdateMode.GC);
    }
}
