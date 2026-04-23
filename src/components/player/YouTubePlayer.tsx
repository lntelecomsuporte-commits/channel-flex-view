import { useEffect, useRef, useState } from "react";
import { hasUserInteracted, onFirstInteraction } from "@/lib/userInteraction";

interface YouTubePlayerProps {
  videoId: string;
  autoPlay?: boolean;
}

/**
 * Player do YouTube via IFrame API oficial.
 * Estratégia de áudio:
 * 1. Se o usuário já interagiu com o app (login, clique, tecla), abre com som —
 *    o "crédito" de autoplay com áudio vale pela sessão inteira da aba/WebView.
 * 2. Caso seja a 1ª ação absoluta no app, inicia mutado e desmuta na 1ª interação.
 */
const YouTubePlayer = ({ videoId, autoPlay = true }: YouTubePlayerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [apiReady, setApiReady] = useState<boolean>(
    typeof window !== "undefined" && !!(window as any).YT?.Player
  );

  // Carrega a IFrame API do YouTube uma única vez
  useEffect(() => {
    if (apiReady) return;
    const w = window as any;
    if (w.YT?.Player) {
      setApiReady(true);
      return;
    }
    const existing = document.getElementById("youtube-iframe-api");
    const prevCallback = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prevCallback === "function") prevCallback();
      setApiReady(true);
    };
    if (!existing) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  }, [apiReady]);

  // Cria/recria o player quando videoId muda
  useEffect(() => {
    if (!apiReady || !containerRef.current) return;
    const YT = (window as any).YT;
    if (!YT?.Player) return;

    // Limpa player anterior
    if (playerRef.current?.destroy) {
      try { playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    }

    // Container precisa ter um elemento dedicado para o YT substituir
    const mountEl = document.createElement("div");
    mountEl.style.width = "100%";
    mountEl.style.height = "100%";
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(mountEl);

    playerRef.current = new YT.Player(mountEl, {
      videoId,
      playerVars: {
        autoplay: autoPlay ? 1 : 0,
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
      },
      events: {
        onReady: (e: any) => {
          const canUnmute = hasUserInteracted();
          try {
            if (canUnmute) {
              e.target.unMute?.();
              e.target.setVolume?.(100);
            } else {
              e.target.mute?.();
            }
            e.target.playVideo?.();
          } catch {}
        },
      },
    });

    return () => {
      if (playerRef.current?.destroy) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, [apiReady, videoId, autoPlay]);

  // Se ainda não havia interação quando o player montou, desmuta na 1ª interação
  useEffect(() => {
    return onFirstInteraction(() => {
      try {
        playerRef.current?.unMute?.();
        playerRef.current?.setVolume?.(100);
        playerRef.current?.playVideo?.();
      } catch {}
    });
  }, [videoId]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
};

export default YouTubePlayer;
