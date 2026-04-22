import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import Hls from "hls.js";
import { Capacitor } from "@capacitor/core";
import { getPlayableStreamUrl, getProxyStreamUrl } from "@/lib/stream";

const isNative = Capacitor.isNativePlatform();

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
  const hasRetriedWithProxyRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [playableStreamUrl, setPlayableStreamUrl] = useState(() => getPlayableStreamUrl(streamUrl));

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getHls: () => hlsRef.current,
  }), []);

  useEffect(() => {
    hasRetriedWithProxyRef.current = false;
    setPlayableStreamUrl(getPlayableStreamUrl(streamUrl));
  }, [streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playableStreamUrl) return;

    const fallbackToProxy = () => {
      if (hasRetriedWithProxyRef.current) return false;

      const proxyUrl = getProxyStreamUrl(streamUrl);
      if (!proxyUrl || proxyUrl === playableStreamUrl) return false;

      hasRetriedWithProxyRef.current = true;
      setPlayableStreamUrl(proxyUrl);
      return true;
    };

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
        lowLatencyMode: true,
      });
      hlsRef.current = hls;
      hls.loadSource(playableStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && fallbackToProxy()) {
          hls.destroy();
          hlsRef.current = null;
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        hls.destroy();
        hlsRef.current = null;
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playableStreamUrl;
      video.onerror = () => {
        fallbackToProxy();
      };
      if (autoPlay) video.play().catch(() => {});
    }

    return () => {
      video.onerror = null;
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
      {...(isNative ? {} : { crossOrigin: "anonymous" as const })}
    />
  );
});

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
