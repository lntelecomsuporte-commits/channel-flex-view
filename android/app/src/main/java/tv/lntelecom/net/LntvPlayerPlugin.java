package tv.lntelecom.net;

import android.graphics.Color;
import android.net.Uri;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.LoadControl;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin nativo Android: substitui o <video>+hls.js do WebView por ExoPlayer
 * (media3) numa TextureView posicionada atrás do WebView. Latência de troca
 * de canal cai de ~1s pra ~80-150ms (paridade com OleTV/Aptoide).
 *
 * O React mantém controle de UI (OSD, lista, EPG) — o plugin só toca vídeo
 * e reporta eventos (playing, waiting, error, firstFrame) via notifyListeners.
 *
 * Métodos:
 *   load({url, headers?})  — carrega e toca
 *   play() / pause() / release()
 *   setMuted({muted})
 *   setVolume({volume})    — 0.0 a 1.0
 *   setRect({x,y,w,h})     — posição em px CSS (multiplicada por dpr)
 *   prepareNext({url})     — pré-carrega próximo canal (1-2s buffered)
 *   swapToNext()           — troca instantânea pro slot prepared
 */
@UnstableApi
@CapacitorPlugin(name = "LntvPlayer")
public class LntvPlayerPlugin extends Plugin {

    private ExoPlayer player;
    private ExoPlayer nextPlayer;
    private TextureView textureView;
    private FrameLayout container;
    private float dpr = 1f;

    @Override
    public void load() {
        super.load();
        dpr = getContext().getResources().getDisplayMetrics().density;
    }

    private void ensureViews() {
        if (container != null) return;
        container = new FrameLayout(getActivity());
        container.setBackgroundColor(Color.TRANSPARENT);
        ViewGroup.LayoutParams lp = new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        // FireTV/WebView: SurfaceView pode tocar só áudio e ficar preto por
        // composição de camadas. TextureView participa da hierarquia normal,
        // fica atrás do WebView transparente e deixa OSD/listas visíveis.
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        ViewGroup parent = webView != null && webView.getParent() instanceof ViewGroup
            ? (ViewGroup) webView.getParent()
            : null;
        if (parent != null) {
            parent.setBackgroundColor(Color.TRANSPARENT);
            // Insere o container ANTES do WebView (z-order: vídeo embaixo)
            parent.addView(container, 0, lp);
            webView.setBackgroundColor(Color.TRANSPARENT);
            // HARDWARE layer é necessário pra alpha/transparência funcionar
            // de verdade no WebView. SOFTWARE deixa branco em alguns devices.
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        } else {
            ViewGroup root = (ViewGroup) getActivity().getWindow().getDecorView();
            root.setBackgroundColor(Color.TRANSPARENT);
            root.addView(container, 0, lp);
        }

        textureView = new TextureView(getActivity());
        textureView.setOpaque(true);
        textureView.setBackgroundColor(Color.BLACK);
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        container.addView(textureView, sp);
        container.setVisibility(View.GONE);
    }

    private LoadControl buildLoadControl() {
        // Buffer agressivo igual OleTV: começa a tocar no 1º frame decodificado.
        return new DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                /* minBufferMs */ 4000,
                /* maxBufferMs */ 60000,
                /* bufferForPlaybackMs */ 0,
                /* bufferForPlaybackAfterRebufferMs */ 0
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
    }

    private ExoPlayer createPlayer() {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent("LNTV/1.0 (Android; ExoPlayer)")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(8000)
            .setReadTimeoutMs(8000);
        DefaultMediaSourceFactory msf = new DefaultMediaSourceFactory(getContext())
            .setDataSourceFactory(http);
        return new ExoPlayer.Builder(getContext())
            .setMediaSourceFactory(msf)
            .setLoadControl(buildLoadControl())
            .build();
    }

    private MediaSource buildSource(String url) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent("LNTV/1.0 (Android; ExoPlayer)")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(8000)
            .setReadTimeoutMs(8000);
        MediaItem item = MediaItem.fromUri(Uri.parse(url));
        String lower = url.toLowerCase();
        if (lower.contains(".m3u8") || lower.contains("/hls-proxy")) {
            return new HlsMediaSource.Factory(http).createMediaSource(item);
        }
        return new ProgressiveMediaSource.Factory(http).createMediaSource(item);
    }

    private void attachListener(ExoPlayer p, boolean primary) {
        p.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (!primary) return;
                JSObject e = new JSObject();
                if (state == Player.STATE_READY) {
                    notifyListeners("firstFrame", new JSObject());
                    notifyListeners("playing", e);
                } else if (state == Player.STATE_BUFFERING) {
                    notifyListeners("waiting", e);
                } else if (state == Player.STATE_ENDED) {
                    notifyListeners("ended", e);
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (!primary) return;
                JSObject e = new JSObject();
                e.put("code", error.errorCode);
                e.put("message", error.getMessage());
                notifyListeners("error", e);
            }
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) {
            call.reject("missing url");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ensureViews();
                if (player != null) {
                    player.release();
                    player = null;
                }
                player = createPlayer();
                attachListener(player, true);
                player.setVideoTextureView(textureView);
                player.setMediaSource(buildSource(url));
                player.prepare();
                player.setPlayWhenReady(true);
                container.setVisibility(View.VISIBLE);
                call.resolve();
            } catch (Exception e) {
                call.reject("load failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void prepareNext(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) {
            call.reject("missing url");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                if (nextPlayer != null) {
                    nextPlayer.release();
                    nextPlayer = null;
                }
                nextPlayer = createPlayer();
                nextPlayer.setMediaSource(buildSource(url));
                nextPlayer.prepare();
                nextPlayer.setPlayWhenReady(false);
                call.resolve();
            } catch (Exception e) {
                call.reject("prepareNext failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void swapToNext(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (nextPlayer == null) {
                    call.reject("no prepared next");
                    return;
                }
                if (player != null) player.release();
                player = nextPlayer;
                nextPlayer = null;
                attachListener(player, true);
                player.setVideoTextureView(textureView);
                player.setPlayWhenReady(true);
                container.setVisibility(View.VISIBLE);
                call.resolve();
            } catch (Exception e) {
                call.reject("swap failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.setPlayWhenReady(true);
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.setPlayWhenReady(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void setMuted(PluginCall call) {
        final boolean muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        getActivity().runOnUiThread(() -> {
            if (player != null) player.setVolume(muted ? 0f : 1f);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        final Float v = call.getFloat("volume", 1f);
        getActivity().runOnUiThread(() -> {
            if (player != null) player.setVolume(v == null ? 1f : Math.max(0f, Math.min(1f, v)));
            call.resolve();
        });
    }

    @PluginMethod
    public void setRect(PluginCall call) {
        final Integer x = call.getInt("x", 0);
        final Integer y = call.getInt("y", 0);
        final Integer w = call.getInt("w", 0);
        final Integer h = call.getInt("h", 0);
        getActivity().runOnUiThread(() -> {
            ensureViews();
            if (container == null) { call.resolve(); return; }
            if (w == null || h == null || w <= 0 || h <= 0) {
                container.setVisibility(View.GONE);
                call.resolve();
                return;
            }
            ViewGroup.MarginLayoutParams lp;
            ViewGroup.LayoutParams current = container.getLayoutParams();
            if (current instanceof ViewGroup.MarginLayoutParams) {
                lp = (ViewGroup.MarginLayoutParams) current;
                lp.width = (int) (w * dpr);
                lp.height = (int) (h * dpr);
            } else {
                lp = new ViewGroup.MarginLayoutParams(
                    (int) (w * dpr), (int) (h * dpr)
                );
            }
            lp.leftMargin = (int) (x * dpr);
            lp.topMargin = (int) (y * dpr);
            container.setLayoutParams(lp);
            container.setVisibility(View.VISIBLE);
            call.resolve();
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) { player.release(); player = null; }
            if (nextPlayer != null) { nextPlayer.release(); nextPlayer = null; }
            if (container != null) container.setVisibility(View.GONE);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (player != null) { player.release(); player = null; }
        if (nextPlayer != null) { nextPlayer.release(); nextPlayer = null; }
        super.handleOnDestroy();
    }
}
