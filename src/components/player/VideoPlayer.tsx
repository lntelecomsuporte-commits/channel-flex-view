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
        lowLatencyMode: false,
        // Buffer de ~6s pra absorver oscilações de internet
        maxBufferLength: 6,
        maxMaxBufferLength: 12,
        maxBufferSize: 60 * 1000 * 1000, // 60MB
        backBufferLength: 30,
        // Recuperação automática de erros de rede
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1000,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 1000,
        // Não pausa em erros menores - mantém decodificação parcial (efeito "quadriculado")
        nudgeMaxRetry: 10,
        nudgeOffset: 0.2,
      });
      hlsRef.current = hls;
      hls.loadSource(playableStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
      });

      // Recupera automaticamente quando a internet oscila
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.warn("[HLS] Erro de rede - tentando recuperar...");
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.warn("[HLS] Erro de mídia - tentando recuperar...");
            hls.recoverMediaError();
            break;
          default:
            console.error("[HLS] Erro fatal não recuperável:", data);
            break;
        }
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
