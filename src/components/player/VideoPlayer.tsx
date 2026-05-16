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
  /** Quando true, força o stream pelo hls-proxy no APK (sem token assinado).
   *  Útil pra canais com cert ruim/HTTP/rotas instáveis. Ignorado na web. */
  forceProxyNative?: boolean;
  /** Lista ordenada de URLs de fallback. Quando o player esgota tentativas
   *  na URL principal (erro fatal não-recuperável), avança automaticamente
   *  para a próxima URL desta lista. */
  backupStreamUrls?: string[] | null;
}

export interface VideoPlayerHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getHls: () => Hls | null;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>((props, ref) => {
  return <HlsVideoPlayer ref={ref} {...props} />;
});

const HlsVideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ streamUrl, autoPlay = true, channelId = null, useProxyToken = false, forceProxyNative = false, backupStreamUrls = null }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  // Engine atualmente carregada na instância Hls — usado pra decidir hot-swap.
  const currentEngineRef = useRef<"hls" | "mpegts" | "native" | null>(null);
  
  const [muted, setMuted] = useState(true);
  const [proxyTokenFailure, setProxyTokenFailure] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const [resolvedSourceUrl, setResolvedSourceUrl] = useState<string>("");
  const [resolvedContentType, setResolvedContentType] = useState<string>("");
  const [corsFallback, setCorsFallback] = useState(false);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  
  const [backupIndex, setBackupIndex] = useState(-1);
  const backups = backupStreamUrls?.filter((u) => !!u && u.trim().length > 0) ?? [];
  const activeStreamUrl = backupIndex < 0 ? streamUrl : (backups[backupIndex] ?? streamUrl);
  const youTubeVideoId = extractYouTubeVideoId(activeStreamUrl);

  // Refs espelhando estado pra que handlers registrados UMA vez no Hls
  // (caminho hot-swap) sempre leiam valores atuais sem precisar re-registrar.
  const corsFallbackRef = useRef(corsFallback);
  const useProxyTokenRef = useRef(useProxyToken);
  const playableUrlRef = useRef<string>("");
  useEffect(() => { corsFallbackRef.current = corsFallback; }, [corsFallback]);
  useEffect(() => { useProxyTokenRef.current = useProxyToken; }, [useProxyToken]);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getHls: () => hlsRef.current,
  }), []);

  // Resolve a URL de stream.
  // FAST PATH (síncrono): caminho simples (sem token assinado, sem cors fallback)
  // resolve em 1 render só, sem await/microtask. Economiza ~50-150ms no zap.
  // SLOW PATH (async): só quando precisa assinar token HMAC.
  useEffect(() => {
    if (youTubeVideoId) {
      setResolvedUrl("");
      setResolvedSourceUrl("");
      return;
    }

    const needsAsync =
      useProxyToken && channelId && !proxyTokenFailure && backupIndex < 0;

    if (!needsAsync) {
      // Caminho síncrono — resolve direto, sem await.
      let url: string;
      if (corsFallback) {
        url = buildProxyStreamUrl(activeStreamUrl) ?? getPlayableStreamUrl(activeStreamUrl);
      } else if (forceProxyNative && Capacitor.isNativePlatform()) {
        url = buildProxyStreamUrl(activeStreamUrl) ?? getPlayableStreamUrl(activeStreamUrl);
      } else {
        url = getPlayableStreamUrl(activeStreamUrl);
      }
      // Fire-and-forget: aquece cache de redirect pra próxima vez. Não bloqueia.
      if (
        Capacitor.isNativePlatform() &&
        !isProxiedStreamUrl(url) &&
        /^https:\/\//i.test(url)
      ) {
        resolveRedirects(url).catch(() => {});
      }
      setResolvedContentType("");
      setResolvedSourceUrl(activeStreamUrl);
      setResolvedUrl(url);
      return;
    }

    // Caminho async (token assinado HMAC).
    let cancelled = false;
    (async () => {
      const url = await resolveChannelStreamUrl(activeStreamUrl, channelId, true, forceProxyNative);
      if (cancelled) return;
      setResolvedContentType("");
      setResolvedSourceUrl(activeStreamUrl);
      setResolvedUrl(url);
    })();
    return () => { cancelled = true; };
  }, [activeStreamUrl, useProxyToken, forceProxyNative, channelId, youTubeVideoId, proxyTokenFailure, backupIndex, corsFallback]);

  const playableStreamUrl = resolvedSourceUrl === activeStreamUrl ? resolvedUrl : "";

  // Reset estado quando o canal (URL principal) muda.
  // Não zera resolvedUrl aqui: este effect roda após o effect de resolução.
  // Em URLs diretas/síncronas ele pode apagar a URL recém-resolvida e deixar
  // o canal sem src. O guard resolvedSourceUrl === activeStreamUrl já impede
  // anexar a URL do canal anterior no <video> novo.
  useEffect(() => {
    // Reset SOMENTE flags de erro/backup. NÃO zera firstFrameReady:
    // o hot-swap mantém o frame anterior congelado até o novo dar 'playing',
    // o que evita o spinner aparecer em todo zap. firstFrameReady é zerado
    // apenas no effect do <video> abaixo, e mesmo assim o DelayedSpinner
    // tem threshold alto pra não piscar em zap rápido.
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

    playableUrlRef.current = playableStreamUrl;

    // NÃO zera firstFrameReady aqui — em hot-swap o frame anterior fica
    // congelado até o novo dar 'playing'. Sem isso, todo zap mostraria spinner
    // por ~500ms+. firstFrameReady só vai pra false na primeira montagem
    // (initial state) ou se realmente não houver frame.
    const onFirstPlaying = () => setFirstFrameReady(true);
    video.addEventListener("playing", onFirstPlaying);
    video.addEventListener("loadeddata", onFirstPlaying);

    // On iOS/Safari, prefer native HLS for better AirPlay support
    const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
      video.canPlayType("application/vnd.apple.mpegurl");

    // Detecta engine pela extensão da URL: .m3u8 → hls.js, resto → tag <video>.
    const engine = detectEngine(playableStreamUrl, activeStreamUrl, resolvedContentType);
    console.log(`[Player] engine=${engine} url=${playableStreamUrl.slice(0, 80)}...`);

    // === HOT-SWAP: reusa instância Hls entre zaps (ganho ~200-400ms) ===
    // Mesma engine HLS + Hls já anexado ao <video>: troca só o source.
    // Evita destroy/recreate, novo MediaSource (que pisca a tela), nova
    // negociação de codec. O frame anterior fica congelado até 'playing'.
    if (
      engine === "hls" &&
      !isAppleDevice &&
      Hls.isSupported() &&
      hlsRef.current &&
      currentEngineRef.current === "hls"
    ) {
      const hls = hlsRef.current;
      try {
        hls.stopLoad();
        hls.loadSource(playableStreamUrl);
        if (autoPlay) video.play().catch(() => {});
        return () => {
          video.removeEventListener("playing", onFirstPlaying);
          video.removeEventListener("loadeddata", onFirstPlaying);
        };
      } catch (e) {
        console.warn("[Player] hot-swap falhou, recriando:", e);
        try { hls.destroy(); } catch { /* ignore */ }
        hlsRef.current = null;
        currentEngineRef.current = null;
      }
    }

    // === COLD PATH: cria engine nova (mudou de tipo, primeira vez,
    // ou hot-swap falhou). Aí sim derruba o que tiver. ===
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      try { mpegtsRef.current.destroy(); } catch { /* ignore */ }
      mpegtsRef.current = null;
    }
    currentEngineRef.current = null;

    const handleVideoError = () => {
      if (
        !corsFallbackRef.current &&
        !isProxiedStreamUrl(playableUrlRef.current) &&
        !useProxyTokenRef.current
      ) {
        console.warn("[Player] URL direta falhou — tentando via proxy genérico (1x)");
        setCorsFallback(true);
        return;
      }
      tryNextBackup();
    };
    video.addEventListener("error", handleVideoError);

    if (engine === "hls" && !isAppleDevice && Hls.isSupported()) {
      const profile = getDeviceProfile();
      const isWeak = profile.weak;
      const hls = new Hls({
        enableWorker: true,
        // Live low-latency: reduz tempo até 1º frame em ~150-300ms.
        // Em devices fracos mantém modo padrão (decoder não acompanha LL).
        lowLatencyMode: !isWeak,
        // === Fast channel zap ===
        // liveSyncDurationCount: 1 = começa playback assim que o 1º segmento
        // do live edge chega. Antes (2-3) esperava 2-3 segmentos completos
        // antes do 1º frame — explicava boa parte dos ~2s no zap.
        liveSyncDurationCount: isWeak ? 2 : 1,
        liveMaxLatencyDurationCount: isWeak ? 10 : 5,
        startLevel: 0,                              // 1ª qualidade = mais baixa → 1º frame rápido
        startFragPrefetch: true,                    // pre-busca seg #0 enquanto manifest processa
        backBufferLength: isWeak ? 10 : 0,          // libera memória cedo (zap mais leve)
        maxBufferLength: isWeak ? 20 : 6,           // buffer alvo enxuto = recover rápido
        maxMaxBufferLength: 30,
        maxBufferSize: 30 * 1000 * 1000,            // 30MB
        maxBufferHole: 0.3,                         // pula gaps menores rápido
        nudgeMaxRetry: 5,
        // Retries: agressivos mas com cap pra não emperrar em segmento podre.
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 6000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 400,
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetryTimeout: 12000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 400,
        levelLoadingMaxRetryTimeout: 12000,
        // ABR conservador: sobe devagar pra não reflickar logo após startLevel:0
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.6,
      });
      hlsRef.current = hls;
      currentEngineRef.current = "hls";
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
      let frag404ReloadAttempts = 0;
      let lastFrag404ReloadAt = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        // === Tratamento precoce de 404 em fragmento (NÃO-fatal) ===
        // Causa típica: live edge sliding ou token de segmento expirado entre
        // o load do manifest e o pedido do segmento. Repetir o mesmo segmento
        // não resolve — recarrega o manifest pra pegar a janela atualizada.
        if (
          !data.fatal &&
          data.details === "fragLoadError" &&
          (data.response?.code === 404 || data.response?.code === 410)
        ) {
          const now = Date.now();
          if (now - lastFrag404ReloadAt > 3000) {
            lastFrag404ReloadAt = now;
            frag404ReloadAttempts++;
            if (frag404ReloadAttempts > 2) {
              console.warn("[HLS] 404 persistente em fragmento — pulando pro backup");
              if (tryNextBackup()) return;
            } else {
              console.warn(`[HLS] 404 em fragmento (#${frag404ReloadAttempts}) — recarregando manifest`);
              try {
                hls.stopLoad();
                hls.startLoad(-1);
              } catch (e) {
                console.warn("[HLS] Falha ao recarregar manifest:", e);
              }
            }
          }
          return;
        }
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
              hlsRef.current = null;
              currentEngineRef.current = null;
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
            hlsRef.current = null;
            currentEngineRef.current = null;
            break;
        }
      });

      // Reset contador de recuperação quando voltar a tocar normalmente
      hls.on(Hls.Events.FRAG_LOADED, () => {
        mediaErrorRecoveryAttempts = 0;
        networkErrorRetries = 0;
        frag404ReloadAttempts = 0;
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
      currentEngineRef.current = "mpegts";
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
      currentEngineRef.current = "native";
      video.src = playableStreamUrl;
      if (autoPlay) video.play().catch(() => {});
    }

    // === Watchdog agressivo de playback ===
    // No APK travamos mais cedo (8s) — devices fracos engasgam silenciosamente
    // sem disparar erro do hls.js. Na web damos 30s pra evitar reload em zaps
    // lentos legítimos. Também detectamos "tela preta" (readyState < 2) por
    // mais de 12s mesmo com play() chamado.
    const isNative = Capacitor.isNativePlatform();
    const STUCK_THRESHOLD_MS = isNative ? 8_000 : 30_000;
    const NO_DATA_THRESHOLD_MS = isNative ? 12_000 : 25_000;
    let lastTime = 0;
    let lastTimeCheckedAt = Date.now();
    let noDataSince: number | null = null;
    const triggerReload = (reason: string) => {
      console.warn(`[Watchdog] ${reason} — recarregando stream`);
      lastTimeCheckedAt = Date.now();
      noDataSince = null;
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch { /* ignore */ }
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        try { mpegtsRef.current.destroy(); } catch { /* ignore */ }
        mpegtsRef.current = null;
      }
      currentEngineRef.current = null;
      setResolvedContentType((c) => c + " ");
    };
    const watchdog = window.setInterval(() => {
      if (!video || video.paused || video.ended) {
        lastTimeCheckedAt = Date.now();
        lastTime = video?.currentTime ?? 0;
        noDataSince = null;
        return;
      }
      // Sem dados decodáveis (HAVE_NOTHING/HAVE_METADATA) por muito tempo = tela preta.
      if (video.readyState < 2) {
        if (noDataSince === null) noDataSince = Date.now();
        else if (Date.now() - noDataSince > NO_DATA_THRESHOLD_MS) {
          triggerReload(`Sem dados de vídeo por ${((Date.now() - noDataSince) / 1000).toFixed(0)}s (readyState=${video.readyState})`);
        }
      } else {
        noDataSince = null;
      }
      const now = video.currentTime;
      if (Math.abs(now - lastTime) > 0.25) {
        lastTime = now;
        lastTimeCheckedAt = Date.now();
        return;
      }
      const stuckMs = Date.now() - lastTimeCheckedAt;
      if (stuckMs > STUCK_THRESHOLD_MS) {
        triggerReload(`Playback travado por ${(stuckMs / 1000).toFixed(0)}s`);
      }
    }, isNative ? 2_000 : 5_000);

    return () => {
      clearInterval(watchdog);
      video.removeEventListener("error", handleVideoError);
      video.removeEventListener("playing", onFirstPlaying);
      video.removeEventListener("loadeddata", onFirstPlaying);
      // NÃO destrói hlsRef/mpegtsRef aqui — o hot-swap reusa a instância
      // entre zaps. Cleanup real acontece no useEffect de unmount abaixo.
    };
  }, [playableStreamUrl, autoPlay, activeStreamUrl, proxyTokenFailure, resolvedContentType]);

  // Unmount: derruba engines persistentes (hot-swap mantinha entre zaps).
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch { /* ignore */ }
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        try { mpegtsRef.current.destroy(); } catch { /* ignore */ }
        mpegtsRef.current = null;
      }
      currentEngineRef.current = null;
    };
  }, []);

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

  // Loading state: só conta como "carregando" se NUNCA tocou ainda OU
  // se a URL não resolveu. Em hot-swap (firstFrameReady já true) deixa o
  // frame anterior visível enquanto o novo segmento chega — sem spinner piscando.
  const isLoadingNewChannel = !firstFrameReady || resolvedSourceUrl !== activeStreamUrl || !playableStreamUrl;

  return (
    <>
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        style={{ backgroundColor: "#000" }}
        poster=""
        controls={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        playsInline
        muted={muted}
        x-webkit-airplay="allow"
        webkit-playsinline="true"
      />
      {isLoadingNewChannel && <DelayedSpinner key={activeStreamUrl} />}
    </>
  );
});

/**
 * Spinner discreto no canto inferior direito. Só aparece se a troca de
 * canal demorar >900ms — em zap normal (cache hit do prefetch) NÃO mostra
 * nada, só a transição natural do <video>. Sem véu preto pra não cobrir
 * o frame anterior congelado durante o hot-swap.
 */
const DelayedSpinner = () => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 900);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div
      className="absolute bottom-6 right-6 pointer-events-none animate-fade-in"
      aria-hidden="true"
    >
      <div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin drop-shadow-lg" />
    </div>
  );
};

VideoPlayer.displayName = "VideoPlayer";
HlsVideoPlayer.displayName = "HlsVideoPlayer";

export default VideoPlayer;
