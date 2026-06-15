package tv.lntelecom.net;

import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import com.google.common.collect.ImmutableList;

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
 * Bridge JS: ver src/plugins/native-player.ts
 */
@UnstableApi
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    private ExoPlayer player;
    private PlayerView playerView;
    private FrameLayout decor;

    private DefaultBandwidthMeter bandwidthMeter;
    private long totalBytesTransferred = 0L;
    private long droppedFramesTotal = 0L;

    // === Stall watchdog & auto-retry ===
    // Guarda o último source carregado pra poder re-preparar quando o stream
    // travar silenciosamente (BUFFERING > 8s) ou der erro de rede.
    private MediaSource lastSource;
    private String lastUrl;
    private String lastType;
    private Map<String, String> lastHeaders;
    private final Handler stallHandler = new Handler(Looper.getMainLooper());
    private Runnable stallCheck;
    private int autoRetryCount = 0;
    private static final long STALL_TIMEOUT_MS = 8000L;
    private static final int MAX_AUTO_RETRIES = 6;

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

                // Zera contadores ao trocar de canal
                totalBytesTransferred = 0L;
                droppedFramesTotal = 0L;

                DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                        .setAllowCrossProtocolRedirects(true)
                        .setUserAgent(headers.getOrDefault("User-Agent", "LNTV/1.0"));
                if (!headers.isEmpty()) httpFactory.setDefaultRequestProperties(headers);

                MediaItem item = MediaItem.fromUri(url);
                LoadErrorHandlingPolicy retryPolicy = new DefaultLoadErrorHandlingPolicy() {
                    @Override
                    public int getMinimumLoadableRetryCount(int dataType) {
                        return Integer.MAX_VALUE;
                    }
                    @Override
                    public long getRetryDelayMsFor(LoadErrorHandlingPolicy.LoadErrorInfo info) {
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

                // Memoriza pra auto-retry em caso de stall/erro.
                lastSource = source;
                lastUrl = url;
                lastType = type;
                lastHeaders = new HashMap<>(headers);
                autoRetryCount = 0;
                cancelStallCheck();

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
            cancelStallCheck();
            lastSource = null;
            lastUrl = null;
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

    /**
     * Lê estatísticas atuais do ExoPlayer. Tudo aqui vem direto do player /
     * BandwidthMeter / AnalyticsListener — sem dados sintetizados do JS.
     */
    @PluginMethod
    public void getStats(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject out = new JSObject();
            try {
                if (player == null) {
                    call.resolve(out);
                    return;
                }
                Format f = player.getVideoFormat();
                if (f != null) {
                    if (f.width > 0) out.put("width", f.width);
                    if (f.height > 0) out.put("height", f.height);
                    if (f.frameRate > 0) out.put("frameRate", f.frameRate);
                    if (f.bitrate > 0) out.put("bitrate", f.bitrate);
                    if (f.codecs != null) out.put("codec", f.codecs);
                    if (f.sampleMimeType != null) out.put("mimeType", f.sampleMimeType);
                }
                out.put("bufferedMs", player.getTotalBufferedDuration());
                out.put("playbackState", player.getPlaybackState());
                if (bandwidthMeter != null) {
                    out.put("bandwidthEstimateBps", bandwidthMeter.getBitrateEstimate());
                }
                out.put("totalBytesTransferred", totalBytesTransferred);
                out.put("droppedFrames", droppedFramesTotal);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("getStats failed: " + e.getMessage(), e);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::releasePlayer);
        super.handleOnDestroy();
    }

    private void ensurePlayer() {
        if (player != null) return;

        bandwidthMeter = new DefaultBandwidthMeter.Builder(getContext()).build();
        // EventListener.onBandwidthSample(elapsedMs, bytesTransferred, bitrateEstimate)
        bandwidthMeter.addEventListener(new Handler(Looper.getMainLooper()),
                (elapsedMs, bytes, bitrate) -> totalBytesTransferred += bytes);

        player = new ExoPlayer.Builder(getContext())
                .setBandwidthMeter(bandwidthMeter)
                .build();

        decor = (FrameLayout) getActivity().findViewById(android.R.id.content);
        playerView = (PlayerView) LayoutInflater.from(getContext())
                .inflate(R.layout.exo_texture_player_view, decor, false);
        playerView.setPlayer(player);
        playerView.setUseController(false);
        playerView.setBackgroundColor(Color.BLACK);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        decor.addView(playerView, 0, lp);

        player.addAnalyticsListener(new AnalyticsListener() {
            @Override
            public void onDroppedVideoFrames(AnalyticsListener.EventTime eventTime, int droppedFrames, long elapsedMs) {
                droppedFramesTotal += droppedFrames;
            }
        });

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                JSObject data = new JSObject();
                data.put("state", state);
                if (state == Player.STATE_READY) {
                    autoRetryCount = 0;
                    cancelStallCheck();
                    notifyListeners("playing", data);
                } else if (state == Player.STATE_BUFFERING) {
                    scheduleStallCheck();
                    notifyListeners("buffering", data);
                } else if (state == Player.STATE_ENDED) {
                    cancelStallCheck();
                    // Live travou no fim — re-prepara em vez de parar.
                    attemptAutoRetry("ended");
                    notifyListeners("ended", data);
                } else if (state == Player.STATE_IDLE) {
                    cancelStallCheck();
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
                // Tenta re-preparar silenciosamente antes de notificar JS.
                // JS só recebe 'error' depois que o auto-retry esgotar.
                if (attemptAutoRetry("error:" + error.getErrorCodeName())) {
                    return;
                }
                notifyListeners("error", data);
            }
        });
    }

    /** Agenda verificação de stall — se continuar em BUFFERING após N ms, retry. */
    private void scheduleStallCheck() {
        cancelStallCheck();
        stallCheck = () -> {
            if (player == null) return;
            int s = player.getPlaybackState();
            if (s == Player.STATE_BUFFERING) {
                attemptAutoRetry("stall");
            }
        };
        stallHandler.postDelayed(stallCheck, STALL_TIMEOUT_MS);
    }

    private void cancelStallCheck() {
        if (stallCheck != null) {
            stallHandler.removeCallbacks(stallCheck);
            stallCheck = null;
        }
    }

    /**
     * Re-prepara o último source. Backoff exponencial até MAX_AUTO_RETRIES.
     * Retorna false se esgotou — caller deve propagar erro pro JS.
     */
    private boolean attemptAutoRetry(String reason) {
        if (player == null || lastSource == null) return false;
        if (autoRetryCount >= MAX_AUTO_RETRIES) {
            android.util.Log.w("NativePlayer", "auto-retry esgotado (" + reason + ")");
            return false;
        }
        autoRetryCount++;
        long delay = Math.min(1000L * (1L << Math.min(autoRetryCount - 1, 3)), 8000L);
        android.util.Log.w("NativePlayer", "auto-retry #" + autoRetryCount + " em " + delay + "ms (" + reason + ")");
        cancelStallCheck();
        stallHandler.postDelayed(() -> {
            if (player == null || lastSource == null) return;
            try {
                // Rebuild source (alguns ExoPlayer internals ficam em estado ruim
                // após erro — rebuildar é mais seguro do que reusar a instância).
                MediaSource fresh = rebuildLastSource();
                if (fresh != null) lastSource = fresh;
                player.setMediaSource(lastSource);
                player.prepare();
                player.setPlayWhenReady(true);
            } catch (Exception e) {
                android.util.Log.e("NativePlayer", "auto-retry falhou: " + e.getMessage());
            }
        }, delay);
        return true;
    }

    private MediaSource rebuildLastSource() {
        if (lastUrl == null) return null;
        try {
            DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                    .setAllowCrossProtocolRedirects(true)
                    .setUserAgent(lastHeaders != null ? lastHeaders.getOrDefault("User-Agent", "LNTV/1.0") : "LNTV/1.0");
            if (lastHeaders != null && !lastHeaders.isEmpty()) httpFactory.setDefaultRequestProperties(lastHeaders);
            MediaItem item = MediaItem.fromUri(lastUrl);
            LoadErrorHandlingPolicy retryPolicy = new DefaultLoadErrorHandlingPolicy() {
                @Override public int getMinimumLoadableRetryCount(int dataType) { return Integer.MAX_VALUE; }
                @Override public long getRetryDelayMsFor(LoadErrorHandlingPolicy.LoadErrorInfo info) {
                    long d = 1000L * (1L << Math.min(info.errorCount - 1, 3));
                    return Math.min(d, 8000L);
                }
            };
            if ("hls".equalsIgnoreCase(lastType)) {
                return new HlsMediaSource.Factory(httpFactory).setLoadErrorHandlingPolicy(retryPolicy).createMediaSource(item);
            }
            return new ProgressiveMediaSource.Factory(httpFactory).setLoadErrorHandlingPolicy(retryPolicy).createMediaSource(item);
        } catch (Exception e) {
            return null;
        }
    }

    private void releasePlayer() {
        cancelStallCheck();
        lastSource = null;
        lastUrl = null;
        lastHeaders = null;
        autoRetryCount = 0;
        if (player != null) {
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        if (playerView != null && decor != null) {
            try { decor.removeView(playerView); } catch (Exception ignored) {}
            playerView = null;
        }
        bandwidthMeter = null;
        totalBytesTransferred = 0L;
        droppedFramesTotal = 0L;
    }

    private void setWebViewTransparent(boolean transparent) {
        WebView wv = (bridge != null) ? bridge.getWebView() : null;
        if (wv != null) {
            wv.setBackgroundColor(transparent ? Color.TRANSPARENT : Color.BLACK);
        }
    }
}
