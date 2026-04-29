import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { getPlayableStreamUrl, resolveChannelStreamUrl, buildProxyStreamUrl, isProxiedStreamUrl, resolveRedirects } from "@/lib/stream";
import { Capacitor } from "@capacitor/core";
import { extractYouTubeVideoId } from "@/lib/youtube";
import { getDeviceProfile } from "@/lib/deviceProfile";
import YouTubePlayer from "./YouTubePlayer";

/** Detecta o engine a usar com base na URL (extensão). */
const detectEngine = (url: string, sourceUrl = url, forcedContentType = ""): "hls" | "mpegts" | "native" => {
  const contentType = forcedContentType.toLowerCase();
  if (contentType.includes("video/mp2t") || contentType.includes("video/mpeg")) return "mpegts";
  const source = sourceUrl.toLowerCase();
  const playable = url.toLowerCase();
  if (/\.m3u8(\?|$)/.test(source) || /\.m3u8(\?|$)/.test(playable)) return "hls";
  if (/\.(ts|m2ts)(\?|$)/.test(source) || /\.(ts|m2ts)(\?|$)/.test(playable)) return "mpegts";
  return "native";
};

const isHlsManifestUrl = (url: string): boolean => {
  try {
    const pathname = new URL(url).pathname;
    return /\.m3u8$/i.test(pathname);
  } catch {
    return /\.m3u8(\?|$)/i.test(url);
  }
};

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
  /** Quando setado junto com `useProxyToken`, força o stream pelo hls-proxy
   *  com token assinado (esconde a URL real do provedor no F12). */
  channelId?: string | null;
  useProxyToken?: boolean;
  /** Lista ordenada de URLs de fallback. Quando o player esgota tentativas
   *  na URL principal (erro fatal não-recuperável), avança automaticamente
   *  para a próxima URL desta lista. */
  backupStreamUrls?: string[] | null;
}

export interface VideoPlayerHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getHls: () => Hls | null;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ streamUrl, autoPlay = true, channelId = null, useProxyToken = false, backupStreamUrls = null }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  
  const [muted, setMuted] = useState(true);
  const [proxyTokenFailure, setProxyTokenFailure] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const [resolvedContentType, setResolvedContentType] = useState<string>("");
  // Quando uma URL HTTPS direta falha por CORS/302/rede no primeiro load,
  // tentamos UMA vez via proxy genérico (sem hardcode de host).
  const [corsFallback, setCorsFallback] = useState(false);
  
  // Índice da URL ativa: -1 = principal (streamUrl), 0..N = backupStreamUrls[i]
  const [backupIndex, setBackupIndex] = useState(-1);
  const backups = backupStreamUrls?.filter((u) => !!u && u.trim().length > 0) ?? [];
  const activeStreamUrl = backupIndex < 0 ? streamUrl : (backups[backupIndex] ?? streamUrl);
  const youTubeVideoId = extractYouTubeVideoId(activeStreamUrl);

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
      if (useProxyToken && channelId && !proxyTokenFailure && backupIndex < 0) {
        // Token assinado só faz sentido na URL principal (cadastrada no admin).
        // Em backup, vai direto/proxy normal.
        url = await resolveChannelStreamUrl(activeStreamUrl, channelId, true);
      } else if (corsFallback) {
        // Fallback genérico: URL HTTPS direta falhou por CORS/302/rede.
        // Tenta UMA vez via proxy antes de pular pro próximo backup.
        url = buildProxyStreamUrl(activeStreamUrl) ?? getPlayableStreamUrl(activeStreamUrl);
      } else {
        url = getPlayableStreamUrl(activeStreamUrl);
        // No APK: se a URL é HTTPS direta (não-proxy) tenta resolver
        // redirects (encurtadores 301/302) ANTES do hls.js, pra ficar
        // equivalente ao VLC nativo. Se falhar, segue com a URL original.
        if (
          Capacitor.isNativePlatform() &&
          !isProxiedStreamUrl(url) &&
          /^https:\/\//i.test(url)
        ) {
          const resolved = await resolveRedirects(url);
          if (!cancelled && resolved) url = resolved;
        }
      }

      if (isProxiedStreamUrl(url) && isHlsManifestUrl(activeStreamUrl)) {
        // O proxy expõe o content-type final após redirects. Se uma URL .m3u8
        // redirecionar para TS bruto, trocamos de hls.js para mpegts.js.
        try {
          const probe = await fetch(url, { method: "GET" });
          const contentType = probe.headers.get("x-lntv-final-content-type") || probe.headers.get("content-type") || "";
          if (!cancelled) setResolvedContentType(contentType);
          probe.body?.cancel().catch(() => {});
          if (contentType.toLowerCase().includes("video/mp2t")) {
            console.warn("[Player] Proxy detectou MPEG-TS bruto após redirect; usando engine MPEG-TS");
          }
        } catch {
          if (!cancelled) setResolvedContentType("");
        }
      } else {
        if (!cancelled) setResolvedContentType("");
      }
      if (!cancelled) setResolvedUrl(url);
    })();
    return () => { cancelled = true; };
  }, [activeStreamUrl, useProxyToken, channelId, youTubeVideoId, proxyTokenFailure, backupIndex, corsFallback]);

  const playableStreamUrl = resolvedUrl;

  // Reset estado quando o canal (URL principal) muda
  useEffect(() => {
    setProxyTokenFailure(false);
    setBackupIndex(-1);
    setCorsFallback(false);
    setResolvedContentType("");
  }, [streamUrl]);

  // Se mudar de backup dentro do mesmo canal, cada URL precisa recomeçar limpa.
  useEffect(() => {
    setCorsFallback(false);
    setResolvedContentType("");
  }, [backupIndex]);

  // Tenta avançar para a próxima URL de backup. Retorna true se houve avanço.
  const tryNextBackup = (): boolean => {
    const next = backupIndex + 1;
    if (next >= backups.length) return false;
    console.warn(`[HLS] Falha total — trocando para backup #${next + 1}/${backups.length}: ${backups[next]}`);
    setProxyTokenFailure(false);
    setCorsFallback(false);
    setResolvedContentType("");
    setBackupIndex(next);
    return true;
  };

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
    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }

    const isSignedProxyUrl = playableStreamUrl.includes("/functions/v1/hls-proxy") && playableStreamUrl.includes("st=");
    const handleVideoError = () => {
      // Regra do projeto: HTTPS direto não cai para proxy automaticamente.
      // Proxy só entra por HTTP/mixed-content ou quando "Ocultar URL" está ativo.
      tryNextBackup();
    };
    video.addEventListener("error", handleVideoError);

    // On iOS/Safari, prefer native HLS for better AirPlay support
    const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
      video.canPlayType("application/vnd.apple.mpegurl");

    // Detecta engine pela extensão da URL: .m3u8 → hls.js, resto → tag <video>.
    const engine = detectEngine(playableStreamUrl, activeStreamUrl, resolvedContentType);
    console.log(`[Player] engine=${engine} url=${playableStreamUrl.slice(0, 80)}...`);

    if (engine === "hls" && !isAppleDevice && Hls.isSupported()) {
      const profile = getDeviceProfile();
      const hls = new Hls({
        enableWorker: true,
        // Buffer padrão, mas com folga do ao vivo para absorver oscilações
        lowLatencyMode: false,
        liveSyncDurationCount: 3,        // ~3 segmentos atrás do live edge (mais perto = abre mais rápido)
        liveMaxLatencyDurationCount: 10, // tolerância antes de re-sincronizar
        // === Otimizações de tempo de troca de canal (fast channel zap) ===
        // Começa pela qualidade mais baixa → 1º frame em ~500ms-1s.
        // ABR sobe pra qualidade ideal nos próximos segmentos.
        startLevel: 0,
        // Buffer dinâmico: 10s em devices fortes (zap rápido),
        // 30s em devices fracos (absorve underruns do decoder lento).
        maxBufferLength: profile.maxBufferLength,
        maxMaxBufferLength: Math.max(30, profile.maxBufferLength),
        maxBufferSize: 30 * 1000 * 1000, // 30MB
        // Pré-busca o primeiro fragmento enquanto o manifesto ainda processa
        startFragPrefetch: true,
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
        // ABR conservador na subida pra evitar reflickar logo após startLevel:0
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.6,
      });
      hlsRef.current = hls;
      hls.loadSource(playableStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Plano A+: cap de qualidade em devices fracos.
        // Procura o maior nível com altura <= maxHeight (ex: 720p).
        if (profile.maxHeight && hls.levels?.length) {
          let capIdx = -1;
          let capHeight = 0;
          hls.levels.forEach((lvl, idx) => {
            const h = lvl.height || 0;
            if (h <= profile.maxHeight! && h > capHeight) {
              capHeight = h;
              capIdx = idx;
            }
          });
          if (capIdx >= 0) {
            hls.autoLevelCapping = capIdx;
            console.log(`[HLS] Device fraco — cap em ${capHeight}p (level ${capIdx})`);
          } else {
            // Single-bitrate ou só tem qualidades acima do cap → força a menor
            const minIdx = hls.levels.reduce(
              (acc, lvl, idx) => (lvl.height < hls.levels[acc].height ? idx : acc),
              0,
            );
            hls.autoLevelCapping = minIdx;
            console.warn(`[HLS] Device fraco — sem nível <=${profile.maxHeight}p, forçando menor (${hls.levels[minIdx].height || "?"}p)`);
          }
        }
        if (autoPlay) video.play().catch(() => {});
      });

      // Recuperação automática de erros — em vez de travar, tenta continuar
      // tocando o que está no buffer (gera efeito "quadriculado" natural do H.264
      // em vez de imagem congelada).
      let mediaErrorRecoveryAttempts = 0;
      let networkErrorRetries = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: {
            networkErrorRetries++;
            // Detecta falha de carregamento do manifesto numa URL HTTPS direta
            // (CORS, 302 cross-origin, ERR_FAILED). Tenta UMA vez via proxy
            // genérico antes de pular pro backup. Sem hardcode de host.
            const isManifestFail =
              data.details === "manifestLoadError" ||
              data.details === "manifestLoadTimeOut" ||
              data.details === "manifestParsingError";
            if (
              isManifestFail &&
              !corsFallback &&
              !isProxiedStreamUrl(playableStreamUrl) &&
              !useProxyToken
            ) {
              console.warn("[HLS] Manifesto direto falhou — tentando via proxy genérico (1x):", data.details);
              setCorsFallback(true);
              return;
            }
            // Após 2 retries do startLoad sem sucesso, considera URL morta
            // e parte para o próximo backup (failover ~3s).
            if (networkErrorRetries > 2) {
              if (tryNextBackup()) return;
              console.error("[HLS] Sem mais backups — desistindo:", data.details);
              hls.destroy();
              return;
            }
            console.warn(`[HLS] Erro de rede fatal (#${networkErrorRetries}) — tentando retomar:`, data.details);
            hls.startLoad();
            break;
          }
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
            if (tryNextBackup()) return;
            hls.destroy();
            break;
        }
      });

      // Reset contador de recuperação quando voltar a tocar normalmente
      hls.on(Hls.Events.FRAG_LOADED, () => {
        mediaErrorRecoveryAttempts = 0;
        networkErrorRetries = 0;
      });

      // === Plano C: auto-recovery quando travar imagem por >4s ===
      // Em devices fracos com decoder saturado, o vídeo congela mas hls.js
      // não dispara erro (segmentos continuam baixando). Detectamos via
      // evento `waiting` e, se persistir, derrubamos pro nível mínimo.
      let waitingTimer: number | null = null;
      let freezeRecoveryCount = 0;
      const onWaiting = () => {
        if (waitingTimer) return;
        waitingTimer = window.setTimeout(() => {
          waitingTimer = null;
          if (video.paused || video.ended) return;
          freezeRecoveryCount++;
          console.warn(`[HLS] Freeze detectado (>4s) — recovery #${freezeRecoveryCount}`);
          if (hls.levels?.length > 1) {
            // Força nível mínimo (qualidade mais baixa disponível)
            const minIdx = hls.levels.reduce(
              (acc, lvl, idx) => (lvl.height < hls.levels[acc].height ? idx : acc),
              0,
            );
            hls.currentLevel = minIdx;
            hls.autoLevelCapping = minIdx;
            console.warn(`[HLS] Forçado para nível ${minIdx} (${hls.levels[minIdx].height || "?"}p)`);
          }
          // Tenta retomar
          hls.startLoad();
          video.play().catch(() => {});
        }, 4000);
      };
      const onPlaying = () => {
        if (waitingTimer) {
          clearTimeout(waitingTimer);
          waitingTimer = null;
        }
      };
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("playing", onPlaying);
      video.addEventListener("stalled", onWaiting);

      // Cleanup adicional desses listeners
      const origDestroy = hls.destroy.bind(hls);
      hls.destroy = () => {
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("stalled", onWaiting);
        if (waitingTimer) clearTimeout(waitingTimer);
        origDestroy();
      };
    } else if (engine === "mpegts" && mpegts.isSupported()) {
      const tsPlayer = mpegts.createPlayer({
        type: "mpegts",
        url: playableStreamUrl,
        isLive: true,
        cors: true,
      }, {
        enableWorker: true,
        enableStashBuffer: false,
        isLive: true,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3,
        liveBufferLatencyMinRemain: 1,
      });
      mpegtsRef.current = tsPlayer;
      tsPlayer.attachMediaElement(video);
      tsPlayer.load();
      tsPlayer.on(mpegts.Events.ERROR, (type, details) => {
        console.warn("[MPEGTS] Erro no stream — tentando backup:", type, details);
        tryNextBackup();
      });
      if (autoPlay) {
        const result = tsPlayer.play();
        if (result instanceof Promise) result.catch(() => {});
      }
    } else if (engine === "native" || (engine === "hls" && isAppleDevice && video.canPlayType("application/vnd.apple.mpegurl"))) {
      // Player nativo: MP4 progressivo ou HLS no Safari/iOS (AirPlay).
      video.src = playableStreamUrl;
      if (autoPlay) video.play().catch(() => {});
    }

    return () => {
      video.removeEventListener("error", handleVideoError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        mpegtsRef.current.destroy();
        mpegtsRef.current = null;
      }
    };
  }, [playableStreamUrl, autoPlay, activeStreamUrl, proxyTokenFailure, resolvedContentType]);

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
      x-webkit-airplay="allow"
      webkit-playsinline="true"
      crossOrigin="anonymous"
    />
  );
});

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
