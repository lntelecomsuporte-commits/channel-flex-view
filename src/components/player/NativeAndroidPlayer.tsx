import { useEffect, useState, forwardRef, useImperativeHandle } from "react";
import {
  getPlayableStreamUrl,
  resolveChannelStreamUrl,
  buildProxyStreamUrl,
  isProxiedStreamUrl,
} from "@/lib/stream";
import { NativePlayer, type NativeStreamType } from "@/plugins/native-player";
import type { VideoPlayerHandle } from "./VideoPlayer";

interface Props {
  streamUrl: string;
  autoPlay?: boolean;
  channelId?: string | null;
  useProxyToken?: boolean;
  forceProxyNative?: boolean;
  backupStreamUrls?: string[] | null;
}

const detectType = (url: string): NativeStreamType => {
  const u = url.toLowerCase();
  if (/\.m3u8(\?|$)/.test(u)) return "hls";
  return "mp4";
};

/**
 * Player nativo Android (ExoPlayer/Media3) via Capacitor.
 * Substitui o <video> do WebView para eliminar o ícone/flash entre zaps.
 *
 * O SurfaceView do ExoPlayer fica ATRÁS do WebView (que o plugin torna
 * transparente em load() e devolve a preto em stop()/destroy()).
 * Toda a UI (controles, EPG, OSD) continua sendo HTML por cima.
 */
const NativeAndroidPlayer = forwardRef<VideoPlayerHandle, Props>(
  ({ streamUrl, autoPlay = true, channelId = null, useProxyToken = false, forceProxyNative = false, backupStreamUrls = null }, ref) => {
    const [backupIndex, setBackupIndex] = useState(-1);
    const backups = backupStreamUrls?.filter((u) => !!u && u.trim().length > 0) ?? [];
    const activeStreamUrl = backupIndex < 0 ? streamUrl : (backups[backupIndex] ?? streamUrl);
    const [firstFrameReady, setFirstFrameReady] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);

    // Native player não expõe o <video> — handle retorna null.
    useImperativeHandle(ref, () => ({
      getVideoElement: () => null,
      getHls: () => null,
    }), []);

    // Reset backup ao mudar canal principal.
    useEffect(() => {
      setBackupIndex(-1);
    }, [streamUrl]);

    // Listeners de eventos do player nativo.
    useEffect(() => {
      const handles: Promise<{ remove: () => Promise<void> }>[] = [];
      handles.push(
        NativePlayer.addListener("playing", () => {
          setFirstFrameReady(true);
        }),
      );
      handles.push(
        NativePlayer.addListener("error", (data) => {
          console.warn("[NativePlayer] erro:", data);
          // Failover pro próximo backup
          setBackupIndex((idx) => {
            const next = idx + 1;
            if (next >= backups.length) return idx;
            return next;
          });
        }),
      );
      return () => {
        handles.forEach((p) => p.then((h) => h.remove()).catch(() => {}));
      };
    }, [backups.length]);

    // Carrega URL no player nativo sempre que mudar.
    useEffect(() => {
      let cancelled = false;
      (async () => {
        let url: string;
        if (useProxyToken && channelId) {
          url = await resolveChannelStreamUrl(activeStreamUrl, channelId, true, forceProxyNative);
        } else if (forceProxyNative) {
          url = buildProxyStreamUrl(activeStreamUrl) ?? getPlayableStreamUrl(activeStreamUrl);
        } else {
          url = getPlayableStreamUrl(activeStreamUrl);
        }
        if (cancelled) return;
        try {
          await NativePlayer.load({
            url,
            type: detectType(url),
            headers: isProxiedStreamUrl(url) ? {} : { "User-Agent": "LNTV/1.0" },
          });
          if (autoPlay) await NativePlayer.play();
        } catch (e) {
          console.error("[NativePlayer] load falhou:", e);
        }
      })();
      return () => { cancelled = true; };
    }, [activeStreamUrl, useProxyToken, forceProxyNative, channelId, autoPlay]);

    // Unmount: derruba player + restaura WebView preto + remove flag transparente.
    useEffect(() => {
      document.documentElement.classList.add("native-player-active");
      return () => {
        document.documentElement.classList.remove("native-player-active");
        NativePlayer.destroy().catch(() => {});
      };
    }, []);

    // Placeholder transparente — o vídeo real está no SurfaceView nativo
    // POR BAIXO do WebView. Mostramos só o spinner quando ainda sem 1º frame.
    return (
      <>
        <div className="absolute inset-0 w-full h-full pointer-events-none" />
        {!firstFrameReady && <DelayedSpinner key={activeStreamUrl} />}
      </>
    );
  },
);

const DelayedSpinner = () => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 900);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="absolute bottom-6 right-6 pointer-events-none animate-fade-in" aria-hidden="true">
      <div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin drop-shadow-lg" />
    </div>
  );
};

NativeAndroidPlayer.displayName = "NativeAndroidPlayer";
export default NativeAndroidPlayer;
