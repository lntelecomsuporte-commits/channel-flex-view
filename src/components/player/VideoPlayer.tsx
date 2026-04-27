import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import Hls from "hls.js";
import { getPlayableStreamUrl, getProxiedStreamUrl, resolveChannelStreamUrl } from "@/lib/stream";
import { extractYouTubeVideoId } from "@/lib/youtube";
import YouTubePlayer from "./YouTubePlayer";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
  /** Quando setado junto com `useProxyToken`, força o stream pelo hls-proxy
   *  com token assinado (esconde a URL real do provedor no F12). */
  channelId?: string | null;
  useProxyToken?: boolean;
}

export interface VideoPlayerHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getHls: () => Hls | null;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ streamUrl, autoPlay = true, channelId = null, useProxyToken = false }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [muted, setMuted] = useState(true);
  const [useProxyFallback, setUseProxyFallback] = useState(false);
  const [proxyTokenFailure, setProxyTokenFailure] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const youTubeVideoId = extractYouTubeVideoId(streamUrl);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getHls: () => hlsRef.current,
  }), []);

  // Resolve a URL de stream — pode ser async se canal usar token assinado.
  useEffect(() => {
    if (youTubeVideoId) {
      setResolvedUrl("");
      return;
    }
    let cancelled = false;
    (async () => {
      let url: string;
      if (useProxyFallback) {
        url = getProxiedStreamUrl(streamUrl);
      } else if (useProxyToken && channelId && !proxyTokenFailure) {
        url = await resolveChannelStreamUrl(streamUrl, channelId, true);
      } else {
        url = getPlayableStreamUrl(streamUrl);
      }
      if (!cancelled) setResolvedUrl(url);
    })();
    return () => { cancelled = true; };
  }, [streamUrl, useProxyFallback, useProxyToken, channelId, youTubeVideoId, proxyTokenFailure]);

  const playableStreamUrl = resolvedUrl;

  useEffect(() => {
    setUseProxyFallback(false);
    setProxyTokenFailure(false);
  }, [streamUrl]);


  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playableStreamUrl) return;

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isSignedProxyUrl = playableStreamUrl.includes("/functions/v1/hls-proxy") && playableStreamUrl.includes("st=");
    const forcedProxyUrl = getProxiedStreamUrl(streamUrl);
    const canFallbackToDirect = isSignedProxyUrl && !proxyTokenFailure;
    const canFallbackToProxy = !useProxyFallback && !isSignedProxyUrl && forcedProxyUrl !== streamUrl && forcedProxyUrl !== playableStreamUrl;
    const fallbackToDirect = () => {
      if (!canFallbackToDirect) return false;
      console.warn("[HLS] Proxy assinado falhou — tentando stream direto");
      setProxyTokenFailure(true);
      return true;
    };
    const fallbackToProxy = () => {
      if (fallbackToDirect()) return true;
      if (!canFallbackToProxy) return false;
      console.warn("[HLS] Stream direto falhou — tentando via proxy");
      setUseProxyFallback(true);
      return true;
    };
    const handleVideoError = () => {
      fallbackToProxy();
    };
    video.addEventListener("error", handleVideoError);

    // On iOS/Safari, prefer native HLS for better AirPlay support
    const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
      video.canPlayType("application/vnd.apple.mpegurl");

    if (isAppleDevice) {
      video.src = playableStreamUrl;
      if (autoPlay) video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // Buffer padrão, mas com folga do ao vivo para absorver oscilações
        lowLatencyMode: false,
        liveSyncDurationCount: 6,        // ~6 segmentos atrás do live edge
        liveMaxLatencyDurationCount: 12, // tolerância antes de re-sincronizar
        // Retries agressivos para fragmentos e manifestos
        fragLoadingMaxRetry: isSignedProxyUrl ? 1 : 8,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: isSignedProxyUrl ? 1500 : 16000,
        manifestLoadingMaxRetry: isSignedProxyUrl ? 1 : 6,
        manifestLoadingRetryDelay: 500,
        manifestLoadingMaxRetryTimeout: isSignedProxyUrl ? 1500 : 16000,
        levelLoadingMaxRetry: isSignedProxyUrl ? 1 : 6,
        levelLoadingRetryDelay: 500,
        levelLoadingMaxRetryTimeout: isSignedProxyUrl ? 1500 : 16000,
        // ABR conservador: começa baixo, sobe devagar
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.6,
      });
      hlsRef.current = hls;
      hls.loadSource(playableStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
      });

      // Recuperação automática de erros — em vez de travar, tenta continuar
      // tocando o que está no buffer (gera efeito "quadriculado" natural do H.264
      // em vez de imagem congelada).
      let mediaErrorRecoveryAttempts = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (fallbackToProxy()) return;
            console.warn("[HLS] Erro de rede fatal — tentando retomar:", data.details);
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            mediaErrorRecoveryAttempts++;
            console.warn("[HLS] Erro de mídia fatal — recuperando:", data.details);
            if (mediaErrorRecoveryAttempts <= 3) {
              hls.recoverMediaError();
            } else {
              hls.swapAudioCodec();
              hls.recoverMediaError();
            }
            break;
          default:
            console.error("[HLS] Erro fatal não recuperável:", data);
            hls.destroy();
            break;
        }
      });

      // Reset contador de recuperação quando voltar a tocar normalmente
      hls.on(Hls.Events.FRAG_LOADED, () => {
        mediaErrorRecoveryAttempts = 0;
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playableStreamUrl;
      if (autoPlay) video.play().catch(() => {});
    }

    return () => {
      video.removeEventListener("error", handleVideoError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playableStreamUrl, autoPlay, streamUrl, useProxyFallback, proxyTokenFailure]);

  // Unmute after first user interaction
  useEffect(() => {
    const unmute = () => {
      setMuted(false);
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
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-contain"
      playsInline
      muted={muted}
      // @ts-ignore - AirPlay attributes
      x-webkit-airplay="allow"
      webkit-playsinline="true"
      crossOrigin="anonymous"
    />
  );
});

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
