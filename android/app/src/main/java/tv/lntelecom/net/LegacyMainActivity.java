package tv.lntelecom.net;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
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
import androidx.core.content.FileProvider;

import java.io.File;

public class LegacyMainActivity extends Activity {
    private WebView webView;
    private Long currentDownloadId = null;
    private BroadcastReceiver downloadReceiver = null;

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
        return super.onKeyDown(keyCode, event);
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
