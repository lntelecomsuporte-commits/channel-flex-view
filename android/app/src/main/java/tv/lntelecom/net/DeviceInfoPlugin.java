package tv.lntelecom.net;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin nativo Android que expõe o ANDROID_ID (identificador estável do
 * dispositivo, sobrevive desinstalação/reinstalação do app, só muda em
 * factory reset).
 *
 * Bridge JS: src/plugins/device-info.ts
 */
@CapacitorPlugin(name = "DeviceInfo")
public class DeviceInfoPlugin extends Plugin {

    @PluginMethod
    public void getDeviceId(PluginCall call) {
        try {
            Context ctx = getContext();
            String androidId = Settings.Secure.getString(
                ctx.getContentResolver(), Settings.Secure.ANDROID_ID);

            JSObject ret = new JSObject();
            ret.put("deviceId", androidId != null ? androidId : "");
            ret.put("platform", "android");
            ret.put("model", Build.MODEL != null ? Build.MODEL : "");
            ret.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "");
            ret.put("osVersion", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("device id error: " + e.getMessage());
        }
    }
}
