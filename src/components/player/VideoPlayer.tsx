import { useRef, useEffect, useState, useCallback } from "react";
import Hls from "hls.js";
import { getPlayableStreamUrl, getProxiedStreamUrl } from "@/lib/stream";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [muted, setMuted] = useState(true);
  const [useProxy, setUseProxy] = useState(false);

  const effectiveUrl = useProxy
    ? getProxiedStreamUrl(streamUrl)
    : getPlayableStreamUrl(streamUrl);

  // Reset proxy flag when stream changes
  useEffect(() => {
    setUseProxy(false);
  }, [streamUrl]);

  const fallbackToProxy = useCallback(() => {
    const proxied = getProxiedStreamUrl(streamUrl);
    // Only fallback if proxy URL is different from current
    if (proxied !== effectiveUrl && proxied !== streamUrl) {
      console.log("[VideoPlayer] Direct failed, falling back to proxy");
      setUseProxy(true);
    }
  }, [streamUrl, effectiveUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !effectiveUrl) return;

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
      video.src = effectiveUrl;
      video.onerror = () => {
        if (!useProxy) fallbackToProxy();
      };
      if (autoPlay) video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;
      hls.loadSource(effectiveUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
      });

      // On network error (CORS, cert issues), fallback to proxy
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR && !useProxy) {
          hls.destroy();
          hlsRef.current = null;
          fallbackToProxy();
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = effectiveUrl;
      video.onerror = () => {
        if (!useProxy) fallbackToProxy();
      };
      if (autoPlay) video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) video.onerror = null;
    };
  }, [effectiveUrl, autoPlay, useProxy, fallbackToProxy]);

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
    />
  );
};

export default VideoPlayer;
