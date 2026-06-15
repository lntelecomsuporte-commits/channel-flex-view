package tv.lntelecom.net;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.view.WindowManager;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private BroadcastReceiver screenOffReceiver;
    private boolean shuttingDown = false;
    /** Quando true, suprime shutdownAndRelease (instalador do APK abrindo). */
    private static volatile boolean installingUpdate = false;
    private static volatile long installingUpdateUntil = 0L;

    public static boolean isInstallingUpdate() {
        if (!installingUpdate) return false;
        if (System.currentTimeMillis() > installingUpdateUntil) {
            installingUpdate = false;
            return false;
        }
        return true;
    }

    /** Bridge JS pra sinalizar que o instalador do APK vai abrir + shutdown via voz. */
    public class LntvNativeBridge {
        @JavascriptInterface
        public void setInstallingUpdate(boolean v) {
            installingUpdate = v;
            // Auto-expira em 2 min, pra não travar shutdown pra sempre
            installingUpdateUntil = System.currentTimeMillis() + 2 * 60 * 1000L;
            android.util.Log.i("LNTV", "setInstallingUpdate=" + v);
        }
        /** Chamado pelo comando de voz "desligar". Fecha o app e tenta standby. */
        @JavascriptInterface
        public void shutdown() {
            android.util.Log.i("LNTV", "shutdown via voz");
            runOnUiThread(() -> shutdownAndRelease("voice_command"));
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackKeepAlivePlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(DeviceInfoPlugin.class);
        super.onCreate(savedInstanceState);
        // Mantém a tela acesa enquanto a Activity estiver visível.
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

            // Bridge pra suprimir shutdown quando o instalador do APK abrir
            webView.addJavascriptInterface(new LntvNativeBridge(), "LntvNative");
        }

        // Detecta Power do controle (Android TV / Fire TV) — quando a tela
        // apaga / entra em stand-by, encerramos o app e liberamos RAM.
        // ACTION_SCREEN_OFF SÓ funciona com receiver dinâmico (não no manifest).
        screenOffReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                    shutdownAndRelease("screen_off");
                }
            }
        };
        registerReceiver(screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
    }

    /**
     * Disparado quando o usuário aperta Home (casinha) ou Recents.
     * NÃO é disparado por diálogos do sistema, ligações, etc — só ação
     * intencional do usuário pra sair do app. Encerramos e liberamos RAM.
     */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (isInstallingUpdate()) {
            android.util.Log.i("LNTV", "onUserLeaveHint ignorado: instalando update");
            return;
        }
        shutdownAndRelease("user_leave_hint");
    }

    @Override
    public void onDestroy() {
        if (screenOffReceiver != null) {
            try { unregisterReceiver(screenOffReceiver); } catch (Exception ignored) {}
            screenOffReceiver = null;
        }
        super.onDestroy();
    }

    /**
     * Para o foreground service de playback, remove a Activity da lista de
     * recentes e mata o processo pra liberar memória completamente.
     * Em TV boxes com 1GB de RAM isso é necessário — sem System.exit o
     * processo Java fica residente mesmo após finish().
     */
    private void shutdownAndRelease(String reason) {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
            android.util.Log.i("LNTV", "Shutting down (" + reason + ")");
            // Para o foreground service que mantém o processo vivo
            try {
                stopService(new Intent(this, PlaybackKeepAliveService.class));
            } catch (Exception ignored) {}
            // Remove da lista de apps recentes e encerra a Activity
            finishAndRemoveTask();
        } finally {
            // Mata o processo Java pra garantir liberação total de RAM.
            // Pequeno delay pra dar tempo do finishAndRemoveTask processar.
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                () -> System.exit(0),
                150
            );
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
        // Legenda (CC / azul) e Áudio (SAP / amarelo): dispara KeyboardEvent
        // no WebView pra que o handler do VideoPlayer/NativeAndroidPlayer reaja.
        // O NativePlayerPlugin é quem aplica a troca real no ExoPlayer.
        if (keyCode == 175 /* KEYCODE_CAPTIONS */
                || keyCode == KeyEvent.KEYCODE_PROG_BLUE /* 186 */) {
            dispatchTrackKey("subtitle", keyCode);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK /* 222 */
                || keyCode == 252 /* KEYCODE_TV_AUDIO_DESCRIPTION */
                || keyCode == KeyEvent.KEYCODE_PROG_YELLOW /* 185 */) {
            dispatchTrackKey("audio", keyCode);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void dispatchTrackKey(String kind, int keyCode) {
        try {
            WebView wv = (this.bridge != null) ? this.bridge.getWebView() : null;
            if (wv == null) return;
            // Dispara KeyboardEvent com keyCode + key name conhecidos pelo helper JS.
            String keyName = "subtitle".equals(kind) ? "Subtitle" : "AudioTrack";
            String js = "window.dispatchEvent(new KeyboardEvent('keydown', {"
                    + "key:'" + keyName + "', code:'" + keyName + "', keyCode:" + keyCode
                    + ", which:" + keyCode + ", bubbles:true}));";
            wv.evaluateJavascript(js, null);
        } catch (Exception ignored) {}
    }
}
