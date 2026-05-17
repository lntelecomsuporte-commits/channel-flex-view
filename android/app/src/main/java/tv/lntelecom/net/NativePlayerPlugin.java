package tv.lntelecom.net;

import android.graphics.Color;
import android.view.SurfaceView;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Player nativo Android (ExoPlayer/Media3) exposto via Capacitor.
 *
 * Por que existe: o <video> dentro do WebView Chromium mostra um ícone/flash
 * de player entre zaps de canal em alguns receptores Android. Tocando o
 * stream nativamente com SurfaceView atrás do WebView (transparente) elimina
 * esse artefato e padroniza o comportamento com o Fire TV.
 *
 * Bridge JS: ver src/plugins/native-player.ts
 */
@UnstableApi
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    private ExoPlayer player;
    private PlayerView playerView;
    private FrameLayout decor;

    @PluginMethod
    public void load(PluginCall call) {
        final String url = call.getString("url");
        final String type = call.getString("type", "hls");
        final JSObject headersObj = call.getObject("headers", new JSObject());
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }

        final Map<String, String> headers = new HashMap<>();
        Iterator<String> keys = headersObj.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            String v = headersObj.optString(k);
            if (v != null && !v.isEmpty()) headers.put(k, v);
        }

        getActivity().runOnUiThread(() -> {
            try {
                ensurePlayer();

                DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                        .setAllowCrossProtocolRedirects(true)
                        .setUserAgent(headers.getOrDefault("User-Agent", "LNTV/1.0"));
                if (!headers.isEmpty()) httpFactory.setDefaultRequestProperties(headers);

                MediaItem item = MediaItem.fromUri(url);
                // Política de retry agressiva: tenta praticamente "infinito" em
                // erros de rede (queda de internet/DNS/timeout) com backoff até
                // 8s. Sem isso, o ExoPlayer desiste em ~3 tentativas e para preto.
                LoadErrorHandlingPolicy retryPolicy = new DefaultLoadErrorHandlingPolicy() {
                    @Override
                    public int getMinimumLoadableRetryCount(int dataType) {
                        return Integer.MAX_VALUE;
                    }
                    @Override
                    public long getRetryDelayMsFor(LoadErrorHandlingPolicy.LoadErrorInfo info) {
                        // backoff: 1s, 2s, 4s, 8s (cap)
                        long delay = 1000L * (1L << Math.min(info.errorCount - 1, 3));
                        return Math.min(delay, 8000L);
                    }
                };
                MediaSource source;
                if ("hls".equalsIgnoreCase(type)) {
                    source = new HlsMediaSource.Factory(httpFactory)
                            .setLoadErrorHandlingPolicy(retryPolicy)
                            .createMediaSource(item);
                } else {
                    source = new ProgressiveMediaSource.Factory(httpFactory)
                            .setLoadErrorHandlingPolicy(retryPolicy)
                            .createMediaSource(item);
                }

                player.setMediaSource(source);
                player.prepare();
                player.setPlayWhenReady(true);

                setWebViewTransparent(true);
                call.resolve();
            } catch (Exception e) {
                call.reject("load failed: " + e.getMessage(), e);
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
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
            setWebViewTransparent(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            releasePlayer();
            setWebViewTransparent(false);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::releasePlayer);
        super.handleOnDestroy();
    }

    private void ensurePlayer() {
        if (player != null) return;
        player = new ExoPlayer.Builder(getContext()).build();

        decor = (FrameLayout) getActivity().findViewById(android.R.id.content);
        playerView = new PlayerView(getContext());
        playerView.setPlayer(player);
        playerView.setUseController(false);
        playerView.setBackgroundColor(Color.BLACK);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        // index 0 = abaixo do WebView (que precisa ficar transparente)
        decor.addView(playerView, 0, lp);

        // SurfaceView precisa estar em modo "media overlay" pra renderizar
        // ACIMA do background da janela mas ABAIXO do WebView (que fica
        // transparente). Sem isso, em muitos devices Android só vem áudio.
        View videoSurface = playerView.getVideoSurfaceView();
        if (videoSurface instanceof SurfaceView) {
            ((SurfaceView) videoSurface).setZOrderMediaOverlay(true);
        }

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                JSObject data = new JSObject();
                data.put("state", state);
                if (state == Player.STATE_READY) {
                    notifyListeners("playing", data);
                } else if (state == Player.STATE_BUFFERING) {
                    notifyListeners("buffering", data);
                } else if (state == Player.STATE_ENDED) {
                    notifyListeners("ended", data);
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject data = new JSObject();
                data.put("code", error.errorCode);
                data.put("codeName", error.getErrorCodeName());
                data.put("message", error.getMessage());
                Throwable cause = error.getCause();
                if (cause != null) {
                    data.put("cause", cause.getClass().getSimpleName() + ": " + cause.getMessage());
                }
                notifyListeners("error", data);
            }
        });
    }

    private void releasePlayer() {
        if (player != null) {
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (playerView != null && decor != null) {
            try { decor.removeView(playerView); } catch (Exception ignored) {}
            playerView = null;
        }
    }

    private void setWebViewTransparent(boolean transparent) {
        WebView wv = (bridge != null) ? bridge.getWebView() : null;
        if (wv != null) {
            wv.setBackgroundColor(transparent ? Color.TRANSPARENT : Color.BLACK);
        }
    }
}
