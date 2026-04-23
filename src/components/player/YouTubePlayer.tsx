import { useEffect, useRef, useState } from "react";

interface YouTubePlayerProps {
  videoId: string;
  autoPlay?: boolean;
}

/**
 * Player do YouTube via IFrame API oficial.
 * Estratégia de áudio:
 * 1. Tenta iniciar SEM mute. Se o navegador/WebView bloquear o autoplay,
 *    cai automaticamente para mute + autoplay e desmuta na primeira interação.
 * 2. Em qualquer caso, qualquer toque/clique/tecla desmuta imediatamente.
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
        controls: 1,
      },
      events: {
        onReady: (e: any) => {
          // Tenta tocar com som
          try {
            e.target.unMute?.();
            e.target.setVolume?.(100);
            e.target.playVideo?.();
          } catch {}

          // Fallback: se em ~800ms não estiver tocando, força mute + play
          // (alguns WebViews/Chromes bloqueiam autoplay com áudio)
          setTimeout(() => {
            try {
              const state = e.target.getPlayerState?.();
              // 1 = playing
              if (state !== 1) {
                e.target.mute?.();
                e.target.playVideo?.();
              }
            } catch {}
          }, 800);
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

  // Desmuta na primeira interação do usuário
  useEffect(() => {
    const unmute = () => {
      try {
        playerRef.current?.unMute?.();
        playerRef.current?.setVolume?.(100);
        playerRef.current?.playVideo?.();
      } catch {}
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

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
};

export default YouTubePlayer;
