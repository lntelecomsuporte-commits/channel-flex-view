package tv.lntelecom.net;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.CookieSyncManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.content.pm.PackageInfo;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.util.ArrayList;

public class LegacyMainActivity extends Activity {
    private WebView webView;
    private Long currentDownloadId = null;
    private BroadcastReceiver downloadReceiver = null;
    private SpeechRecognizer voiceRecognizer = null;
    private static final int REQ_AUDIO = 7331;

    /** Bridge JS exposto como window.LntvLegacy — usado pelo auto-update do APK no legacy. */
    private class LegacyUpdateBridge {
        @JavascriptInterface
        public int getVersionCode() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return pi.versionCode;
            } catch (Exception e) {
                return -1;
            }
        }

        @JavascriptInterface
        public String getVersionName() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return pi.versionName != null ? pi.versionName : "";
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void downloadApk(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    startApkDownload(url);
                }
            });
        }

        /** Voz: comando "desligar" fecha o app. */
        @JavascriptInterface
        public void shutdown() {
            runOnUiThread(() -> {
                try { if (webView != null) webView.destroy(); } catch (Exception ignored) {}
                finishAndRemoveTask();
                new Handler(Looper.getMainLooper()).postDelayed(() -> System.exit(0), 150);
            });
        }

        /** Inicia o SpeechRecognizer nativo (compat Android 5+). */
        @JavascriptInterface
        public void startVoice() {
            runOnUiThread(() -> startVoiceRecognition());
        }

        @JavascriptInterface
        public boolean voiceAvailable() {
            try { return SpeechRecognizer.isRecognitionAvailable(LegacyMainActivity.this); }
            catch (Exception e) { return false; }
        }
    }

    private void startApkDownload(String url) {
        try {
            Toast.makeText(this, "Baixando atualização...", Toast.LENGTH_LONG).show();

            // Apaga qualquer APK anterior pra não dar erro de "file already exists"
            File outFile = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "lntv-update.apk");
            if (outFile.exists()) outFile.delete();

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("LN TV — Atualização");
            req.setDescription("Baixando nova versão");
            req.setMimeType("application/vnd.android.package-archive");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationUri(Uri.fromFile(outFile));
            req.setAllowedOverRoaming(true);
            req.setAllowedOverMetered(true);

            currentDownloadId = dm.enqueue(req);

            if (downloadReceiver != null) {
                try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
            }
            downloadReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (currentDownloadId == null || id != currentDownloadId) return;
                    handleDownloadComplete(id);
                }
            };
            registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        } catch (Exception e) {
            Toast.makeText(this, "Falha ao baixar: " + e.getMessage(), Toast.LENGTH_LONG).show();
            // Fallback: abre no navegador
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) {}
        }
    }

    private void handleDownloadComplete(long id) {
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Query q = new DownloadManager.Query();
        q.setFilterById(id);
        Cursor c = null;
        try {
            c = dm.query(q);
            if (c == null || !c.moveToFirst()) return;
            int status = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reason = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_REASON));
                Toast.makeText(this, "Download falhou (cod " + reason + ")", Toast.LENGTH_LONG).show();
                return;
            }
            String localUri = c.getString(c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI));
            if (localUri == null) return;
            File apk = new File(Uri.parse(localUri).getPath());
            if (!apk.exists()) {
                Toast.makeText(this, "APK não encontrado após download", Toast.LENGTH_LONG).show();
                return;
            }
            launchInstaller(apk);
        } catch (Exception e) {
            Toast.makeText(this, "Erro: " + e.getMessage(), Toast.LENGTH_LONG).show();
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }
    }

    private void launchInstaller(File apk) {
        try {
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Uri uri = FileProvider.getUriForFile(
                    this,
                    getPackageName() + ".fileprovider",
                    apk
                );
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                install.setDataAndType(Uri.fromFile(apk), "application/vnd.android.package-archive");
            }
            startActivity(install);
        } catch (Exception e) {
            Toast.makeText(this, "Não foi possível abrir o instalador: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Cookies persistentes (necessário em Android antigo)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            CookieSyncManager.createInstance(this);
        }
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // Cache do WebView habilitado pra reduzir reloads agressivos
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Bridge JS pro auto-update do APK no legacy.
        webView.addJavascriptInterface(new LegacyUpdateBridge(), "LntvLegacy");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                } catch (Exception ignored) {
                    return true;
                }
            }
        });

        setContentView(webView);
        webView.loadUrl("https://tv2.lntelecom.net/");
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Flush dos cookies/localStorage antes de o sistema poder matar o processo.
        // Sem isso, em Android 5/6, a sessão do Supabase salva no localStorage
        // pode não ser persistida em disco e o usuário aparece deslogado ao reabrir.
        try {
            CookieManager cm = CookieManager.getInstance();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                cm.flush();
            } else {
                CookieSyncManager.getInstance().sync();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU
                || keyCode == 172 /* KEYCODE_GUIDE */
                || keyCode == KeyEvent.KEYCODE_TV_CONTENTS_MENU
                || keyCode == KeyEvent.KEYCODE_TV_MEDIA_CONTEXT_MENU) {
            try {
                if (webView != null) {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('remotemenu'));",
                        null
                    );
                    return true;
                }
            } catch (Exception ignored) {}
        }
        // Legenda (CC / azul) e Áudio (SAP / amarelo): repassa via KeyboardEvent.
        // No legacy quem aplica é o <video>/hls.js (sem ExoPlayer aqui).
        if (keyCode == 175 /* KEYCODE_CAPTIONS */
                || keyCode == KeyEvent.KEYCODE_PROG_BLUE /* 186 */) {
            dispatchTrackKey("Subtitle", keyCode);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK /* 222 */
                || keyCode == 252 /* KEYCODE_TV_AUDIO_DESCRIPTION */
                || keyCode == KeyEvent.KEYCODE_PROG_YELLOW /* 185 */) {
            dispatchTrackKey("AudioTrack", keyCode);
            return true;
        }
        // Tecla de voz
        if (keyCode == 231 /* KEYCODE_VOICE_ASSIST */
                || keyCode == 219 /* KEYCODE_ASSIST */
                || keyCode == KeyEvent.KEYCODE_SEARCH) {
            startVoiceRecognition();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void dispatchTrackKey(String keyName, int keyCode) {
        try {
            if (webView == null) return;
            String js = "window.dispatchEvent(new KeyboardEvent('keydown', {"
                    + "key:'" + keyName + "', code:'" + keyName + "', keyCode:" + keyCode
                    + ", which:" + keyCode + ", bubbles:true}));";
            webView.evaluateJavascript(js, null);
        } catch (Exception ignored) {}
    }

    // ====== Reconhecimento de voz (pt-BR) ======
    private void startVoiceRecognition() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            emitVoiceUi("error", "Permita o microfone e tente de novo");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            emitVoiceUi("error", "Reconhecimento de voz indisponível");
            return;
        }
        destroyVoiceRecognizer();
        try {
            voiceRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
            voiceRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { emitVoiceUi("listening", ""); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onError(int error) {
                    String msg;
                    switch (error) {
                        case SpeechRecognizer.ERROR_NO_MATCH:
                        case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: msg = "Não entendi"; break;
                        case SpeechRecognizer.ERROR_NETWORK:
                        case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: msg = "Sem internet"; break;
                        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: msg = "Sem permissão de microfone"; break;
                        default: msg = "Erro de voz (" + error + ")";
                    }
                    emitVoiceUi("error", msg);
                }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> arr = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = (arr != null && !arr.isEmpty()) ? arr.get(0) : "";
                    if (!text.isEmpty()) emitVoiceTranscript(text);
                    else emitVoiceUi("error", "Não entendi");
                }
                @Override public void onPartialResults(Bundle partial) {
                    ArrayList<String> arr = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (arr != null && !arr.isEmpty()) emitVoiceUi("partial", arr.get(0));
                }
                @Override public void onEvent(int eventType, Bundle params) {}
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            voiceRecognizer.startListening(intent);
        } catch (Exception e) {
            emitVoiceUi("error", "Falha ao iniciar voz");
        }
    }

    private void destroyVoiceRecognizer() {
        if (voiceRecognizer != null) {
            try { voiceRecognizer.stopListening(); } catch (Exception ignored) {}
            try { voiceRecognizer.cancel(); } catch (Exception ignored) {}
            try { voiceRecognizer.destroy(); } catch (Exception ignored) {}
            voiceRecognizer = null;
        }
    }

    private String jsEscape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", " ");
    }

    private void emitVoiceUi(String kind, String text) {
        if (webView == null) return;
        final String k = jsEscape(kind);
        final String t = jsEscape(text);
        final String js;
        if ("partial".equals(kind)) {
            js = "window.dispatchEvent(new CustomEvent('lntv:voice-ui',{detail:{kind:'listening',partial:'" + t + "'}}));";
        } else if ("listening".equals(kind)) {
            js = "window.dispatchEvent(new CustomEvent('lntv:voice-ui',{detail:{kind:'listening'}}));";
        } else if ("error".equals(kind)) {
            js = "window.dispatchEvent(new CustomEvent('lntv:voice-ui',{detail:{kind:'error',message:'" + t + "'}}));"
               + "setTimeout(function(){window.dispatchEvent(new CustomEvent('lntv:voice-ui',{detail:{kind:'idle'}}));},2000);";
        } else {
            js = "window.dispatchEvent(new CustomEvent('lntv:voice-ui',{detail:{kind:'" + k + "'}}));";
        }
        try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
    }

    private void emitVoiceTranscript(String text) {
        if (webView == null) return;
        final String t = jsEscape(text);
        final String js = "window.dispatchEvent(new CustomEvent('lntv:voice-transcript',{detail:{text:'" + t + "'}}));";
        try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // Em vez de finalizar a Activity (que destrói o WebView e pode perder
        // sessão), move a task pro background. Assim, ao reabrir o app, o
        // WebView mantém o estado e o usuário permanece logado.
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        destroyVoiceRecognizer();
        if (downloadReceiver != null) {
            try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
            downloadReceiver = null;
        }
        if (webView != null) {
            // Garante flush antes de destruir
            try {
                CookieManager cm = CookieManager.getInstance();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    cm.flush();
                }
            } catch (Exception ignored) {}
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
