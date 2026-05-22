package tv.lntelecom.net;

import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebSettings;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackKeepAlivePlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(DeviceInfoPlugin.class);
        super.onCreate(savedInstanceState);
        // Mantém a tela acesa enquanto a Activity estiver visível.
        // O foreground service cuida do CPU/processo em background.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);

        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView != null) {
            webView.setBackgroundColor(Color.BLACK);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setVerticalScrollBarEnabled(false);

            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
    }

    /**
     * Em Fire TV / Android TV o KEYCODE_MENU (82) e o KEYCODE_GUIDE (172)
     * normalmente são consumidos pela Activity e NUNCA chegam ao JS do
     * WebView. Interceptamos aqui e despachamos um CustomEvent("remotemenu")
     * pra que o React possa abrir o menu de configurações.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU
                || keyCode == 172 /* KEYCODE_GUIDE */
                || keyCode == KeyEvent.KEYCODE_INFO /* 165 */
                || keyCode == KeyEvent.KEYCODE_TV_CONTENTS_MENU
                || keyCode == KeyEvent.KEYCODE_TV_MEDIA_CONTEXT_MENU) {
            try {
                WebView wv = (this.bridge != null) ? this.bridge.getWebView() : null;
                if (wv != null) {
                    wv.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('remotemenu'));",
                        null
                    );
                    return true;
                }
            } catch (Exception ignored) {}
        }
        return super.onKeyDown(keyCode, event);
    }
}
