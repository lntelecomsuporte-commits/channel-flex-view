import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import Hls from "hls.js";
import { getPlayableStreamUrl } from "@/lib/stream";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

export interface VideoPlayerHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getHls: () => Hls | null;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ streamUrl, autoPlay = true }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [muted, setMuted] = useState(true);
  const playableStreamUrl = getPlayableStreamUrl(streamUrl);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getHls: () => hlsRef.current,
  }), []);

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
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 16000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 500,
        manifestLoadingMaxRetryTimeout: 16000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 500,
        levelLoadingMaxRetryTimeout: 16000,
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
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playableStreamUrl, autoPlay]);

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
