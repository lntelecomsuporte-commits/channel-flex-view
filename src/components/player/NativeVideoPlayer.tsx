import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { LntvPlayer } from "@/lib/native/lntvPlayer";
import { getPlayableStreamUrl, resolveChannelStreamUrl } from "@/lib/stream";
import { extractYouTubeVideoId } from "@/lib/youtube";
import YouTubePlayer from "./YouTubePlayer";
import type { VideoPlayerHandle } from "./VideoPlayer";

interface NativeVideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
  channelId?: string | null;
  useProxyToken?: boolean;
  forceProxyNative?: boolean;
  backupStreamUrls?: string[] | null;
}

/**
 * Player Android nativo (ExoPlayer/media3 via LntvPlayerPlugin). Latência de
 * troca de canal ~80-150ms (vs ~1s do hls.js no WebView). Renderiza só um
 * placeholder <div>; a SurfaceView nativa é posicionada por cima via setRect.
 *
 * Fallback: se o plugin der erro fatal e houver backups, avança; se esgotar,
 * mostra mensagem (componente pai pode trocar pra <VideoPlayer> hls.js).
 */
const NativeVideoPlayer = forwardRef<VideoPlayerHandle, NativeVideoPlayerProps>(({
  streamUrl,
  autoPlay = true,
  channelId = null,
  useProxyToken = false,
  forceProxyNative = false,
  backupStreamUrls = null,
}, ref) => {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  const [backupIndex, setBackupIndex] = useState(-1);

  const backups = backupStreamUrls?.filter((u) => !!u && u.trim().length > 0) ?? [];
  const activeStreamUrl = backupIndex < 0 ? streamUrl : (backups[backupIndex] ?? streamUrl);
  const youTubeVideoId = extractYouTubeVideoId(activeStreamUrl);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => null,
    getHls: () => null,
  }), []);

  // Reset backup quando muda canal
  useEffect(() => {
    setBackupIndex(-1);
  }, [streamUrl]);

  // Listeners do plugin
  useEffect(() => {
    if (youTubeVideoId) return;
    let mounted = true;
    const handles: Array<{ remove: () => void }> = [];

    LntvPlayer.addListener("playing", () => mounted && setFirstFrame(true)).then((h) => handles.push(h));
    LntvPlayer.addListener("firstFrame", () => mounted && setFirstFrame(true)).then((h) => handles.push(h));
    LntvPlayer.addListener("error", (e) => {
      console.warn("[NativePlayer] erro:", e);
      if (!mounted) return;
      const next = backupIndex + 1;
      if (next < backups.length) {
        console.warn(`[NativePlayer] tentando backup #${next + 1}/${backups.length}`);
        setBackupIndex(next);
      }
    }).then((h) => handles.push(h));

    return () => {
      mounted = false;
      handles.forEach((h) => h.remove());
    };
  }, [backupIndex, backups.length, youTubeVideoId]);

  // Carrega URL ativa
  useEffect(() => {
    if (youTubeVideoId) return;
    let cancelled = false;
    setFirstFrame(false);
    (async () => {
      let url: string;
      try {
        if ((useProxyToken || forceProxyNative) && channelId) {
          url = await resolveChannelStreamUrl(activeStreamUrl, channelId, useProxyToken, forceProxyNative);
        } else {
          url = getPlayableStreamUrl(activeStreamUrl);
        }
      } catch {
        url = getPlayableStreamUrl(activeStreamUrl);
      }
      if (cancelled || !url) return;
      try {
        await LntvPlayer.load({ url });
        if (!autoPlay) await LntvPlayer.pause();
      } catch (e) {
        console.warn("[NativePlayer] load falhou:", e);
        if (!cancelled) {
          const next = backupIndex + 1;
          if (next < backups.length) setBackupIndex(next);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeStreamUrl, channelId, useProxyToken, forceProxyNative, autoPlay, youTubeVideoId, backupIndex, backups.length]);

  // Posiciona a SurfaceView via ResizeObserver
  useEffect(() => {
    if (youTubeVideoId) return;
    const el = placeholderRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      LntvPlayer.setRect({
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }).catch(() => {});
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [youTubeVideoId]);

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      LntvPlayer.release().catch(() => {});
    };
  }, []);

  // Unmute na 1ª interação
  useEffect(() => {
    const unmute = () => {
      LntvPlayer.setMuted({ muted: false }).catch(() => {});
      window.removeEventListener("click", unmute);
      window.removeEventListener("keydown", unmute);
      window.removeEventListener("touchstart", unmute);
    };
    window.addEventListener("click", unmute);
    window.addEventListener("keydown", unmute);
    window.addEventListener("touchstart", unmute);
    return () => {
      window.removeEventListener("click", unmute);
      window.removeEventListener("keydown", unmute);
      window.removeEventListener("touchstart", unmute);
    };
  }, []);

  if (youTubeVideoId) {
    return <YouTubePlayer videoId={youTubeVideoId} autoPlay={autoPlay} />;
  }

  return (
    <>
      <div
        ref={placeholderRef}
        className="absolute inset-0 w-full h-full"
        style={{ backgroundColor: "#000" }}
        aria-label="Native video surface placeholder"
      />
      {!firstFrame && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}
    </>
  );
});

NativeVideoPlayer.displayName = "NativeVideoPlayer";

export default NativeVideoPlayer;
