package eu.yamen.wortschritt;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WortschrittPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Volume keys reach the reader as page keys when it asks for them (WortschrittPlugin). */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        PluginHandle handle = bridge == null ? null : bridge.getPlugin("Wortschritt");
        if (handle != null && ((WortschrittPlugin) handle.getInstance()).handleKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }
}
