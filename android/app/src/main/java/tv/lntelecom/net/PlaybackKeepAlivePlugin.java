package tv.lntelecom.net;

import android.content.Intent;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin Capacitor pra controlar o PlaybackKeepAliveService a partir do JS.
 *
 * Uso (TS):
 *   import { registerPlugin } from "@capacitor/core";
 *   const KeepAlive = registerPlugin<{
 *     start: () => Promise<void>;
 *     stop: () => Promise<void>;
 *   }>("PlaybackKeepAlive");
 *   await KeepAlive.start();
 */
@CapacitorPlugin(name = "PlaybackKeepAlive")
public class PlaybackKeepAlivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Intent svc = new Intent(getContext(), PlaybackKeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(svc);
            } else {
                getContext().startService(svc);
            }
            // Mantém a tela acesa enquanto a Activity estiver em foreground
            getActivity().runOnUiThread(() -> {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to start keep-alive: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent svc = new Intent(getContext(), PlaybackKeepAliveService.class);
            getContext().stopService(svc);
            getActivity().runOnUiThread(() -> {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to stop keep-alive: " + e.getMessage(), e);
        }
    }
}
