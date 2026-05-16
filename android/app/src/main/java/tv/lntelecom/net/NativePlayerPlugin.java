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
                MediaSource source;
                if ("hls".equalsIgnoreCase(type)) {
                    source = new HlsMediaSource.Factory(httpFactory).createMediaSource(item);
                } else {
                    source = new ProgressiveMediaSource.Factory(httpFactory).createMediaSource(item);
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
                data.put("message", error.getMessage());
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
